/**
 * Server Endpoint Tests
 */

import request from 'supertest';

// Create persistent mock functions
const mockHealthCheck = jest.fn();
const mockGetValidators = jest.fn();

// Mock the ValidatorService BEFORE importing the server
jest.mock('../services/validatorService', () => {
  return {
    ValidatorService: jest.fn().mockImplementation(() => ({
      healthCheck: mockHealthCheck,
      getValidators: mockGetValidators,
    })),
  };
});

import app from '../server';
import { ValidatorService } from '../services/validatorService';

describe('API Endpoints', () => {
  beforeEach(() => {
    // Clear previous mock calls but keep the functions
    mockHealthCheck.mockReset();
    mockGetValidators.mockReset();
  });
  
  afterAll(async () => {
    // Clear all timers and mocks
    jest.clearAllTimers();
    jest.clearAllMocks();
    
    // Give time for cleanup
    await new Promise(resolve => setTimeout(resolve, 50));
  });

  describe('GET /', () => {
    it('should return service information', async () => {
      const response = await request(app).get('/');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        service: 'Validator Analytics API',
        version: '2.0.0',
        description: expect.any(String),
        endpoints: expect.any(Object),
      });
    });
  });

  describe('GET /health', () => {
    it('should return healthy status when service is working', async () => {
      mockHealthCheck.mockResolvedValue({
        status: 'healthy',
        blockHeight: 12345,
        epoch: 250,
        responseTimeMs: 100,
      });

      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: 'ok',
        service: 'validator-analytics-api',
        version: '1.0.0',
        timestamp: expect.any(Number),
        solana: {
          status: 'healthy',
          blockHeight: 12345,
          epoch: 250,
          responseTimeMs: 100,
        },
      });

      expect(mockHealthCheck).toHaveBeenCalledTimes(1);
    });

    it('should return error status when service is unhealthy', async () => {
      mockHealthCheck.mockRejectedValue(
        new Error('RPC connection failed')
      );

      const response = await request(app).get('/health');

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        status: 'error',
        service: 'validator-analytics-api',
        message: 'Service unhealthy',
        error: 'RPC connection failed',
      });
    });
  });

  describe('GET /api/validators', () => {
    const mockValidatorData = {
      validators: [
        {
          identity: 'validator1',
          name: 'Test Validator 1',
          stake: 1000000000,
          commission: 5,
          activatedStake: 1000000000,
          epochVoteAccount: true,
          nodePubkey: 'node1',
          rootSlot: 12300,
          lastVote: 12345,
          epochCredits: [[250, 1000, 900] as [number, number, number]],
        },
        {
          identity: 'validator2',
          name: 'Test Validator 2',
          stake: 500000000,
          commission: 10,
          activatedStake: 500000000,
          epochVoteAccount: false,
          nodePubkey: 'node2',
          rootSlot: 12200,
          lastVote: 12300,
          epochCredits: [[249, 800, 700] as [number, number, number]],
        },
      ],
      epoch: 250,
      totalValidators: 2,
      totalStake: 1500000000,
      timestamp: Date.now(),
    };

    beforeEach(() => {
      mockGetValidators.mockResolvedValue(mockValidatorData);
    });

    it('should return validator data with default parameters', async () => {
      const response = await request(app).get('/api/validators');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        validators: expect.arrayContaining([
          expect.objectContaining({
            identity: expect.any(String),
            stake: expect.any(Number),
            commission: expect.any(Number),
          }),
        ]),
        epoch: 250,
        totalValidators: 2,
        totalStake: 1500000000,
        timestamp: expect.any(Number),
        requestParams: {
          sortBy: 'stake',
          order: 'desc',
          activeOnly: false,
        },
        meta: {
          responseTimeMs: expect.any(Number),
          returnedCount: 2,
        },
      });

      expect(mockGetValidators).toHaveBeenCalledTimes(1);
    });

    it('should handle valid query parameters', async () => {
      const response = await request(app).get(
        '/api/validators?limit=1&sortBy=commission&order=asc&activeOnly=true'
      );

      expect(response.status).toBe(200);
      expect(response.body.requestParams).toMatchObject({
        limit: 1,
        sortBy: 'commission',
        order: 'asc',
        activeOnly: true,
      });
      expect(response.body.meta.returnedCount).toBeLessThanOrEqual(1);
    });

    it('should validate query parameters', async () => {
      const response = await request(app).get(
        '/api/validators?limit=invalid&sortBy=invalid&order=invalid'
      );

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: 'Invalid Query Parameters',
        message: 'Request contains invalid parameters',
        details: expect.arrayContaining([
          expect.objectContaining({
            field: expect.any(String),
            message: expect.any(String),
          }),
        ]),
      });
    });

    it('should handle limit parameter correctly', async () => {
      const response = await request(app).get('/api/validators?limit=1');

      expect(response.status).toBe(200);
      expect(response.body.validators).toHaveLength(1);
      expect(response.body.meta.returnedCount).toBe(1);
      expect(response.body.totalValidators).toBe(2); // Original total
    });

    it('should handle sorting by different fields', async () => {
      const stakeSortResponse = await request(app).get(
        '/api/validators?sortBy=stake&order=desc'
      );
      expect(stakeSortResponse.status).toBe(200);
      
      const commissionSortResponse = await request(app).get(
        '/api/validators?sortBy=commission&order=asc'
      );
      expect(commissionSortResponse.status).toBe(200);

      const nameSortResponse = await request(app).get(
        '/api/validators?sortBy=name&order=asc'
      );
      expect(nameSortResponse.status).toBe(200);
    });

    it('should filter active validators only', async () => {
      const response = await request(app).get('/api/validators?activeOnly=true');

      expect(response.status).toBe(200);
      // With our mock data, only validator1 is active
      const activeValidators = response.body.validators.filter((v: any) => v.epochVoteAccount);
      expect(activeValidators.length).toBeGreaterThan(0);
    });

    it('should handle service errors', async () => {
      mockGetValidators.mockRejectedValue(
        new Error('RPC connection failed')
      );

      const response = await request(app).get('/api/validators');

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        error: 'Service Error',
        message: 'Unable to connect to Solana RPC. Please try again later.',
        timestamp: expect.any(Number),
      });
    });

    it('should handle timeout errors', async () => {
      mockGetValidators.mockRejectedValue(
        new Error('Request timeout')
      );

      const response = await request(app).get('/api/validators');

      expect(response.status).toBe(504);
      expect(response.body).toMatchObject({
        error: 'Service Error',
        message: 'Request timed out. Please try again.',
      });
    });

    it('should handle rate limit errors', async () => {
      mockGetValidators.mockRejectedValue(
        new Error('Rate limit exceeded (429)')
      );

      const response = await request(app).get('/api/validators');

      expect(response.status).toBe(429);
      expect(response.body).toMatchObject({
        error: 'Service Error',
        message: 'RPC rate limit exceeded. Please try again later.',
      });
    });
  });

  describe('Rate Limiting', () => {
    beforeEach(() => {
      mockGetValidators.mockResolvedValue({
        validators: [],
        epoch: 250,
        totalValidators: 0,
        totalStake: 0,
        timestamp: Date.now(),
      });
    });

    it('should apply rate limiting to API endpoints', async () => {
      // Make multiple rapid requests with rate limiting enabled
      const promises = Array(12).fill(0).map(() => 
        request(app)
          .get('/api/validators')
          .set('x-test-rate-limit', 'true')
      );

      const responses = await Promise.all(promises);
      
      // Some requests should be rate limited (429)
      const rateLimitedResponses = responses.filter(res => res.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    }, 10000);
  });

  describe('GET /docs', () => {
    it('should return API documentation page', async () => {
      const response = await request(app).get('/docs');

      expect(response.status).toBe(200);
      expect(response.type).toMatch(/text\/html/);
      expect(response.text).toContain('swagger-ui-bundle.js');
      expect(response.text).toContain('Validator Analytics API Documentation');
    });

    it('should handle redirects to docs/', async () => {
      const response = await request(app).get('/docs/');

      expect(response.status).toBe(200);
      expect(response.type).toMatch(/text\/html/);
    });

    it('should serve swagger assets', async () => {
      // Test that swagger-ui static assets are served
      const response = await request(app).get('/docs');
      expect(response.status).toBe(200);
      
      // Verify swagger UI is properly initialized
      expect(response.text).toContain('swagger-ui-bundle');
      expect(response.text).toContain('swagger-ui');
    });
  });

  describe('404 Handler', () => {
    it('should return 404 for non-existent endpoints', async () => {
      const response = await request(app).get('/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({
        error: 'Not Found',
        message: expect.stringContaining('/nonexistent'),
        availableEndpoints: expect.arrayContaining([
          'GET /',
          'GET /health',
          'GET /api/validators',
        ]),
      });
    });
  });
});