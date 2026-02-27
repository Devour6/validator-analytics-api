/**
 * Cache Service
 * Provides Redis-based caching with in-memory fallback for RPC call optimization
 */

import { createClient, RedisClientType } from 'redis';
import { logger } from '../utils/logger';

/**
 * Cache key configuration constants
 */
export const CACHE_CONFIG = {
  KEY_PREFIX: 'validator_analytics',
  SEPARATOR: ':',
} as const;

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  keys: number;
  memoryUsage?: number;
  redisConnected: boolean;
}

export interface CacheConfig {
  redisUrl?: string;
  defaultTTL?: number;
  enableInMemoryFallback?: boolean;
}

export enum CacheKeys {
  VALIDATORS = 'validators',
  VALIDATOR_DETAIL = 'validator_detail',
  EPOCH_INFO = 'epoch_info',
  NETWORK_STATS = 'network_stats',
  VALIDATOR_HISTORY = 'validator_history',
  WALLET_STAKE_ACCOUNTS = 'wallet_stake_accounts'
}

export interface CacheTTLs {
  [CacheKeys.VALIDATORS]: number;
  [CacheKeys.VALIDATOR_DETAIL]: number;
  [CacheKeys.EPOCH_INFO]: number;
  [CacheKeys.NETWORK_STATS]: number;
  [CacheKeys.VALIDATOR_HISTORY]: number;
  [CacheKeys.WALLET_STAKE_ACCOUNTS]: number;
}

// Load TTLs from environment variables with fallback defaults
export const CACHE_TTLS: CacheTTLs = {
  [CacheKeys.VALIDATORS]: parseInt(process.env.CACHE_TTL_VALIDATORS || '300'), // 5 minutes default
  [CacheKeys.VALIDATOR_DETAIL]: parseInt(process.env.CACHE_TTL_VALIDATOR_DETAIL || '120'), // 2 minutes default
  [CacheKeys.EPOCH_INFO]: parseInt(process.env.CACHE_TTL_EPOCH || '30'), // 30 seconds default
  [CacheKeys.NETWORK_STATS]: parseInt(process.env.CACHE_TTL_NETWORK_STATS || '300'), // 5 minutes default
  [CacheKeys.VALIDATOR_HISTORY]: parseInt(process.env.CACHE_TTL_VALIDATOR_HISTORY || '600'), // 10 minutes default
  [CacheKeys.WALLET_STAKE_ACCOUNTS]: parseInt(process.env.CACHE_TTL_WALLET_STAKE_ACCOUNTS || '180'), // 3 minutes default
};

interface CacheItem<T> {
  data: T;
  expires: number;
}

export class CacheService {
  private redisClient: RedisClientType | null = null;
  private inMemoryCache: Map<string, CacheItem<any>> = new Map();
  private stats: { hits: number; misses: number } = { hits: 0, misses: 0 };
  private isRedisConnected = false;
  private config: CacheConfig;
  
  constructor(config: CacheConfig = {}) {
    this.config = {
      enableInMemoryFallback: true,
      defaultTTL: 60,
      ...config
    };
  }

