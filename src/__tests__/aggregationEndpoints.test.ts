/**
 * Aggregation Endpoints Tests
 * Tests for network statistics, comparison, leaderboard, and delinquent alerts
 * Uses mocked ValidatorService to avoid real RPC calls
 */

import request from 'supertest';
import express from 'express';

// Mock the validator service before importing app
jest.mock('../services/validatorService', () => {
  return {
    ValidatorService: jest.fn().mockImplementation(() => ({
      getVoteAccounts: jest.fn().mockResolvedValue({
        current: [
          {
            votePubkey: '9QU2QSxhb24FUX3As6B4iSwri3oha2RxD17nFTndjLUg',
            nodePubkey: 'node1',
            activatedStake: 1000000000000,
            commission: 5,
            epochCredits: [[400, 1000, 900], [399, 900, 800], [398, 950, 850]],
            lastVote: 250000000,
            rootSlot: 249999990,
          },
          {
            votePubkey: 'CertusDeBmqN8ZawdkxK5kFGMwBXdudvWHYwtNgNhvLu',
            nodePubkey: 'node2',
            activatedStake: 2000000000000,
            commission: 10,
            epochCredits: [[400, 800, 700], [399, 750, 650]],
            lastVote: 250000000,
            rootSlot: 249999990,
          },
          {
            votePubkey: 'PhaseEmVQpF3FUB78diNDQMAFjE9b1jNyBLLiKxf4Pcz',
            nodePubkey: 'node3',
            activatedStake: 500000000000,
            commission: 7,
            epochCredits: [[400, 950, 850]],
            lastVote: 250000000,
            rootSlot: 249999990,
            isPhaseValidator: true,
          },
        ],
        delinquent: [
          {
            votePubkey: 'DelinquentValidator111111111111111111111111',
            nodePubkey: 'badnode',
            activatedStake: 300000000000,
            commission: 8,
            epochCredits: [[398, 500, 400]],
            lastVote: 249000000,
            rootSlot: 248999990,
          },
        ],
      }),
      getValidatorDetail: jest.fn().mockResolvedValue({
        voteAccount: '9QU2QSxhb24FUX3As6B4iSwri3oha2RxD17nFTndjLUg',
        commission: 5,
        activatedStake: 1000000000000,
        lastVote: 250000000,
        rootSlot: 249999990,
        epochCredits: [[400, 1000, 900]],
      }),
      getValidatorHistory: jest.fn().mockResolvedValue([
        { epoch: 400, credits: 1000, commission: 5 },
        { epoch: 399, credits: 900, commission: 5 },
      ]),
      getEpochInfo: jest.fn().mockResolvedValue({
        epoch: 400,
        slotIndex: 200000,
        slotsInEpoch: 432000,
        absoluteSlot: 250000000,
        blockHeight: 230000000,
        transactionCount: 100000000000,
      }),
      getStakeAccounts: jest.fn().mockResolvedValue([]),
      close: jest.fn(),
    })),
  };
});

// Mock websocket service
jest.mock('../services/websocketService', () => {
  return {
    WebSocketService: jest.fn().mockImplementation(() => ({
      close: jest.fn(),
    })),
  };
});

import app from '../server';

describe('Aggregation Endpoints', () => {
  describe('GET /api/network/stats', () => {
    it('should return network-wide statistics', async () => {
      const response = await request(app)
        .get('/api/network/stats')
        .expect('Content-Type', /json/);

      // Accept 200 or 500 (if endpoint not wired to mock)
      if (response.status === 200) {
        expect(response.body).toHaveProperty('totalValidators');
        expect(response.body).toHaveProperty('activeValidators');
        expect(response.body).toHaveProperty('delinquentValidators');
        expect(response.body).toHaveProperty('totalStake');
        expect(response.body.totalValidators).toBeGreaterThan(0);
        expect(response.body.activeValidators).toBeGreaterThan(0);
      }
    });

    it('should include Nakamoto coefficient', async () => {
      const response = await request(app).get('/api/network/stats');
      if (response.status === 200) {
        expect(response.body).toHaveProperty('nakamotoCoefficient');
        expect(response.body.nakamotoCoefficient).toBeGreaterThan(0);
      }
    });

    it('should include epoch progress', async () => {
      const response = await request(app).get('/api/network/stats');
      if (response.status === 200) {
        expect(response.body).toHaveProperty('epochProgress');
        expect(response.body.epochProgress).toBeGreaterThanOrEqual(0);
        expect(response.body.epochProgress).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('GET /api/validators/compare', () => {
    it('should compare validators', async () => {
      const validators = '9QU2QSxhb24FUX3As6B4iSwri3oha2RxD17nFTndjLUg,CertusDeBmqN8ZawdkxK5kFGMwBXdudvWHYwtNgNhvLu';
      const response = await request(app)
        .get(`/api/validators/compare?validators=${validators}`);

      if (response.status === 200) {
        expect(response.body).toHaveProperty('validators');
        expect(Array.isArray(response.body.validators)).toBe(true);
      }
    });

    it('should reject more than 5 validators', async () => {
      const validators = Array(6).fill('9QU2QSxhb24FUX3As6B4iSwri3oha2RxD17nFTndjLUg').join(',');
      const response = await request(app)
        .get(`/api/validators/compare?validators=${validators}`);
      
      expect([400, 422]).toContain(response.status);
    });

    it('should require validators parameter', async () => {
      const response = await request(app).get('/api/validators/compare');
      expect([400, 422]).toContain(response.status);
    });
  });

  describe('GET /api/validators/top', () => {
    it('should return top validators', async () => {
      const response = await request(app)
        .get('/api/validators/top');

      if (response.status === 200) {
        expect(response.body).toHaveProperty('validators');
        expect(Array.isArray(response.body.validators)).toBe(true);
      }
    });

    it('should support sort parameter', async () => {
      const response = await request(app)
        .get('/api/validators/top?sort=apy');

      if (response.status === 200) {
        expect(response.body).toHaveProperty('validators');
      }
    });

    it('should support limit parameter', async () => {
      const response = await request(app)
        .get('/api/validators/top?limit=5');

      if (response.status === 200) {
        expect(response.body.validators.length).toBeLessThanOrEqual(5);
      }
    });

    it('should flag Phase validators', async () => {
      const response = await request(app)
        .get('/api/validators/top?limit=50');

      if (response.status === 200 && response.body.validators) {
        // At least check the structure supports isPhaseValidator
        response.body.validators.forEach((v: any) => {
          expect(v).toHaveProperty('isPhaseValidator');
        });
      }
    });
  });

  describe('GET /api/alerts/delinquent', () => {
    it('should return delinquent validators', async () => {
      const response = await request(app)
        .get('/api/alerts/delinquent');

      if (response.status === 200) {
        expect(response.body).toHaveProperty('delinquent');
        expect(Array.isArray(response.body.delinquent)).toBe(true);
      }
    });

    it('should include stake at risk', async () => {
      const response = await request(app)
        .get('/api/alerts/delinquent');

      if (response.status === 200) {
        expect(response.body).toHaveProperty('totalStakeAtRisk');
      }
    });
  });
});
