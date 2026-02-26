/**
 * Validator Analytics API Server
 * Provides on-chain Solana validator data via REST API
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { ValidatorService } from './services/validatorService';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Initialize services
const validatorService = new ValidatorService(RPC_URL);

// Middleware
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`${timestamp} ${req.method} ${req.path} - ${req.ip}`);
  next();
});

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
 * - limit: Number of validators to return (default: all)
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
app.get('/api/validators', async (req, res) => {
  try {
    const startTime = Date.now();
    
    // Parse query parameters
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const sortBy = (req.query.sortBy as string) || 'stake';
    const order = (req.query.order as string) || 'desc';
    const activeOnly = req.query.activeOnly === 'true';
    
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
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch validator data',
      details: error instanceof Error ? error.message : 'Unknown error',
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

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Validator Analytics API running on port ${PORT}`);
  console.log(`📡 Using Solana RPC: ${RPC_URL}`);
  console.log(`🔍 API Documentation: http://localhost:${PORT}/`);
  console.log(`⚡ Health Check: http://localhost:${PORT}/health`);
  console.log(`🎯 Validators Endpoint: http://localhost:${PORT}/api/validators`);
});

export default app;