  /**
   * Initialize Redis connection
   */
  async initialize(): Promise<void> {
    if (!this.config.redisUrl) {
      logger.info('No Redis URL provided, using in-memory cache only', { 
        component: 'CacheService', 
        operation: 'initialize' 
      });
      return;
    }

    try {
      this.redisClient = createClient({
        url: this.config.redisUrl,
        socket: {
          connectTimeout: 5000
        }
      });

      this.redisClient.on('error', (error) => {
        logger.error('Redis connection error', { 
          component: 'CacheService', 
          operation: 'redis_connection', 
          error 
        });
        this.isRedisConnected = false;
      });

      this.redisClient.on('connect', () => {
        logger.info('Redis connected successfully', { 
          component: 'CacheService', 
          operation: 'redis_connect' 
        });
        this.isRedisConnected = true;
      });

      this.redisClient.on('disconnect', () => {
        logger.info('Redis disconnected', { 
          component: 'CacheService', 
          operation: 'redis_disconnect' 
        });
        this.isRedisConnected = false;
      });

      await this.redisClient.connect();
      this.isRedisConnected = true;
      logger.info('Cache service initialized with Redis', { 
        component: 'CacheService', 
        operation: 'initialize' 
      });
    } catch (error) {
      logger.error('Failed to initialize Redis', { 
        component: 'CacheService', 
        operation: 'initialize', 
        error: error instanceof Error ? error : new Error(String(error))
      });
      
      this.redisClient = null;
      this.isRedisConnected = false;
      
      if (this.config.enableInMemoryFallback) {
        logger.info('Falling back to in-memory cache', { 
          component: 'CacheService', 
          operation: 'fallback' 
        });
      } else {
        const errorMessage = `Redis connection failed and fallback disabled: ${error instanceof Error ? error.message : String(error)}`;
        logger.error(errorMessage, { 
          component: 'CacheService', 
          operation: 'initialize', 
          error: error instanceof Error ? error : new Error(String(error))
        });
        throw new Error(errorMessage);
      }
    }
  }

  /**
   * Build cache key with prefix
   */
  private buildKey(keyType: CacheKeys, identifier?: string): string {
    const baseKey = `${CACHE_CONFIG.KEY_PREFIX}${CACHE_CONFIG.SEPARATOR}${keyType}`;
    return identifier ? `${baseKey}${CACHE_CONFIG.SEPARATOR}${identifier}` : baseKey;
  }

  /**
   * Get from cache with type safety
   * @param keyType Cache key type from CacheKeys enum
   * @param identifier Optional identifier to append to the key
   * @returns Cached data or null if not found/error occurred
   */
  async get<T>(keyType: CacheKeys, identifier?: string): Promise<T | null> {
    const key = this.buildKey(keyType, identifier);
    
    try {
      // Try Redis first if available
      if (this.isRedisConnected && this.redisClient) {
        try {
          const redisValue = await this.redisClient.get(key);
          if (redisValue !== null) {
            this.stats.hits++;
            return JSON.parse(redisValue);
          }
        } catch (redisError) {
          logger.error(`Redis get error for key ${key}`, { 
            component: 'CacheService', 
            operation: 'get', 
            key, 
            error: redisError instanceof Error ? redisError : new Error(String(redisError))
          });
          this.isRedisConnected = false;
          // Gracefully fall through to in-memory cache
        }
      }

      // Fall back to in-memory cache
      if (this.config.enableInMemoryFallback) {
        const memoryItem = this.inMemoryCache.get(key);
        if (memoryItem && memoryItem.expires > Date.now()) {
          this.stats.hits++;
          return memoryItem.data;
        }
        
        // Clean up expired item
        if (memoryItem) {
          this.inMemoryCache.delete(key);
        }
      }

      this.stats.misses++;
      return null;
    } catch (error) {
      logger.error(`Cache get error for key ${key}`, { 
        component: 'CacheService', 
        operation: 'get', 
        key, 
        error: error instanceof Error ? error : new Error(String(error))
      });
      this.stats.misses++;
      return null;
    }
  }

  /**
   * Set cache value with TTL
   * @param keyType Cache key type from CacheKeys enum
   * @param value Value to cache
   * @param identifier Optional identifier to append to the key
   * @param ttlSeconds Time to live in seconds, defaults to predefined TTL for key type
   */
  async set<T>(
    keyType: CacheKeys, 
    value: T, 
    identifier?: string, 
    ttlSeconds?: number
  ): Promise<void> {
    const key = this.buildKey(keyType, identifier);
    const ttl = ttlSeconds || CACHE_TTLS[keyType] || this.config.defaultTTL!;

    try {
      const serializedValue = JSON.stringify(value);

      // Set in Redis if available
      if (this.isRedisConnected && this.redisClient) {
        try {
          await this.redisClient.setEx(key, ttl, serializedValue);
        } catch (redisError) {
          logger.error(`Redis set error for key ${key}`, { 
            component: 'CacheService', 
            operation: 'set', 
            key, 
            error: redisError instanceof Error ? redisError : new Error(String(redisError))
          });
          this.isRedisConnected = false;
          // Continue to set in memory cache as fallback
        }
      }

      // Set in memory cache if enabled
      if (this.config.enableInMemoryFallback) {
        this.inMemoryCache.set(key, {
          data: value,
          expires: Date.now() + (ttl * 1000)
        });
      }
    } catch (error) {
      logger.error(`Cache set error for key ${key}`, { 
        component: 'CacheService', 
        operation: 'set', 
        key, 
        error: error instanceof Error ? error : new Error(String(error))
      });
    }
  }

