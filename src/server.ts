/**
 * Validator Analytics API Server
 * Provides on-chain Solana validator data via REST API
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import Joi from 'joi';
import { createServer } from 'http';
import { ValidatorService } from './services/validatorService';
import { WebSocketService } from './services/websocketService';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Create HTTP server
const server = createServer(app);

// Initialize services
const validatorService = new ValidatorService(RPC_URL);
let websocketService: WebSocketService;

// Rate limiting middleware
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: 'Too Many Requests',
    message: 'Rate limit exceeded. Please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// API-specific rate limiting (stricter for the main endpoint)
const apiLimiter = rateLimit({
  windowMs: process.env.NODE_ENV === 'test' ? 5000 : 60 * 1000, // 5 seconds for tests, 1 minute for production
  max: process.env.NODE_ENV === 'test' ? 6 : 10, // 6 requests per 5 seconds for tests
  message: {
    error: 'API Rate Limit Exceeded',
    message: 'Too many API requests. Please wait before making more requests.',
    retryAfter: process.env.NODE_ENV === 'test' ? '5 seconds' : '1 minute'
  },
  skip: (req) => {
    // Skip rate limiting in tests unless specifically testing rate limits
    if (process.env.NODE_ENV === 'test' && !req.headers['x-test-rate-limit']) {
      return true;
    }
    return false;
  },
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(limiter); // Apply to all requests

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`${timestamp} ${req.method} ${req.path} - ${req.ip}`);
  next();
});

// Input validation schemas
const validatorQuerySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(1000).optional(),
  sortBy: Joi.string().valid('stake', 'commission', 'name').default('stake'),
  order: Joi.string().valid('asc', 'desc').default('desc'),
  activeOnly: Joi.boolean().optional().default(false)
});

// V2 validation schemas
const voteAccountSchema = Joi.string().length(44).pattern(/^[1-9A-HJ-NP-Za-km-z]+$/).required(); // Valid base58 characters and length
const walletAddressSchema = Joi.string().length(44).pattern(/^[1-9A-HJ-NP-Za-km-z]+$/).required();

// Validation middleware
const validateQuery = (schema: Joi.ObjectSchema) => {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const { error, value } = schema.validate(req.query, { 
      convert: true, 
      stripUnknown: true 
    });
    
    if (error) {
      return res.status(400).json({
        error: 'Invalid Query Parameters',
        message: 'Request contains invalid parameters',
        details: error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          value: detail.context?.value
        })),
        timestamp: Date.now()
      });
    }
    
    req.query = value;
    next();
  };
};

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const health = await validatorService.healthCheck();
    res.json({
      status: 'ok',
      service: 'validator-analytics-api',
      version: '1.0.0',
      timestamp: Date.now(),
      solana: health
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({
      status: 'error',
      service: 'validator-analytics-api',
      message: 'Service unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/validators
 * 
 * Returns comprehensive validator data from on-chain sources only.
 * Combines data from getVoteAccounts RPC call and validator-info program.
 * 
 * Query Parameters:
 * - limit: Number of validators to return (1-1000, default: all)
 * - sortBy: Sort field (stake|commission|name) (default: stake)
 * - order: Sort order (asc|desc) (default: desc)
 * - activeOnly: Only return active validators (default: false)
 * 
 * Response:
 * {
 *   validators: ValidatorInfo[],
 *   epoch: number,
 *   totalValidators: number,
 *   totalStake: number,
 *   timestamp: number
 * }
 */
