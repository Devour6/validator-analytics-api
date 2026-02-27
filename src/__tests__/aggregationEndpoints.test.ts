/**
 * Aggregation Endpoints Tests
 * Tests for network statistics, comparison, leaderboard, and delinquent alerts
 */

import request from 'supertest';
import app from '../server';

describe('Aggregation Endpoints', () => {
  // Increase timeout for network requests
  jest.setTimeout(30000);

  describe('GET /api/network/stats', () => {
    it('should return network-wide statistics', async () => {
      const response = await request(app)
        .get('/api/network/stats')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('totalValidators');
      expect(response.body).toHaveProperty('activeValidators');
      expect(response.body).toHaveProperty('delinquentValidators');
      expect(response.body).toHaveProperty('totalStake');
      expect(response.body).toHaveProperty('averageStake');
      expect(response.body).toHaveProperty('networkAPY');
      expect(response.body).toHaveProperty('nakamotoCoefficient');
      expect(response.body).toHaveProperty('epoch');
      expect(response.body).toHaveProperty('epochProgress');
      expect(response.body).toHaveProperty('timestamp');

      // Validate data types
      expect(typeof response.body.totalValidators).toBe('number');
      expect(typeof response.body.activeValidators).toBe('number');
      expect(typeof response.body.delinquentValidators).toBe('number');
      expect(typeof response.body.totalStake).toBe('number');
      expect(typeof response.body.averageStake).toBe('number');
      expect(typeof response.body.networkAPY).toBe('number');
      expect(typeof response.body.nakamotoCoefficient).toBe('number');
      expect(typeof response.body.epoch).toBe('number');
      expect(typeof response.body.epochProgress).toBe('number');

      // Validate value ranges
      expect(response.body.totalValidators).toBeGreaterThan(0);
      expect(response.body.activeValidators).toBeGreaterThanOrEqual(0);
      expect(response.body.delinquentValidators).toBeGreaterThanOrEqual(0);
      expect(response.body.totalStake).toBeGreaterThan(0);
      expect(response.body.averageStake).toBeGreaterThan(0);
      expect(response.body.nakamotoCoefficient).toBeGreaterThan(0);
      expect(response.body.epochProgress).toBeGreaterThanOrEqual(0);
      expect(response.body.epochProgress).toBeLessThanOrEqual(100);
      
      // Total should equal active + delinquent
      expect(response.body.totalValidators).toBe(
        response.body.activeValidators + response.body.delinquentValidators
      );
    });

    it('should include response metadata', async () => {
      const response = await request(app)
        .get('/api/network/stats')
        .expect(200);

      expect(response.body).toHaveProperty('meta');
      expect(response.body.meta).toHaveProperty('responseTimeMs');
      expect(typeof response.body.meta.responseTimeMs).toBe('number');
      expect(response.body.meta.responseTimeMs).toBeGreaterThan(0);
    });
  });

  describe('GET /api/validators/compare', () => {
    it('should require validators parameter', async () => {
      const response = await request(app)
        .get('/api/validators/compare')
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('Missing Required Parameter');
      expect(response.body).toHaveProperty('example');
    });

    it('should reject empty validators parameter', async () => {
      const response = await request(app)
        .get('/api/validators/compare?validators=')
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('Invalid Parameter');
    });

    it('should reject more than 5 validators', async () => {
      const validators = 'a,b,c,d,e,f'.split(',').map((_, i) => 
        '1'.repeat(32) + i.toString().padStart(12, '0')
      ).join(',');

      const response = await request(app)
        .get(`/api/validators/compare?validators=${validators}`)
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('Too Many Validators');
      expect(response.body).toHaveProperty('provided');
      expect(response.body.provided).toBe(6);
    });

    it('should reject invalid vote account format', async () => {
      const response = await request(app)
        .get('/api/validators/compare?validators=invalid,tooshort')
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('Invalid Vote Account Format');
      expect(response.body).toHaveProperty('invalidAccounts');
      expect(response.body.invalidAccounts).toContain('invalid');
      expect(response.body.invalidAccounts).toContain('tooshort');
    });

    it('should compare valid validators', async () => {
      // Use placeholder vote accounts for testing (these might not exist)
      const validators = [
        '11111111111111111111111111111111', // 32 chars
        '22222222222222222222222222222222'  // 32 chars
      ].join(',');

      const response = await request(app)
        .get(`/api/validators/compare?validators=${validators}`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('validators');
      expect(response.body).toHaveProperty('notFound');
      expect(response.body).toHaveProperty('epoch');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('meta');

      expect(Array.isArray(response.body.validators)).toBe(true);
      expect(Array.isArray(response.body.notFound)).toBe(true);

      // Meta validation
      expect(response.body.meta).toHaveProperty('responseTimeMs');
      expect(response.body.meta).toHaveProperty('requestedCount');
      expect(response.body.meta).toHaveProperty('foundCount');
      expect(response.body.meta.requestedCount).toBe(2);

      // Validator structure validation (if any found)
      if (response.body.validators.length > 0) {
        const validator = response.body.validators[0];
        expect(validator).toHaveProperty('voteAccount');
        expect(validator).toHaveProperty('name');
        expect(validator).toHaveProperty('commission');
        expect(validator).toHaveProperty('apy');
        expect(validator).toHaveProperty('uptime');
        expect(validator).toHaveProperty('skipRate');
        expect(validator).toHaveProperty('stake');
        expect(validator).toHaveProperty('performanceScore');
        expect(validator).toHaveProperty('isPhaseValidator');
        expect(validator).toHaveProperty('isDelinquent');

        // Type validations
        expect(typeof validator.commission).toBe('number');
        expect(typeof validator.apy).toBe('number');
        expect(typeof validator.uptime).toBe('number');
        expect(typeof validator.skipRate).toBe('number');
        expect(typeof validator.stake).toBe('number');
        expect(typeof validator.performanceScore).toBe('number');
        expect(typeof validator.isPhaseValidator).toBe('boolean');
        expect(typeof validator.isDelinquent).toBe('boolean');

        // Range validations
        expect(validator.commission).toBeGreaterThanOrEqual(0);
        expect(validator.commission).toBeLessThanOrEqual(100);
        expect(validator.performanceScore).toBeGreaterThanOrEqual(0);
        expect(validator.performanceScore).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('GET /api/validators/top', () => {
    it('should return top validators with default parameters', async () => {
      const response = await request(app)
        .get('/api/validators/top')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('validators');
      expect(response.body).toHaveProperty('sortBy');
      expect(response.body).toHaveProperty('limit');
      expect(response.body).toHaveProperty('epoch');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('meta');

      // Default values
      expect(response.body.sortBy).toBe('apy');
      expect(response.body.limit).toBe(20);

      expect(Array.isArray(response.body.validators)).toBe(true);
      expect(response.body.validators.length).toBeLessThanOrEqual(20);

      // Meta validation
      expect(response.body.meta).toHaveProperty('responseTimeMs');
      expect(response.body.meta).toHaveProperty('totalValidators');
      expect(response.body.meta).toHaveProperty('phaseValidators');

      // Validator structure validation
      if (response.body.validators.length > 0) {
        const validator = response.body.validators[0];
        expect(validator).toHaveProperty('voteAccount');
        expect(validator).toHaveProperty('name');
        expect(validator).toHaveProperty('commission');
        expect(validator).toHaveProperty('apy');
        expect(validator).toHaveProperty('uptime');
        expect(validator).toHaveProperty('stake');
        expect(validator).toHaveProperty('stakeGrowth');
        expect(validator).toHaveProperty('performanceScore');
        expect(validator).toHaveProperty('isPhaseValidator');
        expect(validator).toHaveProperty('rank');

        // Validate ranking
        expect(validator.rank).toBe(1); // First validator should have rank 1
        expect(typeof validator.rank).toBe('number');
        expect(typeof validator.isPhaseValidator).toBe('boolean');
      }
    });

    it('should accept valid sort parameters', async () => {
      const sortOptions = ['apy', 'uptime', 'stake'];
      
      for (const sort of sortOptions) {
        const response = await request(app)
          .get(`/api/validators/top?sort=${sort}`)
          .expect('Content-Type', /json/)
          .expect(200);

        expect(response.body.sortBy).toBe(sort);
      }
    });

    it('should reject invalid sort parameter', async () => {
      const response = await request(app)
        .get('/api/validators/top?sort=invalid')
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('Invalid Sort Parameter');
    });

    it('should respect limit parameter', async () => {
      const response = await request(app)
        .get('/api/validators/top?limit=5')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.limit).toBe(5);
      expect(response.body.validators.length).toBeLessThanOrEqual(5);
    });

    it('should enforce maximum limit', async () => {
      const response = await request(app)
        .get('/api/validators/top?limit=200')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.limit).toBe(100); // Should be capped at 100
    });

    it('should enforce minimum limit', async () => {
      const response = await request(app)
        .get('/api/validators/top?limit=0')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.limit).toBe(1); // Should be at least 1
    });
  });

  describe('GET /api/alerts/delinquent', () => {
    it('should return delinquent validator alerts', async () => {
      const response = await request(app)
        .get('/api/alerts/delinquent')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('delinquentValidators');
      expect(response.body).toHaveProperty('totalDelinquent');
      expect(response.body).toHaveProperty('totalStakeAtRisk');
      expect(response.body).toHaveProperty('currentSlot');
      expect(response.body).toHaveProperty('epoch');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('meta');

      expect(Array.isArray(response.body.delinquentValidators)).toBe(true);
      expect(typeof response.body.totalDelinquent).toBe('number');
      expect(typeof response.body.totalStakeAtRisk).toBe('number');
      expect(typeof response.body.currentSlot).toBe('number');

      // Should match array length
      expect(response.body.totalDelinquent).toBe(response.body.delinquentValidators.length);

      // Meta validation
      expect(response.body.meta).toHaveProperty('responseTimeMs');
      expect(response.body.meta).toHaveProperty('phaseValidatorsDelinquent');
      expect(typeof response.body.meta.phaseValidatorsDelinquent).toBe('number');

      // Validator structure validation
      if (response.body.delinquentValidators.length > 0) {
        const validator = response.body.delinquentValidators[0];
        expect(validator).toHaveProperty('voteAccount');
        expect(validator).toHaveProperty('name');
        expect(validator).toHaveProperty('lastVote');
        expect(validator).toHaveProperty('slotsSinceLastVote');
        expect(validator).toHaveProperty('minutesSinceLastVote');
        expect(validator).toHaveProperty('stakeAtRisk');
        expect(validator).toHaveProperty('commission');
        expect(validator).toHaveProperty('isPhaseValidator');

        // Type validations
        expect(typeof validator.voteAccount).toBe('string');
        expect(typeof validator.slotsSinceLastVote).toBe('number');
        expect(typeof validator.minutesSinceLastVote).toBe('number');
        expect(typeof validator.stakeAtRisk).toBe('number');
        expect(typeof validator.commission).toBe('number');
        expect(typeof validator.isPhaseValidator).toBe('boolean');

        // Range validations
        expect(validator.slotsSinceLastVote).toBeGreaterThanOrEqual(0);
        expect(validator.minutesSinceLastVote).toBeGreaterThanOrEqual(0);
        expect(validator.stakeAtRisk).toBeGreaterThanOrEqual(0);
      }
    });

    it('should calculate total stake at risk correctly', async () => {
      const response = await request(app)
        .get('/api/alerts/delinquent')
        .expect(200);

      const calculatedTotal = response.body.delinquentValidators.reduce(
        (sum: number, validator: any) => sum + validator.stakeAtRisk, 
        0
      );

      expect(response.body.totalStakeAtRisk).toBe(calculatedTotal);
    });
  });

  describe('Rate Limiting', () => {
    it('should apply rate limiting to aggregation endpoints', async () => {
      // This test would need to be adjusted based on your rate limiting configuration
      // For now, just verify that the endpoints respond normally within rate limits
      
      const endpoints = [
        '/api/network/stats',
        '/api/validators/top',
        '/api/alerts/delinquent'
      ];

      for (const endpoint of endpoints) {
        const response = await request(app)
          .get(endpoint)
          .expect(200);
        
        // Should not be rate limited on first request
        expect(response.body).not.toHaveProperty('error');
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle RPC connection errors gracefully', async () => {
      // This test would require mocking the RPC connection to simulate failures
      // For now, just verify that errors are properly formatted
      
      // Test with malformed comparison request that might trigger errors
      const response = await request(app)
        .get('/api/validators/compare?validators=invalid')
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('timestamp');
    });
  });
});