  /**
   * Delete specific cache key
   * @param keyType Cache key type from CacheKeys enum
   * @param identifier Optional identifier to append to the key
   */
  async delete(keyType: CacheKeys, identifier?: string): Promise<void> {
    const key = this.buildKey(keyType, identifier);

    try {
      // Delete from Redis
      if (this.isRedisConnected && this.redisClient) {
        try {
          await this.redisClient.del(key);
        } catch (redisError) {
          logger.error(`Redis delete error for key ${key}`, { 
            component: 'CacheService', 
            operation: 'delete', 
            key, 
            error: redisError instanceof Error ? redisError : new Error(String(redisError))
          });
          this.isRedisConnected = false;
          // Continue to delete from memory cache
        }
      }

      // Delete from memory cache
      this.inMemoryCache.delete(key);
    } catch (error) {
      logger.error(`Cache delete error for key ${key}`, { 
        component: 'CacheService', 
        operation: 'delete', 
        key, 
        error: error instanceof Error ? error : new Error(String(error))
      });
    }
  }

  /**
   * Delete all keys matching pattern
   * @param pattern Pattern to match for deletion
   * @returns Number of keys deleted
   */
  async deletePattern(pattern: string): Promise<number> {
    let deletedCount = 0;

    try {
      // Delete from Redis using pattern
      if (this.isRedisConnected && this.redisClient) {
        try {
          const keys = await this.redisClient.keys(`${CACHE_CONFIG.KEY_PREFIX}${CACHE_CONFIG.SEPARATOR}${pattern}*`);
          if (keys.length > 0) {
            await this.redisClient.del(keys);
            deletedCount += keys.length;
          }
        } catch (redisError) {
          logger.error(`Redis delete pattern error for ${pattern}`, { 
            component: 'CacheService', 
            operation: 'deletePattern', 
            pattern, 
            error: redisError instanceof Error ? redisError : new Error(String(redisError))
          });
          this.isRedisConnected = false;
          // Continue to delete from memory cache
        }
      }

      // Delete from memory cache using pattern
      const memoryKeys = Array.from(this.inMemoryCache.keys()).filter(key => 
        key.includes(pattern)
      );
      memoryKeys.forEach(key => this.inMemoryCache.delete(key));
      deletedCount += memoryKeys.length;
    } catch (error) {
      logger.error(`Cache delete pattern error for ${pattern}`, { 
        component: 'CacheService', 
        operation: 'deletePattern', 
        pattern, 
        error: error instanceof Error ? error : new Error(String(error))
      });
    }

    return deletedCount;
  }

  /**
   * Flush all cache data from both Redis and memory cache
   */
  async flush(): Promise<void> {
    try {
      // Flush Redis
      if (this.isRedisConnected && this.redisClient) {
        try {
          await this.redisClient.flushDb();
        } catch (redisError) {
          logger.error('Redis flush error', { 
            component: 'CacheService', 
            operation: 'flush', 
            error: redisError instanceof Error ? redisError : new Error(String(redisError))
          });
          this.isRedisConnected = false;
          // Continue to flush memory cache
        }
      }

      // Flush memory cache
      this.inMemoryCache.clear();
      
      // Reset stats
      this.stats = { hits: 0, misses: 0 };
      
      logger.info('Cache flushed successfully', { 
        component: 'CacheService', 
        operation: 'flush' 
      });
    } catch (error) {
      logger.error('Cache flush error', { 
        component: 'CacheService', 
        operation: 'flush', 
        error: error instanceof Error ? error : new Error(String(error))
      });
      throw error;
    }
  }

