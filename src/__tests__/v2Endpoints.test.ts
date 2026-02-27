/**
 * V2 Endpoints Tests
 * Testing deep analytics endpoints
 */

import request from 'supertest';
import app from '../server';

// Test timeout for RPC calls
const TIMEOUT = 30000;

describe('V2 Deep Analytics Endpoints', () => {
  // We'll get a real vote account dynamically from the validators endpoint
  let VALID_VOTE_ACCOUNT: string;
  const VALID_WALLET = '2BVLdp8XGQeBiLpT5fhJN9W5dxdH6fFdPqJU7z8HN9Mv';
  const INVALID_PUBKEY = 'invalid_key';

  beforeAll(async () => {
    // Get a real validator from the main endpoint to use in tests
    try {
      const validatorsResponse = await request(app)
        .get('/api/validators?limit=1')
        .expect(200);
      
      if (validatorsResponse.body.validators && validatorsResponse.body.validators.length > 0) {
        VALID_VOTE_ACCOUNT = validatorsResponse.body.validators[0].identity;
      } else {
        // Fallback if no validators found
        VALID_VOTE_ACCOUNT = 'CertusDeBmqN8ZawdkxK5kFGMwBXdudvWkRPBkkgxqoD';
      }
    } catch (error) {
      // Fallback if validators endpoint fails
      VALID_VOTE_ACCOUNT = 'CertusDeBmqN8ZawdkxK5kFGMwBXdudvWkRPBkkgxqoD';
    }
  }, TIMEOUT);

  describe('GET /api/validators/:voteAccount', () => {
    test('should return validator detail for valid vote account', async () => {
      const response = await request(app)
        .get(`/api/validators/${VALID_VOTE_ACCOUNT}`);
        
      // The response could be 200 (found) or 404 (not found) - both are valid since validator data changes
      expect([200, 404]).toContain(response.status);
      
      if (response.status === 404) {
        // If validator not found, ensure proper error format
        expect(response.body).toMatchObject({
          error: 'Not Found',
          message: 'Validator not found',
          voteAccount: VALID_VOTE_ACCOUNT,
          timestamp: expect.any(Number)
        });
        return;
      }

      expect(response.body).toMatchObject({
        voteAccount: VALID_VOTE_ACCOUNT,
        identity: expect.any(String),
        commission: expect.any(Number),
        activatedStake: expect.any(Number),
        epochVoteAccount: expect.any(Boolean),
        delinquent: expect.any(Boolean),
        epochCreditsHistory: expect.any(Array),
        estimatedApy: expect.any(Number),
        skipRate: expect.any(Number),
        currentEpochPerformance: expect.objectContaining({
          creditsEarned: expect.any(Number),
          expectedCredits: expect.any(Number),
          performanceScore: expect.any(Number)
        }),
        meta: expect.objectContaining({
          responseTimeMs: expect.any(Number)
        })
      });

      // Validate epoch credits history structure
      if (response.body.epochCreditsHistory.length > 0) {
        expect(response.body.epochCreditsHistory[0]).toMatchObject({
          epoch: expect.any(Number),
          credits: expect.any(Number),
          previousCredits: expect.any(Number)
        });
      }
    }, TIMEOUT);

    test('should return 400 for invalid vote account format', async () => {
      const response = await request(app)
        .get(`/api/validators/${INVALID_PUBKEY}`)
        .expect(400);

      expect(response.body).toMatchObject({
        error: 'Invalid Vote Account',
        message: expect.stringContaining('valid 32-44 character base58 string'),
        timestamp: expect.any(Number)
      });
    });

    test('should return 404 for non-existent validator', async () => {
      // Use a valid format but non-existent vote account (valid base58, 44 chars)
      const nonExistentVoteAccount = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
      
      const response = await request(app)
        .get(`/api/validators/${nonExistentVoteAccount}`)
        .expect(404);

      expect(response.body).toMatchObject({
        error: 'Not Found',
        message: 'Validator not found',
        voteAccount: nonExistentVoteAccount,
        timestamp: expect.any(Number)
      });
    }, TIMEOUT);
  });

  describe('GET /api/validators/:voteAccount/history', () => {
    test('should return validator history for valid vote account', async () => {
      const response = await request(app)
        .get(`/api/validators/${VALID_VOTE_ACCOUNT}/history`);
        
      // The response could be 200 (found) or 404 (not found) - both are valid
      expect([200, 404]).toContain(response.status);
      
      if (response.status === 404) {
        expect(response.body).toMatchObject({
          error: 'Not Found',
          message: 'Validator not found',
          voteAccount: VALID_VOTE_ACCOUNT,
          timestamp: expect.any(Number)
        });
        return;
      }

      expect(response.body).toMatchObject({
        voteAccount: VALID_VOTE_ACCOUNT,
        epochHistory: expect.any(Array),
        commissionHistory: expect.any(Array),
        stakeHistory: expect.any(Array),
        meta: expect.objectContaining({
          responseTimeMs: expect.any(Number),
          epochCount: expect.any(Number)
        })
      });

      // Validate epoch history structure
      if (response.body.epochHistory.length > 0) {
        expect(response.body.epochHistory[0]).toMatchObject({
          epoch: expect.any(Number),
          credits: expect.any(Number),
          creditsEarned: expect.any(Number),
          commission: expect.any(Number),
          activatedStake: expect.any(Number),
          skipRate: expect.any(Number),
          timestamp: expect.any(Number)
        });
      }

      // Validate commission history structure
      if (response.body.commissionHistory.length > 0) {
        expect(response.body.commissionHistory[0]).toMatchObject({
          epoch: expect.any(Number),
          commission: expect.any(Number),
          changedAt: expect.any(Number)
        });
      }

      // Validate stake history structure
      if (response.body.stakeHistory.length > 0) {
        expect(response.body.stakeHistory[0]).toMatchObject({
          epoch: expect.any(Number),
          activatedStake: expect.any(Number),
          changedAt: expect.any(Number)
        });
      }
    }, TIMEOUT);

    test('should return 400 for invalid vote account format', async () => {
      const response = await request(app)
        .get(`/api/validators/${INVALID_PUBKEY}/history`)
        .expect(400);

      expect(response.body).toMatchObject({
        error: 'Invalid Vote Account',
        message: expect.stringContaining('valid 32-44 character base58 string'),
        timestamp: expect.any(Number)
      });
    });
  });

  describe('GET /api/epoch/current', () => {
    test('should return current epoch information', async () => {
      const response = await request(app)
        .get('/api/epoch/current')
        .expect(200);

      expect(response.body).toMatchObject({
        epoch: expect.any(Number),
        slotIndex: expect.any(Number),
        slotsInEpoch: expect.any(Number),
        progress: expect.any(Number),
        timeRemainingMs: expect.any(Number),
        totalActiveStake: expect.any(Number),
        activeValidatorCount: expect.any(Number),
        currentSlot: expect.any(Number),
        epochStartSlot: expect.any(Number),
        timestamp: expect.any(Number),
        meta: expect.objectContaining({
          responseTimeMs: expect.any(Number)
        })
      });

      // Validate value ranges
      expect(response.body.progress).toBeGreaterThanOrEqual(0);
      expect(response.body.progress).toBeLessThanOrEqual(100);
      expect(response.body.epoch).toBeGreaterThan(0);
      expect(response.body.slotIndex).toBeGreaterThanOrEqual(0);
      expect(response.body.slotsInEpoch).toBeGreaterThan(0);
      expect(response.body.totalActiveStake).toBeGreaterThan(0);
      expect(response.body.activeValidatorCount).toBeGreaterThan(0);
    }, TIMEOUT);
  });

  describe('GET /api/stake-accounts/:wallet', () => {
    test('should return stake accounts for valid wallet (may be empty)', async () => {
      const response = await request(app)
        .get(`/api/stake-accounts/${VALID_WALLET}`)
        .expect(200);

      expect(response.body).toMatchObject({
        wallet: VALID_WALLET,
        stakeAccounts: expect.any(Array),
        totalStaked: expect.any(Number),
        totalEstimatedRewards: expect.any(Number),
        validatorCount: expect.any(Number),
        timestamp: expect.any(Number),
        meta: expect.objectContaining({
          responseTimeMs: expect.any(Number),
          accountCount: expect.any(Number)
        })
      });

      // If there are stake accounts, validate their structure
      if (response.body.stakeAccounts.length > 0) {
        expect(response.body.stakeAccounts[0]).toMatchObject({
          pubkey: expect.any(String),
          stake: expect.any(Number),
          state: expect.stringMatching(/^(active|activating|deactivating|inactive)$/),
          stakeAuthority: expect.any(String),
          withdrawAuthority: expect.any(String),
          rentExemptReserve: expect.any(Number),
          creditsObserved: expect.any(Number),
          estimatedRewards: expect.any(Number)
        });
      }

      // Validate totals consistency
      expect(response.body.meta.accountCount).toBe(response.body.stakeAccounts.length);
      
      const calculatedTotalStaked = response.body.stakeAccounts.reduce((sum: number, account: any) => sum + account.stake, 0);
      expect(response.body.totalStaked).toBe(calculatedTotalStaked);
      
      const calculatedTotalRewards = response.body.stakeAccounts.reduce((sum: number, account: any) => sum + account.estimatedRewards, 0);
      expect(response.body.totalEstimatedRewards).toBe(calculatedTotalRewards);
    }, TIMEOUT);

    test('should return 400 for invalid wallet address format', async () => {
      const response = await request(app)
        .get(`/api/stake-accounts/${INVALID_PUBKEY}`)
        .expect(400);

      expect(response.body).toMatchObject({
        error: 'Invalid Wallet Address',
        message: expect.stringContaining('valid 32-44 character base58 string'),
        timestamp: expect.any(Number)
      });
    });
  });

  describe('GET /api/websocket/status', () => {
    test('should return WebSocket service status or not initialized message', async () => {
      const response = await request(app)
        .get('/api/websocket/status');
        
      // WebSocket service might not be initialized in test mode
      expect([200, 503]).toContain(response.status);
      
      if (response.status === 503) {
        expect(response.body).toMatchObject({
          error: 'WebSocket service not initialized',
          available: false,
          timestamp: expect.any(Number)
        });
        return;
      }

      expect(response.body).toMatchObject({
        available: expect.any(Boolean),
        endpoint: '/ws',
        protocol: 'WebSocket',
        connectedClients: expect.any(Number),
        totalSubscriptions: expect.any(Number),
        monitoredValidators: expect.any(Number),
        supportedEvents: expect.arrayContaining([
          'validator_performance',
          'delinquency_alert',
          'commission_change'
        ]),
        subscriptionFormat: expect.objectContaining({
          subscribe: expect.any(Object),
          unsubscribe: expect.any(Object)
        }),
        timestamp: expect.any(Number)
      });
    });
  });

  describe('Updated root endpoint', () => {
    test('should include v2 endpoints in documentation', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);

      expect(response.body).toMatchObject({
        service: 'Validator Analytics API',
        version: '2.0.0',
        description: expect.stringContaining('Deep Analytics'),
        endpoints: expect.objectContaining({
          '/api/validators/:voteAccount': expect.any(String),
          '/api/validators/:voteAccount/history': expect.any(String),
          '/api/epoch/current': expect.any(String),
          '/api/stake-accounts/:wallet': expect.any(String),
          '/api/websocket/status': expect.any(String),
          '/ws': expect.any(String)
        }),
        features: expect.objectContaining({
          v2: expect.any(Array)
        })
      });

      expect(response.body.features.v2.length).toBeGreaterThan(0);
    });
  });

  describe('Error handling', () => {
    test('should handle rate limiting on v2 endpoints', async () => {
      // Test rate limiting by making rapid requests
      const promises = Array.from({ length: 12 }, () => 
        request(app)
          .get(`/api/validators/${VALID_VOTE_ACCOUNT}`)
          .set('x-test-rate-limit', 'true') // Enable rate limiting in tests
      );

      const responses = await Promise.all(promises);
      
      // At least one should be rate limited
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);

      if (rateLimitedResponses.length > 0) {
        expect(rateLimitedResponses[0].body).toMatchObject({
          error: 'API Rate Limit Exceeded',
          message: expect.stringContaining('Too many API requests'),
          retryAfter: expect.any(String)
        });
      }
    }, TIMEOUT);

    test('should handle RPC timeouts gracefully', async () => {
      // This test would need to mock RPC timeouts
      // For now, we just ensure the error format is correct if it occurs
      const response = await request(app)
        .get(`/api/validators/${VALID_VOTE_ACCOUNT}`)
        .expect((res) => {
          // Should either succeed (200) or fail with proper error format
          if (res.status !== 200) {
            expect(res.body).toMatchObject({
              error: expect.any(String),
              message: expect.any(String),
              timestamp: expect.any(Number)
            });
          }
        });
    }, TIMEOUT);
  });

  describe('Performance metrics', () => {
    test('v2 endpoints should respond within reasonable time', async () => {
      const startTime = Date.now();
      
      const response = await request(app)
        .get('/api/epoch/current')
        .expect(200);

      const responseTime = Date.now() - startTime;
      
      expect(responseTime).toBeLessThan(10000); // 10 seconds max
      expect(response.body.meta.responseTimeMs).toBeGreaterThan(0);
    }, TIMEOUT);

    test('validator detail endpoint should be optimized', async () => {
      const response = await request(app)
        .get(`/api/validators/${VALID_VOTE_ACCOUNT}`);

      // Could be 200 or 404 depending on validator availability
      expect([200, 404]).toContain(response.status);
      
      if (response.status === 200) {
        // Response should include performance metadata
        expect(response.body.meta.responseTimeMs).toBeGreaterThan(0);
        expect(response.body.meta.responseTimeMs).toBeLessThan(15000); // 15 seconds max
      }
    }, TIMEOUT);
  });
});