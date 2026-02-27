/**
 * Validator Analytics Service - Phase 1
 * Integrates Stakewiz metadata + SVT financial data with on-chain validator info
 */

import { ValidatorService } from './validatorService';
import {
  ValidatorAnalyticsV1,
  ValidatorAnalyticsV1Response,
  StakewizMetadata,
  SVTFinancialData,
  ValidatorInfo
} from '../types/validator';

export class ValidatorAnalyticsService {
  private validatorService: ValidatorService;
  private cache = new Map<string, any>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly STAKEWIZ_API_BASE = 'https://api.stakewiz.com/v1';
  private readonly SVT_API_BASE = 'https://api.solanavalidatortoken.com/v1';

  constructor(rpcUrl: string) {
    this.validatorService = new ValidatorService(rpcUrl);
  }

  /**
   * Get enhanced validator analytics combining on-chain + Stakewiz + SVT data
   */
  async getValidatorAnalytics(options: {
    limit?: number;
    offset?: number;
    sortBy?: 'stake' | 'apy' | 'commission' | 'risk';
    voteAccount?: string;
  } = {}): Promise<ValidatorAnalyticsV1Response> {
    const startTime = Date.now();
    const { limit = 50, offset = 0, sortBy = 'stake', voteAccount } = options;

    try {
      console.log(`Fetching validator analytics: limit=${limit}, offset=${offset}, sortBy=${sortBy}`);

      // Get base validator data from on-chain sources
      const validatorData = await this.validatorService.getValidators();
      let validators = validatorData.validators;

      // Filter by specific vote account if requested
      if (voteAccount) {
        validators = validators.filter(v => v.identity === voteAccount);
        if (validators.length === 0) {
          throw new Error(`Validator ${voteAccount} not found`);
        }
      }

      // Enhance validators with Stakewiz + SVT data (in parallel)
      const enhancedValidators = await this.enhanceValidatorsWithExternalData(
        validators.slice(offset, offset + limit)
      );

      // Sort by requested criteria
      this.sortValidators(enhancedValidators, sortBy);

      // Calculate aggregates
      const aggregates = this.calculateAggregates(enhancedValidators);

      const responseTime = Date.now() - startTime;
      
      console.log(`Validator analytics response: ${enhancedValidators.length} validators, ${responseTime}ms`);

      return {
        validators: enhancedValidators,
        pagination: {
          total: validators.length,
          limit,
          offset,
          hasNext: offset + limit < validators.length
        },
        aggregates,
        meta: {
          responseTimeMs: responseTime,
          epoch: validatorData.epoch,
          timestamp: Date.now()
        }
      };

    } catch (error) {
      console.error('Error in getValidatorAnalytics:', error);
      throw error;
    }
  }

  /**
   * Enhance validators with external data sources in parallel
   */
  private async enhanceValidatorsWithExternalData(validators: ValidatorInfo[]): Promise<ValidatorAnalyticsV1[]> {
    const enhancePromises = validators.map(async (validator): Promise<ValidatorAnalyticsV1> => {
      const voteAccount = validator.identity;
      const startTime = Date.now();

      // Fetch Stakewiz and SVT data in parallel
      const [stakewizData, svtData] = await Promise.allSettled([
        this.getStakewizMetadata(voteAccount),
        this.getSVTFinancialData(voteAccount)
      ]);

      const dataSources = ['on-chain'];
      const dataTimestamps: any = { validator: Date.now() };

      // Process Stakewiz data
      let stakewiz: StakewizMetadata | undefined;
      if (stakewizData.status === 'fulfilled' && stakewizData.value) {
        stakewiz = stakewizData.value;
        dataSources.push('stakewiz');
        dataTimestamps.stakewiz = Date.now();
      } else if (stakewizData.status === 'rejected') {
        console.warn(`Stakewiz data failed for ${voteAccount}:`, stakewizData.reason);
      }

      // Process SVT data
      let svt: SVTFinancialData | undefined;
      if (svtData.status === 'fulfilled' && svtData.value) {
        svt = svtData.value;
        dataSources.push('svt');
        dataTimestamps.svt = Date.now();
      } else if (svtData.status === 'rejected') {
        console.warn(`SVT data failed for ${voteAccount}:`, svtData.reason);
      }

      return {
        validator,
        stakewiz,
        svt,
        dataTimestamps,
        meta: {
          responseTimeMs: Date.now() - startTime,
          dataSources,
          cached: false // TODO: Implement caching
        }
      };
    });

    return await Promise.all(enhancePromises);
  }

  /**
   * Fetch Stakewiz metadata for a validator
   */
  private async getStakewizMetadata(voteAccount: string): Promise<StakewizMetadata | null> {
    const cacheKey = `stakewiz:${voteAccount}`;
    const cached = this.getCachedData(cacheKey);
    if (cached) return cached;

    try {
      // Mock Stakewiz API call - replace with actual API when available
      const stakewizData: StakewizMetadata = {
        voteAccount,
        name: `Validator ${voteAccount.slice(0, 8)}...`,
        description: 'High-performance validator with 99.9% uptime',
        website: `https://validator-${voteAccount.slice(0, 8)}.com`,
        iconUrl: `https://api.stakewiz.com/icons/${voteAccount}.png`,
        social: {
          twitter: `@validator_${voteAccount.slice(0, 6)}`,
          discord: 'https://discord.gg/validator',
        },
        location: {
          country: 'United States',
          region: 'US-East',
          datacenter: 'AWS us-east-1'
        },
        setup: {
          hardware: 'Intel Xeon, 64GB RAM, NVMe SSD',
          software: 'Solana v1.17+',
          uptime: 99.9
        },
        stakewizScore: Math.floor(Math.random() * 40) + 60, // 60-100 score
        verified: Math.random() > 0.3 // 70% verified
      };

      this.setCachedData(cacheKey, stakewizData);
      return stakewizData;

    } catch (error) {
      console.error(`Failed to fetch Stakewiz data for ${voteAccount}:`, error);
      return null;
    }
  }

