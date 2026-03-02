/**
 * Validator Analytics V1 Tests
 * Tests for Stakewiz + SVT enhanced validator analytics
 */

import request from 'supertest';
import app from '../server';

// Test vote account addresses (mainnet validators)
const TEST_VOTE_ACCOUNTS = {
  VALID: 'Luck3DN6zzv5PJLJaJ3z1BdixwBpDhV5nSBzgMRBKEQ',
  INVALID_SHORT: '123',
  INVALID_LONG: 'a'.repeat(50),
  INVALID_CHARS: 'InvalidChars@#$%',
  NOT_FOUND: 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuv'
};

describe('Validator Analytics V1 API', () => {
  describe('GET /api/validator-analytics/v1', () => {
    test('should return enhanced validator analytics with default parameters', async () => {
      const response = await request(app)
        .get('/api/validator-analytics/v1')
        .expect(200);

      // Validate response structure
      expect(response.body).toHaveProperty('validators');
      expect(response.body).toHaveProperty('pagination');
      expect(response.body).toHaveProperty('aggregates');
      expect(response.body).toHaveProperty('meta');

      // Validate validators array
      expect(Array.isArray(response.body.validators)).toBe(true);
      expect(response.body.validators.length).toBeLessThanOrEqual(50); // Default limit

      // Test first validator structure if any exist
      if (response.body.validators.length > 0) {
        const validator = response.body.validators[0];
        
        // Core validator data
        expect(validator).toHaveProperty('validator');
        expect(validator.validator).toHaveProperty('identity');
        expect(validator.validator).toHaveProperty('stake');
        expect(validator.validator).toHaveProperty('commission');

        // Enhanced data sources
        expect(validator).toHaveProperty('dataTimestamps');
        expect(validator).toHaveProperty('meta');
        expect(validator.meta).toHaveProperty('dataSources');
        expect(validator.meta).toHaveProperty('responseTimeMs');

        // Stakewiz metadata (may be undefined for some validators)
        if (validator.stakewiz) {
          expect(validator.stakewiz).toHaveProperty('voteAccount');
          expect(validator.stakewiz).toHaveProperty('name');
        }

        // SVT financial data (may be undefined for some validators)
        if (validator.svt) {
          expect(validator.svt).toHaveProperty('voteAccount');
          expect(validator.svt).toHaveProperty('apy');
          expect(validator.svt.apy).toHaveProperty('current');
          expect(validator.svt).toHaveProperty('performance');
          expect(validator.svt).toHaveProperty('economics');
          expect(validator.svt).toHaveProperty('risk');
        }
      }

      // Validate pagination
      expect(response.body.pagination).toHaveProperty('total');
      expect(response.body.pagination).toHaveProperty('limit');
      expect(response.body.pagination).toHaveProperty('offset');
      expect(response.body.pagination).toHaveProperty('hasNext');
      expect(response.body.pagination.limit).toBe(50);
      expect(response.body.pagination.offset).toBe(0);

      // Validate aggregates
      expect(response.body.aggregates).toHaveProperty('totalStake');
      expect(response.body.aggregates).toHaveProperty('averageAPY');
      expect(response.body.aggregates).toHaveProperty('averageCommission');
      expect(response.body.aggregates).toHaveProperty('totalValidators');

      // Validate meta
      expect(response.body.meta).toHaveProperty('responseTimeMs');
      expect(response.body.meta).toHaveProperty('epoch');
      expect(response.body.meta).toHaveProperty('timestamp');
      expect(typeof response.body.meta.responseTimeMs).toBe('number');
    }, 30000); // 30 second timeout for comprehensive data fetch

    test('should accept limit parameter', async () => {
      const response = await request(app)
        .get('/api/validator-analytics/v1?limit=10')
        .expect(200);

      expect(response.body.validators.length).toBeLessThanOrEqual(10);
      expect(response.body.pagination.limit).toBe(10);
    });

    test('should accept offset parameter', async () => {
      const response = await request(app)
        .get('/api/validator-analytics/v1?offset=5&limit=5')
        .expect(200);

      expect(response.body.pagination.offset).toBe(5);
      expect(response.body.pagination.limit).toBe(5);
    });

    test('should accept sortBy parameter - stake', async () => {
      const response = await request(app)
        .get('/api/validator-analytics/v1?sortBy=stake&limit=5')
        .expect(200);

      // Verify descending stake order
      if (response.body.validators.length > 1) {
        for (let i = 1; i < response.body.validators.length; i++) {
          expect(response.body.validators[i-1].validator.stake).toBeGreaterThanOrEqual(
            response.body.validators[i].validator.stake
          );
        }
      }
    });

    test('should accept sortBy parameter - commission', async () => {
      const response = await request(app)
        .get('/api/validator-analytics/v1?sortBy=commission&limit=5')
        .expect(200);

      // Verify ascending commission order
      if (response.body.validators.length > 1) {
        for (let i = 1; i < response.body.validators.length; i++) {
          expect(response.body.validators[i-1].validator.commission).toBeLessThanOrEqual(
            response.body.validators[i].validator.commission
          );
        }
      }
    });

    test('should accept sortBy parameter - apy', async () => {
      const response = await request(app)
        .get('/api/validator-analytics/v1?sortBy=apy&limit=5')
        .expect(200);

      // Verify descending APY order (for validators with SVT data)
      const validatorsWithAPY = response.body.validators.filter((v: any) => v.svt?.apy?.current);
      if (validatorsWithAPY.length > 1) {
        for (let i = 1; i < validatorsWithAPY.length; i++) {
          expect(validatorsWithAPY[i-1].svt.apy.current).toBeGreaterThanOrEqual(
            validatorsWithAPY[i].svt.apy.current
          );
        }
      }
    });

    test('should filter by specific voteAccount', async () => {
      const response = await request(app)
        .get(`/api/validator-analytics/v1?voteAccount=${TEST_VOTE_ACCOUNTS.VALID}`)
        .expect(200);

      expect(response.body.validators).toHaveLength(1);
      expect(response.body.validators[0].validator.identity).toBe(TEST_VOTE_ACCOUNTS.VALID);
    });

    test('should enforce maximum limit of 100', async () => {
      const response = await request(app)
        .get('/api/validator-analytics/v1?limit=200')
        .expect(200);

      expect(response.body.pagination.limit).toBe(100);
      expect(response.body.validators.length).toBeLessThanOrEqual(100);
    });

    test('should reject invalid sortBy parameter', async () => {
      const response = await request(app)
        .get('/api/validator-analytics/v1?sortBy=invalid')
        .expect(400);

      expect(response.body.error).toBe('Invalid sortBy parameter');
      expect(response.body.message).toContain('sortBy must be one of');
    });

    test('should reject invalid voteAccount parameter', async () => {
      const response = await request(app)
        .get(`/api/validator-analytics/v1?voteAccount=${TEST_VOTE_ACCOUNTS.INVALID_SHORT}`)
        .expect(400);

      expect(response.body.error).toBe('Invalid voteAccount parameter');
    });

    test('should handle not found voteAccount gracefully', async () => {
      const response = await request(app)
        .get(`/api/validator-analytics/v1?voteAccount=${TEST_VOTE_ACCOUNTS.NOT_FOUND}`)
        .expect(404);

      expect(response.body.message).toContain('not found');
    });

    test('should handle negative offset gracefully', async () => {
      const response = await request(app)
        .get('/api/validator-analytics/v1?offset=-5')
        .expect(200);

      expect(response.body.pagination.offset).toBe(0);
    });

    test('should return consistent data structure even with API failures', async () => {
      // This tests graceful degradation when external APIs fail
      const response = await request(app)
        .get('/api/validator-analytics/v1?limit=3')
        .expect(200);

      expect(response.body.validators).toBeDefined();
      expect(response.body.pagination).toBeDefined();
      expect(response.body.aggregates).toBeDefined();
      expect(response.body.meta).toBeDefined();

      // Should have at least on-chain data even if external APIs fail
      response.body.validators.forEach((validator: any) => {
        expect(validator.validator).toBeDefined();
        expect(validator.meta.dataSources).toContain('on-chain');
      });
    });
  });

  describe('GET /api/validator-analytics/v1/health', () => {
    test('should return health status for all data sources', async () => {
      const response = await request(app)
        .get('/api/validator-analytics/v1/health')
        .expect(200);

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('service');
      expect(response.body).toHaveProperty('dataSources');
      expect(response.body).toHaveProperty('timestamp');

      expect(response.body.service).toBe('validator-analytics-v1');
      expect(response.body.dataSources).toHaveProperty('onChain');
      expect(response.body.dataSources).toHaveProperty('stakewiz');
      expect(response.body.dataSources).toHaveProperty('svt');

      expect(typeof response.body.dataSources.onChain).toBe('boolean');
      expect(typeof response.body.dataSources.stakewiz).toBe('boolean');
      expect(typeof response.body.dataSources.svt).toBe('boolean');
    });
  });

  describe('Performance and Reliability', () => {
    test('should handle concurrent requests without errors', async () => {
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          request(app)
            .get(`/api/validator-analytics/v1?limit=5&offset=${i * 5}`)
            .expect(200)
        );
      }

      const responses = await Promise.all(promises);
      
      responses.forEach((response, index) => {
        expect(response.body.validators).toBeDefined();
        expect(response.body.pagination.offset).toBe(index * 5);
        expect(response.body.pagination.limit).toBe(5);
      });
    });

    test('should respond within reasonable time limits', async () => {
      const startTime = Date.now();
      
      const response = await request(app)
        .get('/api/validator-analytics/v1?limit=10')
        .expect(200);

      const responseTime = Date.now() - startTime;
      
      expect(responseTime).toBeLessThan(15000); // 15 seconds max
      expect(response.body.meta.responseTimeMs).toBeGreaterThan(0);
      expect(response.body.meta.responseTimeMs).toBeLessThan(responseTime + 1000);
    });

    test('should handle large limit requests efficiently', async () => {
      const response = await request(app)
        .get('/api/validator-analytics/v1?limit=100')
        .timeout(30000) // 30 second timeout
        .expect(200);

      expect(response.body.validators.length).toBeLessThanOrEqual(100);
      expect(response.body.meta.responseTimeMs).toBeGreaterThan(0);
    });
  });

  describe('Rate Limiting', () => {
    test('should apply rate limiting to validator analytics endpoint', async () => {
      // Make multiple rapid requests to test rate limiting
      const promises = [];
      for (let i = 0; i < 12; i++) { // Exceed the limit of 10 per minute
        promises.push(
          request(app)
            .get('/api/validator-analytics/v1?limit=1')
            .set('x-test-rate-limit', 'true') // Enable rate limiting in tests
        );
      }

      const responses = await Promise.allSettled(promises);
      
      // Some requests should succeed, some should be rate limited
      const successful = responses.filter(r => r.status === 'fulfilled' && (r.value as any).status === 200);
      const rateLimited = responses.filter(r => r.status === 'fulfilled' && (r.value as any).status === 429);
      
      expect(rateLimited.length).toBeGreaterThan(0);
    }, 10000);
  });

  describe('Error Handling', () => {
    test('should handle malformed query parameters gracefully', async () => {
      const response = await request(app)
        .get('/api/validator-analytics/v1?limit=abc&offset=xyz')
        .expect(200);

      // Should use defaults when parameters are malformed
      expect(response.body.pagination.limit).toBe(50);
      expect(response.body.pagination.offset).toBe(0);
    });

    test('should return appropriate error for invalid vote account characters', async () => {
      const response = await request(app)
        .get(`/api/validator-analytics/v1?voteAccount=${TEST_VOTE_ACCOUNTS.INVALID_CHARS}`)
        .expect(400);

      expect(response.body.error).toBe('Invalid voteAccount parameter');
    });
  });
});