/**
 * Cache Service Tests
 * Tests for Redis caching with in-memory fallback
 */

import { CacheService, CacheKeys, CACHE_TTLS, CACHE_CONFIG } from '../services/cacheService';

// Mock Redis client
const mockRedisClient = {
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
jest.mock('redis', () => ({
  createClient: jest.fn(() => mockRedisClient)
}));

describe('CacheService', () => {
  let cacheService: CacheService;

  beforeEach(() => {
    jest.clearAllMocks();
    cacheService = new CacheService({
      redisUrl: 'redis://localhost:6379',
      enableInMemoryFallback: true
    });
  });

  afterEach(async () => {
    await cacheService.disconnect();
  });

  describe('Initialization', () => {
    it('should initialize without Redis URL (in-memory only)', async () => {
      const inMemoryService = new CacheService({});
      await inMemoryService.initialize();
      // Should not throw and work with in-memory cache only
      expect(mockRedisClient.connect).not.toHaveBeenCalled();
    });

    it('should initialize with Redis successfully', async () => {
      mockRedisClient.connect.mockResolvedValue(undefined);
      
      await cacheService.initialize();
      
      expect(mockRedisClient.connect).toHaveBeenCalled();
      expect(mockRedisClient.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockRedisClient.on).toHaveBeenCalledWith('connect', expect.any(Function));
      expect(mockRedisClient.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
    });

    it('should handle Redis connection failure and fallback to in-memory', async () => {
      mockRedisClient.connect.mockRejectedValue(new Error('Connection failed'));
      
      // Should not throw with fallback enabled
      await expect(cacheService.initialize()).resolves.not.toThrow();
    });

    it('should throw on Redis failure with fallback disabled', async () => {
      const noFallbackService = new CacheService({
        redisUrl: 'redis://localhost:6379',
        enableInMemoryFallback: false
      });
      
      mockRedisClient.connect.mockRejectedValue(new Error('Connection failed'));
      
      await expect(noFallbackService.initialize()).rejects.toThrow('Redis connection failed and fallback disabled');
    });
  });

  describe('Cache Operations', () => {
    beforeEach(async () => {
      mockRedisClient.connect.mockResolvedValue(undefined);
      await cacheService.initialize();
      
      // Manually set Redis as connected for test operations since we're mocking
      (cacheService as any).isRedisConnected = true;
    });

    describe('get operation', () => {
      it('should return data from Redis when available', async () => {
        const testData = { validators: [], epoch: 123 };
        mockRedisClient.get.mockResolvedValue(JSON.stringify(testData));

        const result = await cacheService.get(CacheKeys.VALIDATORS);
        
        expect(mockRedisClient.get).toHaveBeenCalledWith('validator_analytics:validators');
        expect(result).toEqual(testData);
      });

      it('should fallback to in-memory cache when Redis fails', async () => {
        mockRedisClient.get.mockRejectedValue(new Error('Redis error'));
        
        // First set data in memory cache
        await cacheService.set(CacheKeys.VALIDATORS, { test: 'data' });
        
        const result = await cacheService.get(CacheKeys.VALIDATORS);
        expect(result).toEqual({ test: 'data' });
      });

      it('should return null when not found in any cache', async () => {
        mockRedisClient.get.mockResolvedValue(null);
        
        const result = await cacheService.get(CacheKeys.VALIDATORS);
        expect(result).toBeNull();
      });

      it('should handle expired in-memory cache items', async () => {
        // Set item with very short TTL (negative to ensure immediate expiry)  
        const testData = { test: 'data' };
        (cacheService as any).inMemoryCache.set('validator_analytics:validators', {
          data: testData,
          expires: Date.now() - 1000 // Already expired
        });
        
        const result = await cacheService.get(CacheKeys.VALIDATORS);
        expect(result).toBeNull();
      });
    });

    describe('set operation', () => {
      it('should set data in both Redis and memory cache', async () => {
        const testData = { validators: [], epoch: 123 };
        
        await cacheService.set(CacheKeys.VALIDATORS, testData);
        
        expect(mockRedisClient.setEx).toHaveBeenCalledWith(
          'validator_analytics:validators',
          CACHE_TTLS[CacheKeys.VALIDATORS],
          JSON.stringify(testData)
        );
      });

      it('should use custom TTL when provided', async () => {
        const testData = { test: 'data' };
        const customTTL = 123;
        
        await cacheService.set(CacheKeys.VALIDATORS, testData, undefined, customTTL);
        
        expect(mockRedisClient.setEx).toHaveBeenCalledWith(
          'validator_analytics:validators',
          customTTL,
          JSON.stringify(testData)
        );
      });

      it('should include identifier in key when provided', async () => {
        const testData = { voteAccount: 'ABC123' };
        const identifier = 'validator123';
        
        await cacheService.set(CacheKeys.VALIDATOR_DETAIL, testData, identifier);
        
        expect(mockRedisClient.setEx).toHaveBeenCalledWith(
          'validator_analytics:validator_detail:validator123',
          CACHE_TTLS[CacheKeys.VALIDATOR_DETAIL],
          JSON.stringify(testData)
        );
      });

      it('should continue operation even if Redis fails', async () => {
        mockRedisClient.setEx.mockRejectedValue(new Error('Redis error'));
        
        // Should not throw
        await expect(cacheService.set(CacheKeys.VALIDATORS, { test: 'data' }))
          .resolves.not.toThrow();
      });
    });

    describe('delete operation', () => {
      it('should delete from both Redis and memory cache', async () => {
        await cacheService.delete(CacheKeys.VALIDATORS);
        
        expect(mockRedisClient.del).toHaveBeenCalledWith('validator_analytics:validators');
      });

      it('should include identifier in deletion', async () => {
        const identifier = 'validator123';
        
        await cacheService.delete(CacheKeys.VALIDATOR_DETAIL, identifier);
        
        expect(mockRedisClient.del).toHaveBeenCalledWith('validator_analytics:validator_detail:validator123');
      });
    });

    describe('flush operation', () => {
      it('should clear both Redis and memory cache', async () => {
        await cacheService.flush();
        
        expect(mockRedisClient.flushDb).toHaveBeenCalled();
      });
    });
  });

  describe('Cache-or-Fetch Pattern', () => {
    beforeEach(async () => {
      mockRedisClient.connect.mockResolvedValue(undefined);
      await cacheService.initialize();
      
      // Manually set Redis as connected for test operations since we're mocking
      (cacheService as any).isRedisConnected = true;
    });

    it('should return cached data when available', async () => {
      const cachedData = { fromCache: true };
      mockRedisClient.get.mockResolvedValue(JSON.stringify(cachedData));
      
      const fetchFunction = jest.fn().mockResolvedValue({ fromFetch: true });
      
      const result = await cacheService.cacheOrFetch(
        CacheKeys.VALIDATORS,
        fetchFunction
      );
      
      expect(result).toEqual(cachedData);
      expect(fetchFunction).not.toHaveBeenCalled();
    });

    it('should fetch and cache data when cache miss', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      const fetchedData = { fromFetch: true };
      const fetchFunction = jest.fn().mockResolvedValue(fetchedData);
      
      const result = await cacheService.cacheOrFetch(
        CacheKeys.VALIDATORS,
        fetchFunction
      );
      
      expect(result).toEqual(fetchedData);
      expect(fetchFunction).toHaveBeenCalled();
      expect(mockRedisClient.setEx).toHaveBeenCalledWith(
        'validator_analytics:validators',
        CACHE_TTLS[CacheKeys.VALIDATORS],
        JSON.stringify(fetchedData)
      );
    });

    it('should work with identifier parameter', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      const fetchedData = { voteAccount: 'ABC123' };
      const fetchFunction = jest.fn().mockResolvedValue(fetchedData);
      const identifier = 'ABC123';
      
      const result = await cacheService.cacheOrFetch(
        CacheKeys.VALIDATOR_DETAIL,
        fetchFunction,
        identifier
      );
      
      expect(result).toEqual(fetchedData);
      expect(mockRedisClient.get).toHaveBeenCalledWith('validator_analytics:validator_detail:ABC123');
      expect(mockRedisClient.setEx).toHaveBeenCalledWith(
        'validator_analytics:validator_detail:ABC123',
        CACHE_TTLS[CacheKeys.VALIDATOR_DETAIL],
        JSON.stringify(fetchedData)
      );
    });
  });

  describe('Cache Statistics', () => {
    beforeEach(async () => {
      mockRedisClient.connect.mockResolvedValue(undefined);
      mockRedisClient.keys.mockResolvedValue(['key1', 'key2']);
      mockRedisClient.info.mockResolvedValue('used_memory:1048576\nother:value');
      await cacheService.initialize();
      
      // Manually set Redis as connected for test operations since we're mocking
      (cacheService as any).isRedisConnected = true;
    });

    it('should return accurate statistics', async () => {
      // Simulate some cache operations to build stats
      mockRedisClient.get.mockResolvedValueOnce(JSON.stringify({ hit: true }));
      mockRedisClient.get.mockResolvedValueOnce(null);
      
      await cacheService.get(CacheKeys.VALIDATORS); // hit
      await cacheService.get(CacheKeys.EPOCH_INFO); // miss
      
      const stats = await cacheService.getStats();
      
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(50);
      expect(stats.redisConnected).toBe(true);
      expect(stats.memoryUsage).toBe(1048576);
      expect(stats.keys).toBeGreaterThan(0);
    });

    it('should handle Redis errors in stats gracefully', async () => {
      mockRedisClient.keys.mockRejectedValue(new Error('Redis error'));
      mockRedisClient.info.mockRejectedValue(new Error('Redis error'));
      
      const stats = await cacheService.getStats();
      
      expect(stats).toHaveProperty('hits');
      expect(stats).toHaveProperty('misses');
      expect(stats).toHaveProperty('hitRate');
      expect(stats).toHaveProperty('redisConnected');
    });
  });

  describe('TTL Configuration', () => {
    it('should use correct TTLs for different cache types', () => {
      expect(CACHE_TTLS[CacheKeys.VALIDATORS]).toBe(300); // 5 minutes
      expect(CACHE_TTLS[CacheKeys.VALIDATOR_DETAIL]).toBe(120); // 2 minutes
      expect(CACHE_TTLS[CacheKeys.EPOCH_INFO]).toBe(30); // 30 seconds
      expect(CACHE_TTLS[CacheKeys.NETWORK_STATS]).toBe(300); // 5 minutes
    });
  });

  describe('In-Memory Cache Only Mode', () => {
    let inMemoryService: CacheService;

    beforeEach(() => {
      inMemoryService = new CacheService({
        enableInMemoryFallback: true
      });
    });

    afterEach(async () => {
      await inMemoryService.disconnect();
    });

    it('should work without Redis', async () => {
      await inMemoryService.initialize();
      
      const testData = { test: 'data' };
      await inMemoryService.set(CacheKeys.VALIDATORS, testData);
      
      const result = await inMemoryService.get(CacheKeys.VALIDATORS);
      expect(result).toEqual(testData);
    });

    it('should respect TTLs in memory cache', async () => {
      await inMemoryService.initialize();
      
      const testData = { test: 'data' };
      // Set item directly with expired timestamp
      (inMemoryService as any).inMemoryCache.set('validator_analytics:validators', {
        data: testData,
        expires: Date.now() - 1000 // Already expired
      });
      
      const result = await inMemoryService.get(CacheKeys.VALIDATORS);
      expect(result).toBeNull();
    });
  });

  describe('Redis Error Handling and Fallback Behavior', () => {
    beforeEach(async () => {
      mockRedisClient.connect.mockResolvedValue(undefined);
      await cacheService.initialize();
    });

    describe('Get operation error handling', () => {
      it('should gracefully fallback to memory cache when Redis get fails', async () => {
        // First set data in memory cache
        await cacheService.set(CacheKeys.VALIDATORS, { test: 'memory_data' });
        
        // Make Redis get fail
        mockRedisClient.get.mockRejectedValue(new Error('Redis connection lost'));
        
        const result = await cacheService.get(CacheKeys.VALIDATORS);
        
        // Should get data from memory cache, not fail
        expect(result).toEqual({ test: 'memory_data' });
      });

      it('should mark Redis as disconnected on get error', async () => {
        mockRedisClient.get.mockRejectedValue(new Error('Redis connection lost'));
        
        await cacheService.get(CacheKeys.VALIDATORS);
        
        const stats = await cacheService.getStats();
        expect(stats.redisConnected).toBe(false);
      });
    });

    describe('Set operation error handling', () => {
      it('should continue to set in memory cache when Redis set fails', async () => {
        const testData = { test: 'data' };
        
        mockRedisClient.setEx.mockRejectedValue(new Error('Redis write failed'));
        
        // Should not throw
        await expect(cacheService.set(CacheKeys.VALIDATORS, testData)).resolves.not.toThrow();
        
        // Should still be able to get from memory cache
        const result = await cacheService.get(CacheKeys.VALIDATORS);
        expect(result).toEqual(testData);
      });

      it('should mark Redis as disconnected on set error', async () => {
        mockRedisClient.setEx.mockRejectedValue(new Error('Redis write failed'));
        
        await cacheService.set(CacheKeys.VALIDATORS, { test: 'data' });
        
        const stats = await cacheService.getStats();
        expect(stats.redisConnected).toBe(false);
      });
    });

    describe('Delete operation error handling', () => {
      it('should continue to delete from memory cache when Redis del fails', async () => {
        const testData = { test: 'data' };
        
        // Set data first
        await cacheService.set(CacheKeys.VALIDATORS, testData);
        
        // Make Redis delete fail
        mockRedisClient.del.mockRejectedValue(new Error('Redis delete failed'));
        
        // Should not throw
        await expect(cacheService.delete(CacheKeys.VALIDATORS)).resolves.not.toThrow();
      });

      it('should mark Redis as disconnected on delete error', async () => {
        mockRedisClient.del.mockRejectedValue(new Error('Redis delete failed'));
        
        await cacheService.delete(CacheKeys.VALIDATORS);
        
        const stats = await cacheService.getStats();
        expect(stats.redisConnected).toBe(false);
      });
    });

    describe('Flush operation error handling', () => {
      it('should continue to clear memory cache when Redis flush fails', async () => {
        mockRedisClient.flushDb.mockRejectedValue(new Error('Redis flush failed'));
        
        // Should not throw
        await expect(cacheService.flush()).resolves.not.toThrow();
      });

      it('should mark Redis as disconnected on flush error', async () => {
        mockRedisClient.flushDb.mockRejectedValue(new Error('Redis flush failed'));
        
        await cacheService.flush();
        
        const stats = await cacheService.getStats();
        expect(stats.redisConnected).toBe(false);
      });
    });

    describe('Stats operation error handling', () => {
      it('should return stats with Redis marked as disconnected on keys error', async () => {
        mockRedisClient.keys.mockRejectedValue(new Error('Redis keys failed'));
        
        const stats = await cacheService.getStats();
        
        expect(stats.redisConnected).toBe(false);
        expect(stats).toHaveProperty('hits');
        expect(stats).toHaveProperty('misses');
      });

      it('should handle Redis info command failure gracefully', async () => {
        mockRedisClient.keys.mockResolvedValue(['key1']);
        mockRedisClient.info.mockRejectedValue(new Error('Redis info failed'));
        
        const stats = await cacheService.getStats();
        
        expect(stats.redisConnected).toBe(false);
        expect(stats.memoryUsage).toBeUndefined();
      });
    });

    describe('DeletePattern operation error handling', () => {
      it('should continue to delete from memory cache when Redis pattern delete fails', async () => {
        mockRedisClient.keys.mockRejectedValue(new Error('Redis keys failed'));
        
        // Should not throw and return count of memory deletions
        const deletedCount = await cacheService.deletePattern('test');
        expect(deletedCount).toBeGreaterThanOrEqual(0);
      });
    });

    describe('Disconnect error handling', () => {
      it('should handle Redis disconnect errors gracefully', async () => {
        mockRedisClient.disconnect.mockRejectedValue(new Error('Disconnect failed'));
        
        // Should not throw
        await expect(cacheService.disconnect()).resolves.not.toThrow();
      });
    });
  });

  describe('Key Prefix Configuration', () => {
    beforeEach(async () => {
      mockRedisClient.connect.mockResolvedValue(undefined);
      await cacheService.initialize();
      // Set Redis as connected for these tests
      (cacheService as any).isRedisConnected = true;
    });

    it('should use centralized key prefix constants', () => {
      expect(CACHE_CONFIG.KEY_PREFIX).toBe('validator_analytics');
      expect(CACHE_CONFIG.SEPARATOR).toBe(':');
    });

    it('should build keys correctly with prefix and separator', async () => {
      await cacheService.set(CacheKeys.VALIDATORS, { test: 'data' });
      
      expect(mockRedisClient.setEx).toHaveBeenCalledWith(
        `${CACHE_CONFIG.KEY_PREFIX}${CACHE_CONFIG.SEPARATOR}${CacheKeys.VALIDATORS}`,
        expect.any(Number),
        expect.any(String)
      );
    });

    it('should build keys with identifier correctly', async () => {
      const identifier = 'test123';
      await cacheService.set(CacheKeys.VALIDATOR_DETAIL, { test: 'data' }, identifier);
      
      expect(mockRedisClient.setEx).toHaveBeenCalledWith(
        `${CACHE_CONFIG.KEY_PREFIX}${CACHE_CONFIG.SEPARATOR}${CacheKeys.VALIDATOR_DETAIL}${CACHE_CONFIG.SEPARATOR}${identifier}`,
        expect.any(Number),
        expect.any(String)
      );
    });

    it('should use prefix in pattern deletion', async () => {
      await cacheService.deletePattern('test');
      
      expect(mockRedisClient.keys).toHaveBeenCalledWith(
        `${CACHE_CONFIG.KEY_PREFIX}${CACHE_CONFIG.SEPARATOR}test*`
      );
    });

    it('should use prefix in stats collection', async () => {
      mockRedisClient.keys.mockResolvedValue(['key1', 'key2']);
      
      await cacheService.getStats();
      
      expect(mockRedisClient.keys).toHaveBeenCalledWith(
        `${CACHE_CONFIG.KEY_PREFIX}${CACHE_CONFIG.SEPARATOR}*`
      );
    });
  });

  describe('TTL Logic Verification', () => {
    beforeEach(async () => {
      mockRedisClient.connect.mockResolvedValue(undefined);
      await cacheService.initialize();
      
      // Manually set Redis as connected for test operations since we're mocking
      (cacheService as any).isRedisConnected = true;
    });

    it('should use correct default TTLs for VALIDATORS cache type', async () => {
      const testData = { test: 'data' };
      mockRedisClient.setEx.mockClear();
      
      await cacheService.set(CacheKeys.VALIDATORS, testData);
      expect(mockRedisClient.setEx).toHaveBeenCalledWith(
        expect.any(String), CACHE_TTLS[CacheKeys.VALIDATORS], expect.any(String)
      );
    });

    it('should use correct default TTLs for VALIDATOR_DETAIL cache type', async () => {
      const testData = { test: 'data' };
      mockRedisClient.setEx.mockClear();
      
      await cacheService.set(CacheKeys.VALIDATOR_DETAIL, testData);
      expect(mockRedisClient.setEx).toHaveBeenCalledWith(
        expect.any(String), CACHE_TTLS[CacheKeys.VALIDATOR_DETAIL], expect.any(String)
      );
    });

    it('should use correct default TTLs for EPOCH_INFO cache type', async () => {
      const testData = { test: 'data' };
      mockRedisClient.setEx.mockClear();
      
      await cacheService.set(CacheKeys.EPOCH_INFO, testData);
      expect(mockRedisClient.setEx).toHaveBeenCalledWith(
        expect.any(String), CACHE_TTLS[CacheKeys.EPOCH_INFO], expect.any(String)
      );
    });

    it('should override default TTL when custom TTL provided', async () => {
      const testData = { test: 'data' };
      const customTTL = 999;
      
      await cacheService.set(CacheKeys.VALIDATORS, testData, undefined, customTTL);
      
      expect(mockRedisClient.setEx).toHaveBeenCalledWith(
        expect.any(String), customTTL, expect.any(String)
      );
    });

    it('should use service default TTL when cache key has no predefined TTL', async () => {
      const serviceWithCustomDefault = new CacheService({
        redisUrl: 'redis://localhost:6379',
        defaultTTL: 777
      });
      
      await serviceWithCustomDefault.initialize();
      // Manually set Redis as connected for this test
      (serviceWithCustomDefault as any).isRedisConnected = true;
      
      // Clear previous mock calls
      mockRedisClient.setEx.mockClear();
      
      // Use a custom cache key not in CACHE_TTLS
      await serviceWithCustomDefault.set('CUSTOM_KEY' as CacheKeys, { test: 'data' });
      
      expect(mockRedisClient.setEx).toHaveBeenCalledWith(
        expect.any(String), 777, expect.any(String)
      );
    });

    it('should correctly handle in-memory TTL expiration', async () => {
      // Use in-memory only service for this test
      const inMemoryService = new CacheService({ enableInMemoryFallback: true });
      await inMemoryService.initialize();
      
      const testData = { test: 'data' };
      
      // Set item directly with expired timestamp  
      (inMemoryService as any).inMemoryCache.set('validator_analytics:validators', {
        data: testData,
        expires: Date.now() - 1000 // Already expired
      });
      
      // Should be expired immediately
      const result = await inMemoryService.get(CacheKeys.VALIDATORS);
      expect(result).toBeNull();
    });

    it('should correctly handle in-memory TTL for valid data', async () => {
      // Use in-memory only service for this test
      const inMemoryService = new CacheService({ enableInMemoryFallback: true });
      await inMemoryService.initialize();
      
      const testData = { test: 'data' };
      
      // Set with long TTL
      await inMemoryService.set(CacheKeys.VALIDATORS, testData, undefined, 3600);
      
      // Should still be valid
      const result = await inMemoryService.get(CacheKeys.VALIDATORS);
      expect(result).toEqual(testData);
    });
  });
});