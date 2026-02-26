/**
 * Validator Analytics API Server
 * Provides on-chain Solana validator data via REST API
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import Joi from 'joi';
import { ValidatorService } from './services/validatorService';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Initialize services
const validatorService = new ValidatorService(RPC_URL);

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
  windowMs: 60 * 1000, // 1 minute
  max: process.env.NODE_ENV === 'test' ? 100 : 10, // Higher limit for tests to avoid conflicts
  message: {
    error: 'API Rate Limit Exceeded',
    message: 'Too many API requests. Please wait before making more requests.',
    retryAfter: '1 minute'
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

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'Validator Analytics API',
    version: '1.0.0',
    description: 'Solana validator analytics using on-chain data only',
    endpoints: {
      '/health': 'Health check and RPC status',
      '/api/validators': 'Get validator data from on-chain sources'
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
  app.listen(PORT, () => {
    console.log(`🚀 Validator Analytics API running on port ${PORT}`);
    console.log(`📡 Using Solana RPC: ${RPC_URL}`);
    console.log(`🔍 API Documentation: http://localhost:${PORT}/`);
    console.log(`⚡ Health Check: http://localhost:${PORT}/health`);
    console.log(`🎯 Validators Endpoint: http://localhost:${PORT}/api/validators`);
  });
}

export default app;