  /**
   * Get cache statistics including hits, misses, hit rate, and memory usage
   * @returns Promise resolving to cache statistics
   */
  async getStats(): Promise<CacheStats> {
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0 ? (this.stats.hits / totalRequests) * 100 : 0;
    
    let totalKeys = this.inMemoryCache.size;
    let memoryUsage: number | undefined;

    try {
      if (this.isRedisConnected && this.redisClient) {
        try {
          const redisKeys = await this.redisClient.keys(`${CACHE_CONFIG.KEY_PREFIX}${CACHE_CONFIG.SEPARATOR}*`);
          totalKeys += redisKeys.length;
          
          // Get Redis memory usage
          const info = await this.redisClient.info('memory');
          const memoryMatch = info.match(/used_memory:(\d+)/);
          if (memoryMatch) {
            memoryUsage = parseInt(memoryMatch[1]);
          }
        } catch (redisError) {
          logger.error('Redis stats error', { 
            component: 'CacheService', 
            operation: 'getStats', 
            error: redisError instanceof Error ? redisError : new Error(String(redisError))
          });
          this.isRedisConnected = false;
          // Continue with memory cache stats only
        }
      }
    } catch (error) {
      logger.error('Error getting cache stats', { 
        component: 'CacheService', 
        operation: 'getStats', 
        error: error instanceof Error ? error : new Error(String(error))
      });
    }

    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: Math.round(hitRate * 100) / 100,
      keys: totalKeys,
      memoryUsage,
      redisConnected: this.isRedisConnected
    };
  }

  /**
   * Cache-or-fetch pattern helper that retrieves from cache or fetches fresh data
   * @param keyType Cache key type from CacheKeys enum
   * @param fetchFunction Function to call if cache miss occurs
   * @param identifier Optional identifier to append to the key
   * @param ttlSeconds Time to live in seconds for the cached result
   * @returns Promise resolving to cached or freshly fetched data
   */
  async cacheOrFetch<T>(
    keyType: CacheKeys,
    fetchFunction: () => Promise<T>,
    identifier?: string,
    ttlSeconds?: number
  ): Promise<T> {
    // Try to get from cache first
    const cached = await this.get<T>(keyType, identifier);
    if (cached !== null) {
      return cached;
    }

    // Cache miss - fetch fresh data
    const data = await fetchFunction();
    
    // Store in cache for next time
    await this.set(keyType, data, identifier, ttlSeconds);
    
    return data;
  }

  /**
   * Cleanup expired in-memory cache items
   */
  private cleanupExpiredItems(): void {
    const now = Date.now();
    for (const [key, item] of this.inMemoryCache.entries()) {
      if (item.expires <= now) {
        this.inMemoryCache.delete(key);
      }
    }
  }

  /**
   * Start periodic cleanup of expired items
   */
  startCleanupTask(intervalMs: number = 60000): void {
    setInterval(() => {
      this.cleanupExpiredItems();
    }, intervalMs);
  }

  /**
   * Gracefully disconnect from Redis and clear memory cache
   */
  async disconnect(): Promise<void> {
    if (this.redisClient) {
      try {
        await this.redisClient.disconnect();
      } catch (error) {
        logger.error('Error disconnecting Redis client', { 
          component: 'CacheService', 
          operation: 'disconnect', 
          error: error instanceof Error ? error : new Error(String(error))
        });
      } finally {
        this.redisClient = null;
      }
    }
    this.inMemoryCache.clear();
    this.isRedisConnected = false;
  }
}

// Export singleton instance
export const cacheService = new CacheService({
  redisUrl: process.env.REDIS_URL,
  enableInMemoryFallback: true,
  defaultTTL: 60
});