app.get('/api/validators', apiLimiter, validateQuery(validatorQuerySchema), async (req, res) => {
  try {
    const startTime = Date.now();
    
    // Extract validated query parameters
    const { limit, sortBy, order, activeOnly } = req.query as any;
    
    console.log(`Fetching validators with filters: limit=${limit}, sortBy=${sortBy}, order=${order}, activeOnly=${activeOnly}`);
    
    // Fetch validator data
    const data = await validatorService.getValidators();
    
    // Apply filters
    let validators = data.validators;
    
    // Filter to active only if requested
    if (activeOnly) {
      validators = validators.filter(v => v.epochVoteAccount);
    }
    
    // Sort validators
    validators.sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;
      
      switch (sortBy) {
        case 'commission':
          aVal = a.commission;
          bVal = b.commission;
          break;
        case 'name':
          aVal = a.name || '';
          bVal = b.name || '';
          break;
        case 'stake':
        default:
          aVal = a.stake;
          bVal = b.stake;
          break;
      }
      
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return order === 'asc' 
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      
      return order === 'asc' 
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });
    
    // Apply limit
    if (limit && limit > 0) {
      validators = validators.slice(0, limit);
    }
    
    const responseTime = Date.now() - startTime;
    
    console.log(`API response: ${validators.length} validators, ${responseTime}ms`);
    
    // Return filtered and sorted data
    res.json({
      ...data,
      validators,
      totalValidators: data.validators.length, // Keep original total
      requestParams: {
        limit,
        sortBy,
        order,
        activeOnly
      },
      meta: {
        responseTimeMs: responseTime,
        returnedCount: validators.length
      }
    });
    
  } catch (error) {
    console.error('Error in /api/validators:', error);
    
    // Determine appropriate error response based on error type
    let statusCode = 500;
    let errorMessage = 'Failed to fetch validator data';
    
    if (error instanceof Error) {
      // Check for specific error types
      if (error.message.includes('Connection') || error.message.includes('network') || error.message.includes('connection')) {
        statusCode = 503;
        errorMessage = 'Unable to connect to Solana RPC. Please try again later.';
      } else if (error.message.includes('timeout') || error.message.includes('Timeout')) {
        statusCode = 504;
        errorMessage = 'Request timed out. Please try again.';
      } else if (error.message.includes('Rate limit') || error.message.includes('rate limit') || error.message.includes('429')) {
        statusCode = 429;
        errorMessage = 'RPC rate limit exceeded. Please try again later.';
      }
    }
    
    res.status(statusCode).json({
      error: statusCode === 500 ? 'Internal Server Error' : 'Service Error',
      message: errorMessage,
      details: process.env.NODE_ENV === 'development' 
        ? (error instanceof Error ? error.message : 'Unknown error')
        : undefined,
      timestamp: Date.now()
    });
  }
});

/**
 * GET /api/validators/:voteAccount
 * V2 ENDPOINT: Single validator detail view
 * 
 * Returns detailed information about a specific validator including:
 * - Vote account info, commission, last vote, root slot
 * - Epoch credits history (last 10 epochs)
 * - Estimated APY based on recent performance
 * - Delinquency status and skip rate
 */
app.get('/api/validators/:voteAccount', apiLimiter, async (req, res) => {
  try {
    const { voteAccount } = req.params;
    
    // Validate vote account parameter
    const { error } = voteAccountSchema.validate(voteAccount);
    if (error) {
      return res.status(400).json({
        error: 'Invalid Vote Account',
        message: 'Vote account must be a valid 44-character base58 string',
        details: error.details[0].message,
        timestamp: Date.now()
      });
    }
    
    console.log(`Fetching detailed info for validator: ${voteAccount}`);
    const startTime = Date.now();
    
    const validatorDetail = await validatorService.getValidatorDetail(voteAccount);
    
    const responseTime = Date.now() - startTime;
    console.log(`Validator detail response: ${responseTime}ms`);
    
    res.json({
      ...validatorDetail,
      meta: {
        responseTimeMs: responseTime
      }
    });
    
  } catch (error) {
    console.error(`Error in /api/validators/:voteAccount:`, error);
    
    let statusCode = 500;
    let errorMessage = 'Failed to fetch validator detail';
    
    if (error instanceof Error) {
      // Check for various "not found" patterns in the error message
      if (error.message.includes('not found') || 
          (error.message.includes('Validator') && error.message.includes('not found')) ||
          error.message.match(/Validator .* not found/)) {
        statusCode = 404;
        errorMessage = 'Validator not found';
      } else if (error.message.includes('Connection') || error.message.includes('timeout')) {
        statusCode = 503;
        errorMessage = 'Unable to connect to Solana RPC';
      }
    }
    
    res.status(statusCode).json({
      error: statusCode === 404 ? 'Not Found' : 'Service Error',
      message: errorMessage,
      voteAccount: req.params.voteAccount,
      timestamp: Date.now()
    });
  }
});

