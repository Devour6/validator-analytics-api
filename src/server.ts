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
import path from 'path';
import fs from 'fs';
import YAML from 'yaml';
import swaggerUi from 'swagger-ui-express';
import { ValidatorService } from './services/validatorService';
import { WebSocketService } from './services/websocketService';
import { cacheService } from './services/cacheService';
import { logger } from './utils/logger';

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
  logger.info('HTTP request', {
    component: 'Server',
    operation: 'http_request',
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
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
const voteAccountSchema = Joi.string().min(32).max(44).pattern(/^[1-9A-HJ-NP-Za-km-z]+$/).required(); // Valid base58 characters, 32-44 chars
const walletAddressSchema = Joi.string().min(32).max(44).pattern(/^[1-9A-HJ-NP-Za-km-z]+$/).required();

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
    logger.error('Health check failed', {
      component: 'Server',
      operation: 'health_check',
      error: error instanceof Error ? error : new Error(String(error))
    });
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
    
    logger.info('Fetching validators with filters', {
      component: 'Server',
      operation: 'get_validators',
      limit,
      sortBy,
      order,
      activeOnly
    });
    
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
    
    logger.info('API response', {
      component: 'Server',
      operation: 'get_validators',
      validatorCount: validators.length,
      duration: responseTime
    });
    
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
    logger.error('Error in /api/validators', {
      component: 'Server',
      operation: 'get_validators',
      error: error instanceof Error ? error : new Error(String(error))
    });
    
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
 * GET /api/validators/compare?validators=A,B,C
 * Compare up to 5 validators side by side
 * 
 * Query Parameters:
 * - validators: Comma-separated list of vote account addresses (max 5)
 * 
 * Returns comparison data including:
 * - Commission, APY, uptime, skip rate, stake
 * - Ranked by performance score
 * - Phase validators flagged
 */
app.get('/api/validators/compare', apiLimiter, async (req, res) => {
  try {
    const validatorsParam = req.query.validators as string;
    
    if (!validatorsParam) {
      return res.status(400).json({
        error: 'Missing Required Parameter',
        message: 'validators parameter is required',
        example: '/api/validators/compare?validators=vote1,vote2,vote3',
        timestamp: Date.now()
      });
    }
    
    const voteAccounts = validatorsParam.split(',').map(v => v.trim()).filter(v => v.length > 0);
    
    if (voteAccounts.length === 0) {
      return res.status(400).json({
        error: 'Invalid Parameter',
        message: 'No valid vote accounts provided',
        timestamp: Date.now()
      });
    }
    
    if (voteAccounts.length > 5) {
      return res.status(400).json({
        error: 'Too Many Validators',
        message: 'Maximum 5 validators can be compared at once',
        provided: voteAccounts.length,
        timestamp: Date.now()
      });
    }
    
    // Validate vote account format
    const invalidVoteAccounts = voteAccounts.filter(account => 
      account.length < 32 || account.length > 44 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(account)
    );
    
    if (invalidVoteAccounts.length > 0) {
      return res.status(400).json({
        error: 'Invalid Vote Account Format',
        message: 'Vote accounts must be valid 32-44 character base58 strings',
        invalidAccounts: invalidVoteAccounts,
        timestamp: Date.now()
      });
    }
    
    logger.info('Comparing validators', {
      component: 'Server',
      operation: 'compare_validators',
      validatorCount: voteAccounts.length,
      voteAccounts
    });
    const startTime = Date.now();
    
    const comparison = await validatorService.compareValidators(voteAccounts);
    
    const responseTime = Date.now() - startTime;
    logger.info('Validator comparison response', {
      component: 'Server',
      operation: 'compare_validators',
      resultCount: comparison.validators.length,
      duration: responseTime
    });
    
    res.json({
      ...comparison,
      meta: {
        ...comparison.meta,
        responseTimeMs: responseTime
      }
    });
    
  } catch (error) {
    logger.error('Error in /api/validators/compare', {
      component: 'Server',
      operation: 'compare_validators',
      error: error instanceof Error ? error : new Error(String(error))
    });
    
    let statusCode = 500;
    let errorMessage = 'Failed to compare validators';
    
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
 * GET /api/validators/top
 * Top validators leaderboard
 * 
 * Query Parameters:
 * - sort: Sort criteria (apy|uptime|stake) (default: apy)
 * - limit: Number of validators to return (1-100, default: 20)
 * 
 * Returns leaderboard with:
 * - Top validators by specified criteria
 * - Phase validators flagged
 * - Performance scores and rankings
 */
app.get('/api/validators/top', apiLimiter, async (req, res) => {
  try {
    const sortBy = (req.query.sort as string) || 'apy';
    const parsedLimit = parseInt(req.query.limit as string);
    const limit = Math.min(Math.max(isNaN(parsedLimit) ? 20 : parsedLimit, 1), 100);
    
    // Validate sort parameter
    const validSortFields = ['apy', 'uptime', 'stake'];
    if (!validSortFields.includes(sortBy)) {
      return res.status(400).json({
        error: 'Invalid Sort Parameter',
        message: `sort must be one of: ${validSortFields.join(', ')}`,
        provided: sortBy,
        timestamp: Date.now()
      });
    }
    
    logger.info('Fetching top validators', {
      component: 'Server',
      operation: 'get_top_validators',
      limit,
      sortBy
    });
    const startTime = Date.now();
    
    const topValidators = await validatorService.getTopValidators(
      sortBy as 'apy' | 'uptime' | 'stake',
      limit
    );
    
    const responseTime = Date.now() - startTime;
    logger.info('Top validators response', {
      component: 'Server',
      operation: 'get_top_validators',
      resultCount: topValidators.validators.length,
      duration: responseTime
    });
    
    res.json({
      ...topValidators,
      meta: {
        ...topValidators.meta,
        responseTimeMs: responseTime
      }
    });
    
  } catch (error) {
    logger.error('Error in /api/validators/top', {
      component: 'Server',
      operation: 'get_top_validators',
      error: error instanceof Error ? error : new Error(String(error))
    });
    
    let statusCode = 500;
    let errorMessage = 'Failed to fetch top validators';
    
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
 * GET /api/alerts/delinquent
 * Currently delinquent validators alert system
 * 
 * Returns alerts for validators that are currently delinquent:
 * - List of delinquent validators with last vote slot
 * - How long they've been delinquent
 * - Their total stake at risk
 * - Phase validators highlighted
 */
app.get('/api/alerts/delinquent', apiLimiter, async (req, res) => {
  try {
    logger.info('Fetching delinquent validator alerts', {
      component: 'Server',
      operation: 'get_delinquent_validators'
    });
    const startTime = Date.now();
    
    const delinquentAlerts = await validatorService.getDelinquentValidators();
    
    const responseTime = Date.now() - startTime;
    logger.info('Delinquent alerts response', {
      component: 'Server',
      operation: 'get_delinquent_validators',
      delinquentCount: delinquentAlerts.delinquentValidators.length,
      duration: responseTime
    });
    
    res.json({
      ...delinquentAlerts,
      meta: {
        ...delinquentAlerts.meta,
        responseTimeMs: responseTime
      }
    });
    
  } catch (error) {
    logger.error('Error in /api/alerts/delinquent', {
      component: 'Server',
      operation: 'get_delinquent_validators',
      error: error instanceof Error ? error : new Error(String(error))
    });
    
    let statusCode = 500;
    let errorMessage = 'Failed to fetch delinquent validator alerts';
    
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
        message: 'Vote account must be a valid 32-44 character base58 string',
        details: error.details[0].message,
        timestamp: Date.now()
      });
    }
    
    logger.info('Fetching detailed info for validator', {
      component: 'Server',
      operation: 'get_validator_detail',
      voteAccount
    });
    const startTime = Date.now();
    
    const validatorDetail = await validatorService.getValidatorDetail(voteAccount);
    
    const responseTime = Date.now() - startTime;
    logger.info('Validator detail response', {
      component: 'Server',
      operation: 'get_validator_detail',
      voteAccount,
      duration: responseTime
    });
    
    res.json({
      ...validatorDetail,
      meta: {
        responseTimeMs: responseTime
      }
    });
    
  } catch (error) {
    logger.error('Error in /api/validators/:voteAccount', {
      component: 'Server',
      operation: 'get_validator_detail',
      voteAccount: req.params.voteAccount,
      error: error instanceof Error ? error : new Error(String(error))
    });
    
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
        message: 'Vote account must be a valid 32-44 character base58 string',
        details: error.details[0].message,
        timestamp: Date.now()
      });
    }
    
    logger.info('Fetching history for validator', {
      component: 'Server',
      operation: 'get_validator_history',
      voteAccount
    });
    const startTime = Date.now();
    
    const validatorHistory = await validatorService.getValidatorHistory(voteAccount);
    
    const responseTime = Date.now() - startTime;
    logger.info('Validator history response', {
      component: 'Server',
      operation: 'get_validator_history',
      voteAccount,
      epochCount: validatorHistory.epochHistory.length,
      duration: responseTime
    });
    
    res.json({
      ...validatorHistory,
      meta: {
        responseTimeMs: responseTime,
        epochCount: validatorHistory.epochHistory.length
      }
    });
    
  } catch (error) {
    logger.error('Error in /api/validators/:voteAccount/history', {
      component: 'Server',
      operation: 'get_validator_history',
      voteAccount: req.params.voteAccount,
      error: error instanceof Error ? error : new Error(String(error))
    });
    
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
    logger.info('Fetching current epoch info', {
      component: 'Server',
      operation: 'get_current_epoch'
    });
    const startTime = Date.now();
    
    const epochInfo = await validatorService.getCurrentEpochInfo();
    
    const responseTime = Date.now() - startTime;
    logger.info('Current epoch response', {
      component: 'Server',
      operation: 'get_current_epoch',
      epoch: epochInfo.epoch,
      duration: responseTime
    });
    
    res.json({
      ...epochInfo,
      meta: {
        responseTimeMs: responseTime
      }
    });
    
  } catch (error) {
    logger.error('Error in /api/epoch/current', {
      component: 'Server',
      operation: 'get_current_epoch',
      error: error instanceof Error ? error : new Error(String(error))
    });
    
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
        message: 'Wallet address must be a valid 32-44 character base58 string',
        details: error.details[0].message,
        timestamp: Date.now()
      });
    }
    
    logger.info('Fetching stake accounts for wallet', {
      component: 'Server',
      operation: 'get_wallet_stake_accounts',
      wallet
    });
    const startTime = Date.now();
    
    const stakeAccountsData = await validatorService.getWalletStakeAccounts(wallet);
    
    const responseTime = Date.now() - startTime;
    logger.info('Stake accounts response', {
      component: 'Server',
      operation: 'get_wallet_stake_accounts',
      wallet,
      accountCount: stakeAccountsData.stakeAccounts.length,
      duration: responseTime
    });
    
    res.json({
      ...stakeAccountsData,
      meta: {
        responseTimeMs: responseTime,
        accountCount: stakeAccountsData.stakeAccounts.length
      }
    });
    
  } catch (error) {
    logger.error('Error in /api/stake-accounts/:wallet', {
      component: 'Server',
      operation: 'get_wallet_stake_accounts',
      wallet: req.params.wallet,
      error: error instanceof Error ? error : new Error(String(error))
    });
    
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

/**
 * GET /api/network/stats
 * Network-wide staking overview
 * 
 * Returns comprehensive network statistics including:
 * - Total validators (active + delinquent)
 * - Total stake, average stake per validator
 * - Network APY estimate
 * - Nakamoto coefficient (decentralization metric)
 * - Epoch progress percentage
 */
app.get('/api/network/stats', apiLimiter, async (req, res) => {
  try {
    logger.info('Fetching network statistics', {
      component: 'Server',
      operation: 'get_network_stats'
    });
    const startTime = Date.now();
    
    const networkStats = await validatorService.getNetworkStats();
    
    const responseTime = Date.now() - startTime;
    logger.info('Network stats response', {
      component: 'Server',
      operation: 'get_network_stats',
      validatorCount: networkStats.totalValidators,
      duration: responseTime
    });
    
    res.json({
      ...networkStats,
      meta: {
        responseTimeMs: responseTime
      }
    });
    
  } catch (error) {
    logger.error('Error in /api/network/stats', {
      component: 'Server',
      operation: 'get_network_stats',
      error: error instanceof Error ? error : new Error(String(error))
    });
    
    let statusCode = 500;
    let errorMessage = 'Failed to fetch network statistics';
    
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

// Admin endpoints for cache management
app.post('/admin/cache/flush', async (req, res) => {
  try {
    await cacheService.flush();
    res.json({
      success: true,
      message: 'Cache flushed successfully',
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error('Cache flush error', {
      component: 'Server',
      operation: 'admin_cache_flush',
      error: error instanceof Error ? error : new Error(String(error))
    });
    res.status(500).json({
      error: 'Cache Flush Failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: Date.now()
    });
  }
});

app.get('/admin/cache/stats', async (req, res) => {
  try {
    const stats = await cacheService.getStats();
    res.json({
      ...stats,
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error('Cache stats error', {
      component: 'Server',
      operation: 'admin_cache_stats',
      error: error instanceof Error ? error : new Error(String(error))
    });
    res.status(500).json({
      error: 'Cache Stats Failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: Date.now()
    });
  }
});

// Load OpenAPI specification
const openApiPath = path.join(__dirname, '..', 'docs', 'openapi.yaml');
let swaggerDocument: any = null;

try {
  const openApiContent = fs.readFileSync(openApiPath, 'utf8');
  swaggerDocument = YAML.parse(openApiContent) as any;
  logger.info('OpenAPI specification loaded successfully', {
    component: 'Server',
    operation: 'openapi_load',
    path: openApiPath
  });
} catch (error) {
  logger.error('Failed to load OpenAPI specification', {
    component: 'Server',
    operation: 'openapi_load',
    path: openApiPath,
    error: error instanceof Error ? error : new Error(String(error))
  });
}

// Swagger UI Documentation endpoint
app.get('/docs', (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!swaggerDocument) {
    return res.status(503).json({
      error: 'Documentation Unavailable',
      message: 'OpenAPI specification could not be loaded',
      timestamp: Date.now()
    });
  }
  next();
}, swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
  customSiteTitle: 'Validator Analytics API Documentation',
  customfavIcon: '/favicon.ico',
  customCss: '.swagger-ui .topbar { display: none }',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    docExpansion: 'none',
    filter: true,
    showRequestHeaders: true,
    tryItOutEnabled: true,
    supportedSubmitMethods: ['get', 'post', 'put', 'delete', 'patch']
  }
}));

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'Validator Analytics API',
    version: '2.0.0',
    description: 'Solana validator analytics using on-chain data only - Deep Analytics',
    endpoints: {
      // Core Endpoints
      '/health': 'Health check and RPC status',
      '/docs': 'Interactive API documentation (Swagger UI)',
      '/api/validators': 'Get validator data from on-chain sources',
      
      // Network Aggregation Endpoints (NEW)
      '/api/network/stats': 'Network-wide staking overview and Nakamoto coefficient',
      '/api/validators/compare': 'Compare up to 5 validators side by side',
      '/api/validators/top': 'Top validators leaderboard with Phase validator flags',
      '/api/alerts/delinquent': 'Currently delinquent validators with stake at risk',
      
      // V2 Deep Analytics Endpoints
      '/api/validators/:voteAccount': 'Get detailed info for a single validator',
      '/api/validators/:voteAccount/history': 'Get historical performance data',
      '/api/epoch/current': 'Get current epoch information',
      '/api/stake-accounts/:wallet': 'Get stake accounts for a wallet',
      '/api/websocket/status': 'WebSocket service status and connection info',
      
      // V1 Revenue Product - Validator Analytics
      '/api/validator-analytics/v1': 'Enhanced validator analytics with Stakewiz metadata + SVT financial data',
      '/api/validator-analytics/v1/health': 'Health check for external data sources',
      
      // WebSocket
      '/ws': 'WebSocket endpoint for real-time validator updates'
    },
    features: {
      aggregation: [
        'Network-wide staking statistics with Nakamoto coefficient',
        'Side-by-side validator comparison (up to 5 validators)',
        'Top validators leaderboard with Phase validator identification',
        'Delinquent validator alerts with stake at risk tracking',
        'Performance scoring and ranking algorithms'
      ],
      v1: [
        'Stakewiz validator metadata integration',
        'SVT financial data and APY calculations',
        'Risk assessment and scoring',
        'Enhanced validator analytics dashboard',
        'Multi-source data aggregation'
      ],
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
  logger.error('Unhandled error', {
    component: 'Server',
    operation: 'error_handler',
    method: req.method,
    path: req.path,
    error: err
  });
  res.status(500).json({
    error: 'Internal Server Error',
    message: 'An unexpected error occurred',
    timestamp: Date.now()
  });
});

// Only start server if this file is run directly (not imported)
if (require.main === module) {
  server.listen(PORT, async () => {
    logger.info('Validator Analytics API v2 started', {
      component: 'Server',
      operation: 'startup',
      port: PORT,
      rpcUrl: RPC_URL,
      endpoints: {
        documentation: `http://localhost:${PORT}/`,
        health: `http://localhost:${PORT}/health`,
        validators: `http://localhost:${PORT}/api/validators`,
        websocket: `ws://localhost:${PORT}/ws`
      }
    });
    
    // Initialize cache service
    try {
      await cacheService.initialize();
      cacheService.startCleanupTask();
      logger.info('Cache service initialized', {
        component: 'Server',
        operation: 'cache_init',
        redisEnabled: !!process.env.REDIS_URL
      });
    } catch (error) {
      logger.error('Cache service initialization failed', {
        component: 'Server',
        operation: 'cache_init',
        error: error instanceof Error ? error : new Error(String(error))
      });
    }
    
    // Initialize WebSocket service after server starts
    websocketService = new WebSocketService(server, validatorService);
    logger.info('WebSocket service initialized', {
      component: 'Server',
      operation: 'websocket_init'
    });
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully', {
      component: 'Server',
      operation: 'shutdown'
    });
    
    if (websocketService) {
      websocketService.close();
    }
    
    // Disconnect cache service
    try {
      await cacheService.disconnect();
      logger.info('Cache service disconnected', {
        component: 'Server',
        operation: 'shutdown'
      });
    } catch (error) {
      logger.error('Error disconnecting cache service', {
        component: 'Server',
        operation: 'shutdown',
        error: error instanceof Error ? error : new Error(String(error))
      });
    }
    
    server.close(() => {
      logger.info('Server closed', {
        component: 'Server',
        operation: 'shutdown'
      });
      process.exit(0);
    });
  });
}

export default app;