  /**
   * Fetch SVT financial data for a validator
   */
  private async getSVTFinancialData(voteAccount: string): Promise<SVTFinancialData | null> {
    const cacheKey = `svt:${voteAccount}`;
    const cached = this.getCachedData(cacheKey);
    if (cached) return cached;

    try {
      // Mock SVT API call - replace with actual API when available
      const baseAPY = 6 + Math.random() * 4; // 6-10% base APY
      const performance = 0.85 + Math.random() * 0.15; // 85-100% efficiency
      const totalStake = Math.floor(Math.random() * 1000000) + 100000; // 100K-1M SOL

      const svtData: SVTFinancialData = {
        voteAccount,
        apy: {
          current: baseAPY,
          average30d: baseAPY * (0.95 + Math.random() * 0.1),
          average90d: baseAPY * (0.9 + Math.random() * 0.2),
          average1y: baseAPY * (0.85 + Math.random() * 0.3)
        },
        performance: {
          totalRewards: totalStake * 0.08, // 8% yearly
          rewardsPerEpoch: (totalStake * 0.08) / 365,
          missedRewards: totalStake * 0.08 * (1 - performance),
          efficiency: performance * 100
        },
        economics: {
          totalStakeValue: totalStake,
          totalStakeUSD: totalStake * 100, // $100 SOL price
          projectedYearlyReturns: totalStake * (baseAPY / 100),
          projectedYearlyReturnsUSD: totalStake * (baseAPY / 100) * 100
        },
        risk: {
          delinquencyRate: Math.random() * 0.05, // 0-5%
          commissionStability: 0.9 + Math.random() * 0.1, // 90-100%
          uptimeScore: 0.95 + Math.random() * 0.05, // 95-100%
          riskScore: this.calculateRiskScore(performance, baseAPY)
        }
      };

      this.setCachedData(cacheKey, svtData);
      return svtData;

    } catch (error) {
      console.error(`Failed to fetch SVT data for ${voteAccount}:`, error);
      return null;
    }
  }

  /**
   * Sort validators by specified criteria
   */
  private sortValidators(validators: ValidatorAnalyticsV1[], sortBy: string): void {
    validators.sort((a, b) => {
      switch (sortBy) {
        case 'apy':
          const apyA = a.svt?.apy.current || 0;
          const apyB = b.svt?.apy.current || 0;
          return apyB - apyA;

        case 'commission':
          return a.validator.commission - b.validator.commission;

        case 'risk':
          const riskA = a.svt?.risk.riskScore || 'HIGH';
          const riskB = b.svt?.risk.riskScore || 'HIGH';
          const riskOrder = { 'LOW': 0, 'MEDIUM': 1, 'HIGH': 2 };
          return riskOrder[riskA] - riskOrder[riskB];

        case 'stake':
        default:
          return b.validator.stake - a.validator.stake;
      }
    });
  }

  /**
   * Calculate aggregate statistics
   */
  private calculateAggregates(validators: ValidatorAnalyticsV1[]): any {
    const validValidators = validators.filter(v => v.svt);
    
    if (validValidators.length === 0) {
      return {
        totalStake: validators.reduce((sum, v) => sum + v.validator.stake, 0),
        averageAPY: 0,
        averageCommission: validators.reduce((sum, v) => sum + v.validator.commission, 0) / validators.length,
        totalValidators: validators.length
      };
    }

    return {
      totalStake: validators.reduce((sum, v) => sum + v.validator.stake, 0),
      averageAPY: validValidators.reduce((sum, v) => sum + (v.svt?.apy.current || 0), 0) / validValidators.length,
      averageCommission: validators.reduce((sum, v) => sum + v.validator.commission, 0) / validators.length,
      totalValidators: validators.length
    };
  }

  /**
   * Calculate risk score based on performance metrics
   */
  private calculateRiskScore(performance: number, apy: number): 'LOW' | 'MEDIUM' | 'HIGH' {
    const score = (performance * 0.6) + ((apy / 10) * 0.4);
    
    if (score > 0.8) return 'LOW';
    if (score > 0.6) return 'MEDIUM';
    return 'HIGH';
  }

  /**
   * Simple cache management
   */
  private getCachedData(key: string): any {
    const item = this.cache.get(key);
    if (item && Date.now() - item.timestamp < this.CACHE_TTL) {
      return item.data;
    }
    return null;
  }

  private setCachedData(key: string, data: any): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Health check for external data sources
   */
  async healthCheck(): Promise<{ stakewiz: boolean; svt: boolean; onChain: boolean }> {
    const [stakewizHealth, svtHealth, onChainHealth] = await Promise.allSettled([
      this.checkStakewizHealth(),
      this.checkSVTHealth(),
      this.validatorService.healthCheck()
    ]);

    return {
      stakewiz: stakewizHealth.status === 'fulfilled' && stakewizHealth.value,
      svt: svtHealth.status === 'fulfilled' && svtHealth.value,
      onChain: onChainHealth.status === 'fulfilled'
    };
  }

  private async checkStakewizHealth(): Promise<boolean> {
    // Mock health check - replace with actual API ping
    return true;
  }

  private async checkSVTHealth(): Promise<boolean> {
    // Mock health check - replace with actual API ping  
    return true;
  }
}