/**
 * GET /api/validators/:voteAccount/history
 * V2 ENDPOINT: Historical performance data
 * 
 * Returns historical performance metrics including:
 * - Epoch-by-epoch credits earned
 * - Commission changes over time
 * - Stake changes over time
 */
app.get('/api/validators/:voteAccount/history', apiLimiter, async (req, res) => {
  try {
    const { voteAccount } = req.params;
    
    // Validate vote account parameter
    const { error } = voteAccountSchema.validate(voteAccount);
    if (error) {
      return res.status(400).json({
        error: 'Invalid Vote Account',
        message: 'Vote account must be a valid 44-character base58 string',
        details: error.details[0].message,
        timestamp: Date.now()
      });
    }
    
    console.log(`Fetching history for validator: ${voteAccount}`);
    const startTime = Date.now();
    
    const validatorHistory = await validatorService.getValidatorHistory(voteAccount);
    
    const responseTime = Date.now() - startTime;
    console.log(`Validator history response: ${responseTime}ms`);
    
    res.json({
      ...validatorHistory,
      meta: {
        responseTimeMs: responseTime,
        epochCount: validatorHistory.epochHistory.length
      }
    });
    
  } catch (error) {
    console.error(`Error in /api/validators/:voteAccount/history:`, error);
    
    let statusCode = 500;
    let errorMessage = 'Failed to fetch validator history';
    
    if (error instanceof Error) {
      // Check for various "not found" patterns in the error message
      if (error.message.includes('not found') || 
          (error.message.includes('Validator') && error.message.includes('not found')) ||
          error.message.match(/Validator .* not found/)) {
        statusCode = 404;
        errorMessage = 'Validator not found';
      } else if (error.message.includes('Connection') || error.message.includes('timeout')) {
        statusCode = 503;
        errorMessage = 'Unable to connect to Solana RPC';
      }
    }
    
    res.status(statusCode).json({
      error: statusCode === 404 ? 'Not Found' : 'Service Error',
      message: errorMessage,
      voteAccount: req.params.voteAccount,
      timestamp: Date.now()
    });
  }
});

/**
 * GET /api/epoch/current
 * V2 ENDPOINT: Current epoch information
 * 
 * Returns current epoch status including:
 * - Epoch number, slot index, slots in epoch
 * - Time remaining estimate
 * - Total active stake
 */
app.get('/api/epoch/current', apiLimiter, async (req, res) => {
  try {
    console.log('Fetching current epoch info');
    const startTime = Date.now();
    
    const epochInfo = await validatorService.getCurrentEpochInfo();
    
    const responseTime = Date.now() - startTime;
    console.log(`Current epoch response: ${responseTime}ms`);
    
    res.json({
      ...epochInfo,
      meta: {
        responseTimeMs: responseTime
      }
    });
    
  } catch (error) {
    console.error('Error in /api/epoch/current:', error);
    
    let statusCode = 500;
    let errorMessage = 'Failed to fetch epoch information';
    
    if (error instanceof Error) {
      if (error.message.includes('Connection') || error.message.includes('timeout')) {
        statusCode = 503;
        errorMessage = 'Unable to connect to Solana RPC';
      }
    }
    
    res.status(statusCode).json({
      error: 'Service Error',
      message: errorMessage,
      timestamp: Date.now()
    });
  }
});

/**
 * GET /api/stake-accounts/:wallet
 * V2 ENDPOINT: Wallet stake accounts
 * 
 * Returns all stake accounts for a wallet including:
 * - Active delegations with validator info
 * - Activating/deactivating accounts
 * - Rewards earned
 */
