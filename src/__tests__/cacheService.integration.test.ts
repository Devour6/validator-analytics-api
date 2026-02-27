/**
 * Cache Service Integration Tests
 * Tests for runtime Redis failures and recovery scenarios
 */

import { CacheService, CacheKeys } from '../services/cacheService';

describe('CacheService Integration Tests - Runtime Redis Failures', () => {
  let cacheService: CacheService;
  let mockRedisClient: any;

  beforeEach(() => {
    // Create mock Redis client with all required methods
    mockRedisClient = {
      connect: jest.fn(),
      disconnect: jest.fn(),
      get: jest.fn(),
      setEx: jest.fn(),
      del: jest.fn(),
      keys: jest.fn(),
      flushDb: jest.fn(),
      info: jest.fn(),
      on: jest.fn()
    };

    // Mock redis module
    jest.doMock('redis', () => ({
      createClient: jest.fn(() => mockRedisClient)
    }));

    cacheService = new CacheService({
      redisUrl: 'redis://localhost:6379',
      enableInMemoryFallback: true
    });
  });

  afterEach(async () => {
    await cacheService.disconnect();
    jest.clearAllMocks();
    jest.dontMock('redis');
  });

  describe('Runtime Redis Failures After Successful Connection', () => {
    beforeEach(async () => {
      // Simulate successful initial connection
      mockRedisClient.connect.mockResolvedValue(undefined);
      await cacheService.initialize();
      
      // Manually set Redis as connected to simulate successful initialization
      (cacheService as any).isRedisConnected = true;
    });

    it('should handle Redis going down during get operation', async () => {
      // Set some data in memory cache as fallback
      await cacheService.set(CacheKeys.VALIDATORS, { test: 'data' });
      
      // Simulate Redis failure during get operation
      mockRedisClient.get.mockRejectedValue(new Error('ECONNREFUSED: Redis server down'));
      
      // Should gracefully fallback to memory cache
      const result = await cacheService.get(CacheKeys.VALIDATORS);
      
      expect(result).toEqual({ test: 'data' });
      
      // Should mark Redis as disconnected
      const stats = await cacheService.getStats();
      expect(stats.redisConnected).toBe(false);
    });

    it('should handle Redis going down during set operation', async () => {
      // Simulate Redis failure during set operation
      mockRedisClient.setEx.mockRejectedValue(new Error('ECONNREFUSED: Redis server down'));
      
      const testData = { test: 'runtime_failure' };
      
      // Should not throw and continue with memory cache
      await expect(cacheService.set(CacheKeys.VALIDATORS, testData)).resolves.not.toThrow();
      
      // Should still be able to get from memory cache
      const result = await cacheService.get(CacheKeys.VALIDATORS);
      expect(result).toEqual(testData);
      
      // Should mark Redis as disconnected
      const stats = await cacheService.getStats();
      expect(stats.redisConnected).toBe(false);
    });

    it('should handle Redis going down during delete operation', async () => {
      // Set some data first
      await cacheService.set(CacheKeys.VALIDATORS, { test: 'data' });
      
      // Simulate Redis failure during delete operation
      mockRedisClient.del.mockRejectedValue(new Error('ECONNREFUSED: Redis server down'));
      
      // Should not throw
      await expect(cacheService.delete(CacheKeys.VALIDATORS)).resolves.not.toThrow();
      
      // Should mark Redis as disconnected
      const stats = await cacheService.getStats();
      expect(stats.redisConnected).toBe(false);
    });

    it('should handle Redis going down during flush operation', async () => {
      // Simulate Redis failure during flush operation
      mockRedisClient.flushDb.mockRejectedValue(new Error('ECONNREFUSED: Redis server down'));
      
      // Should not throw
      await expect(cacheService.flush()).resolves.not.toThrow();
      
      // Should mark Redis as disconnected
      const stats = await cacheService.getStats();
      expect(stats.redisConnected).toBe(false);
    });

    it('should handle Redis going down during stats collection', async () => {
      // Simulate Redis failure during stats operation
      mockRedisClient.keys.mockRejectedValue(new Error('ECONNREFUSED: Redis server down'));
      mockRedisClient.info.mockRejectedValue(new Error('ECONNREFUSED: Redis server down'));
      
      // Should still return stats object without throwing
      const stats = await cacheService.getStats();
      
      expect(stats).toHaveProperty('hits');
      expect(stats).toHaveProperty('misses');
      expect(stats).toHaveProperty('hitRate');
      expect(stats.redisConnected).toBe(false);
    });

    it('should handle intermittent Redis failures with recovery', async () => {
      const testData = { test: 'recovery_data' };
      
      // First operation succeeds
      mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(testData));
      let result = await cacheService.get(CacheKeys.VALIDATORS);
      expect(result).toEqual(testData);
      
      // Redis fails temporarily
      mockRedisClient.get.mockRejectedValueOnce(new Error('ECONNREFUSED: Temporary failure'));
      
      // Set some fallback data in memory
      await cacheService.set(CacheKeys.VALIDATORS, { test: 'fallback_data' });
      
      // Should get fallback data during failure
      result = await cacheService.get(CacheKeys.VALIDATORS);
      expect(result).toEqual({ test: 'fallback_data' });
      
      // Redis recovers - simulate reconnection
      (cacheService as any).isRedisConnected = true;
      mockRedisClient.get.mockResolvedValueOnce(JSON.stringify({ test: 'recovered_data' }));
      
      // Should get data from Redis again after recovery
      result = await cacheService.get(CacheKeys.VALIDATORS);
      expect(result).toEqual({ test: 'recovered_data' });
    });

    it('should handle Redis going down during cache-or-fetch operation', async () => {
      // Simulate Redis failure during cache lookup
      mockRedisClient.get.mockRejectedValue(new Error('ECONNREFUSED: Redis server down'));
      
      const fetchFunction = jest.fn().mockResolvedValue({ fetched: 'data' });
      
      // Should fallback to fetch function and continue working
      const result = await cacheService.cacheOrFetch(
        CacheKeys.VALIDATORS,
        fetchFunction
      );
      
      expect(result).toEqual({ fetched: 'data' });
      expect(fetchFunction).toHaveBeenCalled();
      
      // Should mark Redis as disconnected
      const stats = await cacheService.getStats();
      expect(stats.redisConnected).toBe(false);
    });

    it('should handle Redis timeout scenarios', async () => {
      // Simulate timeout error
      mockRedisClient.get.mockRejectedValue(new Error('ETIMEDOUT: Operation timed out'));
      
      // Set fallback data in memory
      await cacheService.set(CacheKeys.EPOCH_INFO, { epoch: 123 });
      
      // Should gracefully fallback to memory cache on timeout
      const result = await cacheService.get(CacheKeys.EPOCH_INFO);
      expect(result).toEqual({ epoch: 123 });
      
      // Should mark Redis as disconnected
      const stats = await cacheService.getStats();
      expect(stats.redisConnected).toBe(false);
    });

    it('should handle Redis authentication failures at runtime', async () => {
      // Simulate auth failure
      mockRedisClient.get.mockRejectedValue(new Error('NOAUTH: Authentication required'));
      
      // Set fallback data in memory
      await cacheService.set(CacheKeys.NETWORK_STATS, { validators: 100 });
      
      // Should gracefully fallback to memory cache on auth failure
      const result = await cacheService.get(CacheKeys.NETWORK_STATS);
      expect(result).toEqual({ validators: 100 });
      
      // Should mark Redis as disconnected
      const stats = await cacheService.getStats();
      expect(stats.redisConnected).toBe(false);
    });

    it('should handle Redis memory full scenarios', async () => {
      // Simulate out of memory error
      mockRedisClient.setEx.mockRejectedValue(new Error('OOM: command not allowed when used memory > maxmemory'));
      
      const testData = { test: 'memory_full_data' };
      
      // Should continue operation with memory cache only
      await expect(cacheService.set(CacheKeys.VALIDATORS, testData)).resolves.not.toThrow();
      
      // Should still be able to retrieve from memory cache
      const result = await cacheService.get(CacheKeys.VALIDATORS);
      expect(result).toEqual(testData);
      
      // Should mark Redis as disconnected
      const stats = await cacheService.getStats();
      expect(stats.redisConnected).toBe(false);
    });
  });

  describe('Recovery Scenarios', () => {
    it('should continue working with memory cache after Redis fails', async () => {
      // Initialize successfully
      mockRedisClient.connect.mockResolvedValue(undefined);
      await cacheService.initialize();
      (cacheService as any).isRedisConnected = true;
      
      // Set initial data while Redis is working
      mockRedisClient.setEx.mockResolvedValue('OK');
      await cacheService.set(CacheKeys.VALIDATORS, { initial: 'data' });
      
      // Redis fails
      mockRedisClient.get.mockRejectedValue(new Error('Connection lost'));
      mockRedisClient.setEx.mockRejectedValue(new Error('Connection lost'));
      
      // Set new data - should work with memory cache
      await cacheService.set(CacheKeys.VALIDATORS, { updated: 'data' });
      
      // Get data - should work with memory cache
      const result = await cacheService.get(CacheKeys.VALIDATORS);
      expect(result).toEqual({ updated: 'data' });
      
      // Cache service should still be functional
      const stats = await cacheService.getStats();
      expect(stats.redisConnected).toBe(false);
      expect(stats.keys).toBeGreaterThan(0);
    });

    it('should handle memory cache cleanup during Redis failures', async () => {
      // Initialize with memory cache
      await cacheService.initialize();
      
      // Set data with very short TTL
      await cacheService.set(CacheKeys.VALIDATORS, { test: 'data' }, undefined, 1);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Should return null for expired data
      const result = await cacheService.get(CacheKeys.VALIDATORS);
      expect(result).toBeNull();
    });
  });

  describe('Error Message Consistency', () => {
    beforeEach(async () => {
      mockRedisClient.connect.mockResolvedValue(undefined);
      await cacheService.initialize();
      (cacheService as any).isRedisConnected = true;
    });

    it('should maintain consistent error handling across all operations', async () => {
      const errorTypes = [
        new Error('ECONNREFUSED: Connection refused'),
        new Error('ETIMEDOUT: Operation timed out'),
        new Error('NOAUTH: Authentication required'),
        new Error('READONLY: You can\'t write against a read only replica'),
        new Error('OOM: command not allowed when used memory > maxmemory')
      ];

      for (const error of errorTypes) {
        // Reset mocks
        jest.clearAllMocks();
        
        // Make Redis operations fail with this error type
        mockRedisClient.get.mockRejectedValue(error);
        mockRedisClient.setEx.mockRejectedValue(error);
        mockRedisClient.del.mockRejectedValue(error);
        
        // All operations should handle the error gracefully
        await expect(cacheService.get(CacheKeys.VALIDATORS)).resolves.toBeDefined();
        await expect(cacheService.set(CacheKeys.VALIDATORS, { test: 'data' })).resolves.not.toThrow();
        await expect(cacheService.delete(CacheKeys.VALIDATORS)).resolves.not.toThrow();
        
        // Redis should be marked as disconnected after each error
        const stats = await cacheService.getStats();
        expect(stats.redisConnected).toBe(false);
        
        // Reset connection status for next test
        (cacheService as any).isRedisConnected = true;
      }
    });
  });
});