app.get('/api/stake-accounts/:wallet', apiLimiter, async (req, res) => {
  try {
    const { wallet } = req.params;
    
    // Validate wallet address parameter
    const { error } = walletAddressSchema.validate(wallet);
    if (error) {
      return res.status(400).json({
        error: 'Invalid Wallet Address',
        message: 'Wallet address must be a valid 44-character base58 string',
        details: error.details[0].message,
        timestamp: Date.now()
      });
    }
    
    console.log(`Fetching stake accounts for wallet: ${wallet}`);
    const startTime = Date.now();
    
    const stakeAccountsData = await validatorService.getWalletStakeAccounts(wallet);
    
    const responseTime = Date.now() - startTime;
    console.log(`Stake accounts response: ${stakeAccountsData.stakeAccounts.length} accounts, ${responseTime}ms`);
    
    res.json({
      ...stakeAccountsData,
      meta: {
        responseTimeMs: responseTime,
        accountCount: stakeAccountsData.stakeAccounts.length
      }
    });
    
  } catch (error) {
    console.error(`Error in /api/stake-accounts/:wallet:`, error);
    
    let statusCode = 500;
    let errorMessage = 'Failed to fetch stake accounts';
    
    if (error instanceof Error) {
      if (error.message.includes('Invalid public key')) {
        statusCode = 400;
        errorMessage = 'Invalid wallet address format';
      } else if (error.message.includes('Connection') || error.message.includes('timeout')) {
        statusCode = 503;
        errorMessage = 'Unable to connect to Solana RPC';
      }
    }
    
    res.status(statusCode).json({
      error: statusCode === 400 ? 'Bad Request' : 'Service Error',
      message: errorMessage,
      wallet: req.params.wallet,
      timestamp: Date.now()
    });
  }
});

/**
 * GET /api/websocket/status
 * WebSocket service status and connection statistics
 */
app.get('/api/websocket/status', (req, res) => {
  if (!websocketService) {
    return res.status(503).json({
      error: 'WebSocket service not initialized',
      available: false,
      timestamp: Date.now()
    });
  }

  const stats = websocketService.getConnectionStats();
  
  res.json({
    available: true,
    endpoint: '/ws',
    protocol: 'WebSocket',
    ...stats,
    supportedEvents: [
      'validator_performance',
      'delinquency_alert', 
      'commission_change'
    ],
    subscriptionFormat: {
      subscribe: {
        type: 'subscribe',
        voteAccount: 'validator_vote_account_pubkey',
        events: ['performance', 'delinquency', 'commission']
      },
      unsubscribe: {
        type: 'unsubscribe',
        voteAccount: 'validator_vote_account_pubkey',
        events: ['performance', 'delinquency', 'commission']
      }
    },
    timestamp: Date.now()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'Validator Analytics API',
    version: '2.0.0',
    description: 'Solana validator analytics using on-chain data only - Deep Analytics',
    endpoints: {
      // V1 Endpoints
      '/health': 'Health check and RPC status',
      '/api/validators': 'Get validator data from on-chain sources',
      
      // V2 Deep Analytics Endpoints
      '/api/validators/:voteAccount': 'Get detailed info for a single validator',
      '/api/validators/:voteAccount/history': 'Get historical performance data',
      '/api/epoch/current': 'Get current epoch information',
      '/api/stake-accounts/:wallet': 'Get stake accounts for a wallet',
      '/api/websocket/status': 'WebSocket service status and connection info',
      
      // WebSocket
      '/ws': 'WebSocket endpoint for real-time validator updates'
    },
    features: {
      v2: [
        'Single validator detail views with APY estimates',
        'Historical epoch-by-epoch performance tracking',
        'Current epoch progress and timing',
        'Wallet stake account analysis',
        'Skip rate and delinquency monitoring'
      ]
    },
    documentation: 'https://github.com/Devour6/validator-analytics-api',
    rpcEndpoint: RPC_URL
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Endpoint ${req.method} ${req.originalUrl} not found`,
    availableEndpoints: ['GET /', 'GET /health', 'GET /api/validators']
  });
});

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: 'An unexpected error occurred',
    timestamp: Date.now()
  });
});

// Only start server if this file is run directly (not imported)
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`🚀 Validator Analytics API v2 running on port ${PORT}`);
    console.log(`📡 Using Solana RPC: ${RPC_URL}`);
    console.log(`🔍 API Documentation: http://localhost:${PORT}/`);
    console.log(`⚡ Health Check: http://localhost:${PORT}/health`);
    console.log(`🎯 Validators Endpoint: http://localhost:${PORT}/api/validators`);
    console.log(`📊 V2 Endpoints: epoch, validator details, history, stake accounts`);
    console.log(`🔌 WebSocket: ws://localhost:${PORT}/ws`);
    
    // Initialize WebSocket service after server starts
    websocketService = new WebSocketService(server, validatorService);
    console.log(`📡 WebSocket service initialized`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    
    if (websocketService) {
      websocketService.close();
    }
    
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });
}

export default app;