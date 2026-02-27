/**
 * Validator Service
 * Fetches validator data from Solana RPC only - no third-party APIs
 */

import { 
  Connection,
  PublicKey,
  AccountInfo, 
  VoteAccountInfo, 
  VoteAccountStatus
} from '@solana/web3.js';
import { 
  ValidatorInfo, 
  ValidatorInfoResponse, 
  ValidatorInfoProgramData,
  ValidatorDetailInfo,
  ValidatorHistoryData,
  CurrentEpochInfo,
  StakeAccount,
  WalletStakeAccountsResponse,
  NetworkStats,
  ValidatorComparisonResponse,
  TopValidatorsResponse,
  DelinquentAlertsResponse
} from '../types/validator';
import { cacheService, CacheKeys } from './cacheService';

export class ValidatorService {
  private connection: Connection;
  private readonly VALIDATOR_INFO_PROGRAM_ID = new PublicKey('Va1idkzkB6LEmVFmxWbWU5Ao17SMcTLofw1bh6qr5RP');
  private readonly REQUEST_TIMEOUT = 30000; // 30 seconds
  private readonly MAX_RETRIES = 3;
  private readonly BATCH_SIZE = 50; // Reduced batch size for better reliability

  constructor(rpcUrl: string = 'https://api.mainnet-beta.solana.com') {
    this.connection = new Connection(rpcUrl, {
      commitment: 'confirmed',
      wsEndpoint: undefined, // Disable websocket to avoid connection issues
      disableRetryOnRateLimit: false,
      confirmTransactionInitialTimeout: this.REQUEST_TIMEOUT,
    });
  }

  /**
   * Get all validators with their metadata from on-chain sources
   */
  async getValidators(): Promise<ValidatorInfoResponse> {
    try {
      console.log('Fetching vote accounts from RPC...');
      
      // Get current epoch with timeout
      const epochInfo = await Promise.race([
        this.connection.getEpochInfo(),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Epoch info request timeout')), this.REQUEST_TIMEOUT)
        )
      ]);
      
      // Fetch all vote accounts with timeout
      const voteAccounts: VoteAccountStatus = await Promise.race([
        this.connection.getVoteAccounts(),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Vote accounts request timeout')), this.REQUEST_TIMEOUT)
        )
      ]);
      
      // Guard against null/undefined voteAccounts and missing properties
      if (!voteAccounts) {
        console.warn('Vote accounts data is null or undefined, returning empty result');
        return {
          validators: [],
          epoch: epochInfo?.epoch || 0,
          totalValidators: 0,
          totalStake: 0,
          timestamp: Date.now()
        };
      }
      
      const currentValidators = voteAccounts.current || [];
      const delinquentValidators = voteAccounts.delinquent || [];
      
      console.log(`Found ${currentValidators.length} active validators and ${delinquentValidators.length} delinquent validators`);
      
      // Combine current and delinquent validators
      const allValidators = [...currentValidators, ...delinquentValidators];
      
      // Fetch validator names from validator-info program in batches
      const validatorInfoMap = await this.fetchValidatorInfoBatch(
        allValidators.map(v => v.votePubkey)
      );
      
      // Transform to our format
      const validators: ValidatorInfo[] = allValidators.map(validator => ({
        identity: validator.votePubkey,
        name: validatorInfoMap.get(validator.votePubkey) || null,
        stake: validator.activatedStake,
        commission: validator.commission,
        activatedStake: validator.activatedStake,
        epochVoteAccount: validator.epochVoteAccount,
        nodePubkey: validator.nodePubkey,
        rootSlot: (validator as any).rootSlot || null, // Some properties may not be in types
        lastVote: (validator as any).lastVote || null,
        epochCredits: validator.epochCredits || []
      }));
      
      // Calculate totals
      const totalStake = validators.reduce((sum, v) => sum + v.stake, 0);
      
      console.log(`Successfully processed ${validators.length} validators with ${totalStake / 1e9} SOL total stake`);
      
      return {
        validators,
        epoch: epochInfo.epoch,
        totalValidators: validators.length,
        totalStake,
        timestamp: Date.now()
      };
      
    } catch (error) {
      console.error('Error fetching validators:', error);
      throw new Error(`Failed to fetch validator data: ${error}`);
    }
  }

  /**
   * Fetch validator info program data in batches to avoid RPC limits
   */
  private async fetchValidatorInfoBatch(votePubkeys: string[]): Promise<Map<string, string>> {
    const validatorInfoMap = new Map<string, string>();
    
    console.log(`Fetching validator info for ${votePubkeys.length} validators in batches of ${this.BATCH_SIZE}...`);
    
    for (let i = 0; i < votePubkeys.length; i += this.BATCH_SIZE) {
      const batch = votePubkeys.slice(i, i + this.BATCH_SIZE);
      
      try {
        await this.processBatch(batch, validatorInfoMap);
      } catch (error) {
        console.error(`Failed to process batch ${Math.floor(i / this.BATCH_SIZE) + 1}:`, error);
        // Continue with next batch instead of failing entirely
      }
      
      // Progressive delay to be respectful to RPC endpoint
      const delay = Math.min(200 + (i / this.BATCH_SIZE) * 50, 1000);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    console.log(`Found validator info for ${validatorInfoMap.size} out of ${votePubkeys.length} validators`);
    return validatorInfoMap;
  }

  /**
   * Process a batch of vote pubkeys to fetch validator info
   */
  private async processBatch(votePubkeys: string[], validatorInfoMap: Map<string, string>): Promise<void> {
    const promises = votePubkeys.map(async (votePubkey) => {
      try {
        const name = await this.getValidatorName(votePubkey);
        if (name) {
          validatorInfoMap.set(votePubkey, name);
        }
      } catch (error) {
        // Silently continue if we can't get validator info for this one
        console.debug(`Could not fetch validator info for ${votePubkey}:`, error);
      }
    });
    
    await Promise.allSettled(promises);
  }

  /**
   * Get validator name from validator-info program with retry logic
   */
  private async getValidatorName(votePubkey: string): Promise<string | null> {
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        // Derive the validator info account PDA
        const [validatorInfoAccount] = PublicKey.findProgramAddressSync(
          [Buffer.from('validator-info'), new PublicKey(votePubkey).toBuffer()],
          this.VALIDATOR_INFO_PROGRAM_ID
        );
        
        // Get the account data with timeout
        const accountInfo: AccountInfo<Buffer> | null = await Promise.race([
          this.connection.getAccountInfo(validatorInfoAccount),
          new Promise<null>((_, reject) => 
            setTimeout(() => reject(new Error('Request timeout')), this.REQUEST_TIMEOUT)
          )
        ]);
        
        if (!accountInfo || !accountInfo.data || accountInfo.data.length === 0) {
          return null;
        }
        
        // Parse the validator info data
        const data = this.parseValidatorInfoData(accountInfo.data);
        return data.name || null;
        
      } catch (error) {
        const isLastAttempt = attempt === this.MAX_RETRIES;
        
        if (isLastAttempt) {
          console.debug(`Failed to fetch validator info for ${votePubkey} after ${this.MAX_RETRIES} attempts:`, error);
        } else {
          console.debug(`Attempt ${attempt} failed for ${votePubkey}, retrying...`);
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt - 1) * 1000));
        }
        
        if (isLastAttempt) {
          return null;
        }
      }
    }
    
    return null;
  }

  /**
   * Parse validator info program data using fallback parsing
   * TODO: Implement proper borsh deserialization in future version
   */
  private parseValidatorInfoData(data: Buffer): ValidatorInfoProgramData {
    try {
      // The validator info account data structure:
      // - First 8 bytes: discriminator 
      // - Remaining: borsh-serialized ConfigData struct
      
      if (data.length < 8) {
        console.debug('Invalid validator info data: too short');
        return {};
      }
      
      // Skip the 8-byte discriminator
      const configDataBuffer = data.slice(8);
      
      if (configDataBuffer.length === 0) {
        console.debug('No config data found after discriminator');
        return {};
      }
      
      // Use fallback parsing for now
      // TODO: Implement proper borsh deserialization
      return this.fallbackParseValidatorInfo(configDataBuffer);
      
    } catch (error) {
      console.debug('Error parsing validator info data:', error);
      return {};
    }
  }

  /**
   * Fallback parser for validator info data when borsh fails
   */
  private fallbackParseValidatorInfo(data: Buffer): ValidatorInfoProgramData {
    try {
      // Convert to string and look for readable text patterns
      const dataStr = data.toString('utf8');
      
      // Remove null bytes and control characters
      const cleanStr = dataStr.replace(/[\x00-\x1F\x7F]/g, '');
      
      // Look for patterns that might be validator names (alphanumeric with common punctuation)
      const nameMatch = cleanStr.match(/([A-Za-z0-9][\w\s\-_\.]{2,50}[A-Za-z0-9])/);
      
      // Look for website patterns
      const websiteMatch = cleanStr.match(/(https?:\/\/[\w\-\.]+\.[a-z]{2,6}[\/\w\-\._~:/?#[\]@!$&'()*+,;=]*)/i);
      
      const result: ValidatorInfoProgramData = {};
      
      if (nameMatch && nameMatch[1].length >= 3 && nameMatch[1].length <= 50) {
        result.name = nameMatch[1].trim();
      }
      
      if (websiteMatch) {
        result.website = websiteMatch[1];
      }
      
      return result;
      
    } catch (error) {
      console.debug('Fallback parsing failed:', error);
      return {};
    }
  }

  /**
   * Health check - verify RPC connection is working
   */
  async healthCheck(): Promise<{ status: string; blockHeight: number; epoch: number; responseTimeMs: number }> {
    const startTime = Date.now();
    
    try {
      // Test RPC connection with timeout
      const [slot, epochInfo] = await Promise.all([
        Promise.race([
          this.connection.getSlot(),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Slot request timeout')), 10000)
          )
        ]),
        Promise.race([
          this.connection.getEpochInfo(),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Epoch info request timeout')), 10000)
          )
        ])
      ]);
      
      const responseTime = Date.now() - startTime;
      
      return {
        status: 'healthy',
        blockHeight: slot,
        epoch: epochInfo.epoch,
        responseTimeMs: responseTime
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      let errorMessage = 'Unknown error';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      throw new Error(`RPC health check failed after ${responseTime}ms: ${errorMessage}`);
    }
  }

  /**
   * V2 ENDPOINT: Get detailed information for a single validator
   */
  async getValidatorDetail(voteAccount: string): Promise<ValidatorDetailInfo> {
    try {
      console.log(`Fetching detailed info for validator: ${voteAccount}`);
      
      const voteAccountPubkey = new PublicKey(voteAccount);
      
      // Get current epoch info
      const epochInfo = await Promise.race([
        this.connection.getEpochInfo(),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Epoch info timeout')), this.REQUEST_TIMEOUT)
        )
      ]);
      
      // Get vote accounts to find this specific validator
      const voteAccounts = await Promise.race([
        this.connection.getVoteAccounts(),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Vote accounts timeout')), this.REQUEST_TIMEOUT)
        )
      ]);
      
      // Find the validator in current or delinquent lists
      const allValidators = [...(voteAccounts.current || []), ...(voteAccounts.delinquent || [])];
      const validator = allValidators.find(v => v.votePubkey === voteAccount);
      
      if (!validator) {
        throw new Error(`Validator ${voteAccount} not found`);
      }
      
      const isDelinquent = (voteAccounts.delinquent || []).some(v => v.votePubkey === voteAccount);
      
      // Get validator name from validator-info program
      const name = await this.getValidatorName(voteAccount);
      
      // Calculate epoch credits history (last 10 epochs)
      const epochCreditsHistory = this.calculateEpochCreditsHistory(validator.epochCredits, epochInfo.epoch);
      
      // Calculate estimated APY and skip rate
      const { estimatedApy, skipRate } = this.calculatePerformanceMetrics(epochCreditsHistory, epochInfo);
      
      // Calculate current epoch performance
      const currentEpochPerformance = this.calculateCurrentEpochPerformance(validator.epochCredits, epochInfo);
      
      return {
        voteAccount,
        identity: validator.nodePubkey,
        name,
        commission: validator.commission,
        lastVote: (validator as any).lastVote || null,
        rootSlot: (validator as any).rootSlot || null,
        activatedStake: validator.activatedStake,
        epochVoteAccount: validator.epochVoteAccount,
        delinquent: isDelinquent,
        epochCreditsHistory,
        estimatedApy,
        skipRate,
        currentEpochPerformance
      };
      
    } catch (error) {
      console.error(`Error fetching validator detail for ${voteAccount}:`, error);
      throw new Error(`Failed to fetch validator detail: ${error}`);
    }
  }

  /**
   * V2 ENDPOINT: Get historical performance data for a validator
   */
  async getValidatorHistory(voteAccount: string): Promise<ValidatorHistoryData> {
    try {
      console.log(`Fetching history for validator: ${voteAccount}`);
      
      // Get current validator data
      const validatorDetail = await this.getValidatorDetail(voteAccount);
      
      // For now, we'll use the epoch credits history to build performance history
      // In a full implementation, this would query historical RPC data or a data store
      const epochHistory = validatorDetail.epochCreditsHistory.map((epochCredit, index) => {
        const creditsEarned = index > 0 
          ? epochCredit.credits - validatorDetail.epochCreditsHistory[index - 1].credits
          : epochCredit.credits;
          
        return {
          epoch: epochCredit.epoch,
          credits: epochCredit.credits,
          creditsEarned,
          commission: validatorDetail.commission, // Current commission (historical data would require storage)
          activatedStake: validatorDetail.activatedStake, // Current stake (historical data would require storage)
          skipRate: this.calculateEpochSkipRate(creditsEarned, epochCredit.epoch),
          timestamp: Date.now() - ((validatorDetail.epochCreditsHistory.length - index - 1) * 432000000) // Approximate epoch duration
        };
      });
      
      // Commission history (simplified - would need historical storage)
      const commissionHistory = [{
        epoch: validatorDetail.epochCreditsHistory[0]?.epoch || 0,
        commission: validatorDetail.commission,
        changedAt: Date.now()
      }];
      
      // Stake history (simplified - would need historical storage)  
      const stakeHistory = [{
        epoch: validatorDetail.epochCreditsHistory[0]?.epoch || 0,
        activatedStake: validatorDetail.activatedStake,
        changedAt: Date.now()
      }];
      
      return {
        voteAccount,
        epochHistory,
        commissionHistory,
        stakeHistory
      };
      
    } catch (error) {
      console.error(`Error fetching validator history for ${voteAccount}:`, error);
      throw new Error(`Failed to fetch validator history: ${error}`);
    }
  }

  /**
   * V2 ENDPOINT: Get current epoch information (cached)
   */
  async getCurrentEpochInfo(): Promise<CurrentEpochInfo> {
    return cacheService.cacheOrFetch(
      CacheKeys.EPOCH_INFO,
      () => this.getCurrentEpochInfoFromRPC()
    );
  }

  /**
   * Internal method to fetch current epoch info from RPC without caching
   */
  private async getCurrentEpochInfoFromRPC(): Promise<CurrentEpochInfo> {
    try {
      const [epochInfo, slot] = await Promise.all([
        Promise.race([
          this.connection.getEpochInfo(),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Epoch info timeout')), this.REQUEST_TIMEOUT)
          )
        ]),
        Promise.race([
          this.connection.getSlot(),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Slot timeout')), this.REQUEST_TIMEOUT)
          )
        ])
      ]);
      
      // Get vote accounts to calculate total active stake and validator count
      const voteAccounts = await Promise.race([
        this.connection.getVoteAccounts(),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Vote accounts timeout')), this.REQUEST_TIMEOUT)
        )
      ]);
      
      const currentValidators = voteAccounts.current || [];
      const totalActiveStake = currentValidators.reduce((sum, v) => sum + v.activatedStake, 0);
      
      // Calculate epoch progress
      const progress = (epochInfo.slotIndex / epochInfo.slotsInEpoch) * 100;
      
      // Estimate time remaining (assuming 400ms per slot)
      const slotsRemaining = epochInfo.slotsInEpoch - epochInfo.slotIndex;
      const timeRemainingMs = slotsRemaining * 400; // Approximate slot time
      
      return {
        epoch: epochInfo.epoch,
        slotIndex: epochInfo.slotIndex,
        slotsInEpoch: epochInfo.slotsInEpoch,
        progress,
        timeRemainingMs,
        totalActiveStake,
        activeValidatorCount: currentValidators.length,
        currentSlot: slot,
        epochStartSlot: slot - epochInfo.slotIndex,
        timestamp: Date.now()
      };
      
    } catch (error) {
      console.error('Error fetching current epoch info:', error);
      throw new Error(`Failed to fetch current epoch info: ${error}`);
    }
  }

  /**
   * V2 ENDPOINT: Get stake accounts for a wallet address (cached)
   */
  async getWalletStakeAccounts(wallet: string): Promise<WalletStakeAccountsResponse> {
    return cacheService.cacheOrFetch(
      CacheKeys.WALLET_STAKE_ACCOUNTS,
      () => this.getWalletStakeAccountsFromRPC(wallet),
      wallet
    );
  }

  /**
   * Internal method to fetch wallet stake accounts from RPC without caching
   */
  private async getWalletStakeAccountsFromRPC(wallet: string): Promise<WalletStakeAccountsResponse> {
    try {
      console.log(`Fetching stake accounts for wallet: ${wallet}`);
      
      const walletPubkey = new PublicKey(wallet);
      
      // Get stake accounts owned by this wallet
      const stakeAccounts = await Promise.race([
        this.connection.getParsedProgramAccounts(
          new PublicKey('Stake11111111111111111111111111111111111112'), // Stake program ID
          {
            filters: [
              {
                memcmp: {
                  offset: 44, // Stake authority offset in stake account
                  bytes: walletPubkey.toBase58()
                }
              }
            ]
          }
        ),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Stake accounts timeout')), this.REQUEST_TIMEOUT * 2)
        )
      ]);
      
      // Get validator names for delegation info
      const validatorNames = new Map<string, string>();
      
      // Parse stake account data
      const parsedStakeAccounts: (StakeAccount | null)[] = await Promise.all(
        stakeAccounts.map(async (account) => {
          try {
            const accountData = account.account.data as any;
            const stakeData = accountData?.parsed?.info;
            
            if (!stakeData) {
              return null;
            }
            
            const delegation = stakeData.stake?.delegation;
            const meta = stakeData.meta;
            
            let voteAccount: string | null = null;
            let validatorName: string | null = null;
            let state: 'active' | 'activating' | 'deactivating' | 'inactive' = 'inactive';
            
            if (delegation) {
              voteAccount = delegation.voter;
              
              // Get validator name if not cached
              if (voteAccount && !validatorNames.has(voteAccount)) {
                const name = await this.getValidatorName(voteAccount);
                if (name) {
                  validatorNames.set(voteAccount, name);
                }
              }
              validatorName = voteAccount ? (validatorNames.get(voteAccount) || null) : null;
              
              // Determine state based on activation epochs
              const currentEpoch = await this.connection.getEpochInfo().then(info => info.epoch);
              if (delegation.activationEpoch <= currentEpoch) {
                if (delegation.deactivationEpoch < currentEpoch) {
                  state = 'deactivating';
                } else {
                  state = 'active';
                }
              } else {
                state = 'activating';
              }
            }
            
            return {
              pubkey: account.pubkey.toBase58(),
              voteAccount,
              validatorName,
              stake: stakeData.stake?.delegation?.stake || 0,
              state,
              activationEpoch: delegation?.activationEpoch || null,
              deactivationEpoch: delegation?.deactivationEpoch || null,
              stakeAuthority: meta?.authorized?.staker || '',
              withdrawAuthority: meta?.authorized?.withdrawer || '',
              rentExemptReserve: meta?.rentExemptReserve || 0,
              creditsObserved: delegation?.creditsObserved || 0,
              estimatedRewards: this.calculateStakeRewards(stakeData.stake?.delegation) // Simplified calculation
            };
          } catch (error) {
            console.debug(`Error parsing stake account ${account.pubkey.toBase58()}:`, error);
            return null;
          }
        })
      );
      
      // Filter out null results and calculate totals
      const validStakeAccounts = parsedStakeAccounts.filter((account): account is StakeAccount => account !== null);
      
      const totalStaked = validStakeAccounts.reduce((sum, account) => sum + account.stake, 0);
      const totalEstimatedRewards = validStakeAccounts.reduce((sum, account) => sum + account.estimatedRewards, 0);
      const validatorCount = new Set(validStakeAccounts.map(account => account.voteAccount).filter((voteAccount): voteAccount is string => voteAccount !== null)).size;
      
      return {
        wallet,
        stakeAccounts: validStakeAccounts,
        totalStaked,
        totalEstimatedRewards,
        validatorCount,
        timestamp: Date.now()
      };
      
    } catch (error) {
      console.error(`Error fetching stake accounts for wallet ${wallet}:`, error);
      throw new Error(`Failed to fetch stake accounts: ${error}`);
    }
  }

  // Helper methods for calculations

  private calculateEpochCreditsHistory(epochCredits: Array<[number, number, number]>, currentEpoch: number) {
    // Take last 10 epochs of data
    const recentCredits = epochCredits.slice(-10);
    
    return recentCredits.map(([epoch, credits, previousCredits]) => ({
      epoch,
      credits,
      previousCredits
    }));
  }

  private calculatePerformanceMetrics(epochCreditsHistory: any[], epochInfo: any) {
    if (epochCreditsHistory.length < 2) {
      return { estimatedApy: 0, skipRate: 0 };
    }
    
    // Calculate average credits earned per epoch
    let totalCreditsEarned = 0;
    let epochsWithCredits = 0;
    
    for (let i = 1; i < epochCreditsHistory.length; i++) {
      const creditsEarned = epochCreditsHistory[i].credits - epochCreditsHistory[i-1].credits;
      if (creditsEarned > 0) {
        totalCreditsEarned += creditsEarned;
        epochsWithCredits++;
      }
    }
    
    const avgCreditsPerEpoch = epochsWithCredits > 0 ? totalCreditsEarned / epochsWithCredits : 0;
    
    // Estimate skip rate (simplified calculation)
    const expectedCreditsPerEpoch = epochInfo.slotsInEpoch || 432000; // Approximate slots per epoch
    const skipRate = epochsWithCredits > 0 
      ? Math.max(0, (expectedCreditsPerEpoch - avgCreditsPerEpoch) / expectedCreditsPerEpoch * 100)
      : 0;
    
    // Estimate APY based on credits performance (simplified)
    // This is a rough calculation - actual APY depends on many factors
    const baseApy = 7; // Base Solana staking APY
    const performanceMultiplier = avgCreditsPerEpoch / (expectedCreditsPerEpoch || 1);
    const estimatedApy = baseApy * Math.min(performanceMultiplier, 1.2); // Cap at 20% bonus
    
    return { estimatedApy, skipRate };
  }

  private calculateCurrentEpochPerformance(epochCredits: Array<[number, number, number]>, epochInfo: any) {
    if (epochCredits.length < 2) {
      return {
        creditsEarned: 0,
        expectedCredits: 0,
        performanceScore: 0
      };
    }
    
    const latestCredit = epochCredits[epochCredits.length - 1];
    const previousCredit = epochCredits[epochCredits.length - 2];
    
    const creditsEarned = latestCredit[1] - previousCredit[1];
    const expectedCredits = epochInfo.slotIndex || 0; // Simplified
    const performanceScore = expectedCredits > 0 ? (creditsEarned / expectedCredits) * 100 : 0;
    
    return {
      creditsEarned,
      expectedCredits,
      performanceScore: Math.min(performanceScore, 100)
    };
  }

  private calculateEpochSkipRate(creditsEarned: number, epoch: number): number {
    // Simplified skip rate calculation
    // In practice, this would need historical slot data
    const expectedSlots = 432000; // Approximate slots per epoch
    return Math.max(0, (expectedSlots - creditsEarned) / expectedSlots * 100);
  }

  private calculateStakeRewards(delegation: any): number {
    // Simplified rewards calculation
    // In practice, this would need detailed historical data and inflation calculations
    if (!delegation || !delegation.stake) {
      return 0;
    }
    
    const stakeAmount = delegation.stake;
    const annualRewardRate = 0.07; // 7% approximate
    const epochsPerYear = 365.25 * 24 * 60 * 60 / (432000 * 0.4); // Approximate
    
    return Math.floor(stakeAmount * (annualRewardRate / epochsPerYear));
  }

  // New Aggregation Methods

  /**
   * Get network-wide staking statistics (cached)
   */
  async getNetworkStats(): Promise<import('../types/validator').NetworkStats> {
    return cacheService.cacheOrFetch(
      CacheKeys.NETWORK_STATS,
      () => this.getNetworkStatsFromRPC()
    );
  }

  /**
   * Internal method to fetch network stats from RPC without caching
   */
  private async getNetworkStatsFromRPC(): Promise<import('../types/validator').NetworkStats> {
    try {
      console.log('Fetching network statistics...');
      
      // Get current epoch info
      const epochInfo = await this.connection.getEpochInfo();
      
      // Get all vote accounts
      const voteAccounts = await this.connection.getVoteAccounts();
      
      const activeValidators = voteAccounts.current?.length || 0;
      const delinquentValidators = voteAccounts.delinquent?.length || 0;
      const totalValidators = activeValidators + delinquentValidators;
      
      // Calculate total stake
      const totalStake = (voteAccounts.current || []).reduce(
        (sum, validator) => sum + validator.activatedStake, 0
      ) + (voteAccounts.delinquent || []).reduce(
        (sum, validator) => sum + validator.activatedStake, 0
      );
      
      const averageStake = totalValidators > 0 ? totalStake / totalValidators : 0;
      
      // Calculate Nakamoto coefficient (validators needed for 33% stake)
      const sortedValidators = [...(voteAccounts.current || []), ...(voteAccounts.delinquent || [])]
        .sort((a, b) => b.activatedStake - a.activatedStake);
      
      const targetStake = totalStake * 0.33;
      let accumulatedStake = 0;
      let nakamotoCoefficient = 0;
      
      for (const validator of sortedValidators) {
        accumulatedStake += validator.activatedStake;
        nakamotoCoefficient++;
        if (accumulatedStake >= targetStake) {
          break;
        }
      }
      
      // Calculate network APY estimate (simplified)
      const networkAPY = 7.0; // Base estimate, could be calculated from actual rewards
      
      // Calculate epoch progress
      const epochProgress = epochInfo.slotsInEpoch > 0 
        ? (epochInfo.slotIndex / epochInfo.slotsInEpoch) * 100 
        : 0;
      
      return {
        totalValidators,
        activeValidators,
        delinquentValidators,
        totalStake,
        averageStake,
        networkAPY,
        nakamotoCoefficient,
        epoch: epochInfo.epoch,
        slotsInEpoch: epochInfo.slotsInEpoch,
        slotIndex: epochInfo.slotIndex,
        epochProgress,
        timestamp: Date.now()
      };
      
    } catch (error) {
      console.error('Error fetching network stats:', error);
      throw new Error(`Failed to fetch network statistics: ${error}`);
    }
  }

  /**
   * Compare multiple validators side by side
   */
  async compareValidators(voteAccounts: string[]): Promise<import('../types/validator').ValidatorComparisonResponse> {
    try {
      console.log(`Comparing ${voteAccounts.length} validators...`);
      const startTime = Date.now();
      
      // Get epoch info for calculations
      const epochInfo = await this.connection.getEpochInfo();
      
      // Get all vote accounts for context
      const allVoteAccounts = await this.connection.getVoteAccounts();
      const allValidators = [...(allVoteAccounts.current || []), ...(allVoteAccounts.delinquent || [])];
      
      // Get validator names
      const validatorInfoMap = await this.fetchValidatorInfoBatch(voteAccounts);
      
      // Phase validator addresses (hardcoded)
      const phaseValidators = new Set([
        // Add Phase validator vote accounts here when known
        'PhaseZkVtXkkLvH3PL4QGzPYkZYGqzfCGTkfSF4YE7', // Example
      ]);
      
      const validators: import('../types/validator').ValidatorComparison[] = [];
      const notFound: string[] = [];
      
      for (const voteAccount of voteAccounts) {
        const validator = allValidators.find(v => v.votePubkey === voteAccount);
        
        if (!validator) {
          notFound.push(voteAccount);
          continue;
        }
        
        // Calculate performance metrics
        const { estimatedApy, skipRate } = this.calculatePerformanceMetrics(
          validator.epochCredits || [], 
          epochInfo
        );
        
        // Calculate uptime (simplified based on epoch credits)
        const uptime = validator.epochCredits && validator.epochCredits.length > 0 ? 95 : 0;
        
        // Calculate performance score (0-100)
        const performanceScore = this.calculateValidatorPerformanceScore(
          estimatedApy, 
          uptime, 
          skipRate, 
          validator.commission
        );
        
        const isDelinquent = (allVoteAccounts.delinquent || []).some(v => v.votePubkey === voteAccount);
        
        validators.push({
          voteAccount,
          name: validatorInfoMap.get(voteAccount) || null,
          commission: validator.commission,
          apy: estimatedApy,
          uptime,
          skipRate,
          stake: validator.activatedStake,
          performanceScore,
          isPhaseValidator: phaseValidators.has(voteAccount),
          lastVote: (validator as any).lastVote || null,
          isDelinquent
        });
      }
      
      // Sort by performance score (descending)
      validators.sort((a, b) => b.performanceScore - a.performanceScore);
      
      const responseTime = Date.now() - startTime;
      
      return {
        validators,
        notFound,
        epoch: epochInfo.epoch,
        timestamp: Date.now(),
        meta: {
          responseTimeMs: responseTime,
          requestedCount: voteAccounts.length,
          foundCount: validators.length
        }
      };
      
    } catch (error) {
      console.error('Error comparing validators:', error);
      throw new Error(`Failed to compare validators: ${error}`);
    }
  }

  /**
   * Get top validators leaderboard
   */
  async getTopValidators(
    sortBy: 'apy' | 'uptime' | 'stake' = 'apy',
    limit: number = 20
  ): Promise<import('../types/validator').TopValidatorsResponse> {
    try {
      console.log(`Fetching top ${limit} validators sorted by ${sortBy}...`);
      const startTime = Date.now();
      
      // Get all validators
      const validatorData = await this.getValidators();
      const epochInfo = await this.connection.getEpochInfo();
      
      // Phase validator addresses (hardcoded)
      const phaseValidators = new Set([
        // Add Phase validator vote accounts here when known
        'PhaseZkVtXkkLvH3PL4QGzPYkZYGqzfCGTkfSF4YE7', // Example
      ]);
      
      // Calculate metrics for all validators
      const validatorsWithMetrics = validatorData.validators.map((validator, index) => {
        const { estimatedApy, skipRate } = this.calculatePerformanceMetrics(
          validator.epochCredits || [], 
          epochInfo
        );
        
        // Simple uptime calculation based on whether validator is active
        const uptime = validator.epochVoteAccount ? 98 : 0;
        
        // Simple stake growth calculation (would need historical data for accuracy)
        const stakeGrowth = Math.random() * 10 - 5; // Placeholder: -5% to +5%
        
        const performanceScore = this.calculateValidatorPerformanceScore(
          estimatedApy,
          uptime,
          skipRate,
          validator.commission
        );
        
        return {
          voteAccount: validator.identity,
          name: validator.name,
          commission: validator.commission,
          apy: estimatedApy,
          uptime,
          stake: validator.stake,
          stakeGrowth,
          performanceScore,
          isPhaseValidator: phaseValidators.has(validator.identity),
          rank: 0 // Will be set after sorting
        };
      });
      
      // Sort based on criteria
      let sortFn: (a: any, b: any) => number;
      switch (sortBy) {
        case 'uptime':
          sortFn = (a, b) => b.uptime - a.uptime;
          break;
        case 'stake':
          sortFn = (a, b) => b.stake - a.stake;
          break;
        case 'apy':
        default:
          sortFn = (a, b) => b.apy - a.apy;
          break;
      }
      
      const sortedValidators = validatorsWithMetrics.sort(sortFn);
      
      // Set rankings and limit results
      const topValidators = sortedValidators.slice(0, limit).map((validator, index) => ({
        ...validator,
        rank: index + 1
      }));
      
      const phaseValidatorCount = topValidators.filter(v => v.isPhaseValidator).length;
      const responseTime = Date.now() - startTime;
      
      return {
        validators: topValidators,
        sortBy,
        limit,
        epoch: epochInfo.epoch,
        timestamp: Date.now(),
        meta: {
          responseTimeMs: responseTime,
          totalValidators: validatorData.totalValidators,
          phaseValidators: phaseValidatorCount
        }
      };
      
    } catch (error) {
      console.error('Error fetching top validators:', error);
      throw new Error(`Failed to fetch top validators: ${error}`);
    }
  }

  /**
   * Get currently delinquent validators
   */
  async getDelinquentValidators(): Promise<import('../types/validator').DelinquentAlertsResponse> {
    try {
      console.log('Fetching delinquent validators...');
      const startTime = Date.now();
      
      // Get current slot and epoch info
      const currentSlot = await this.connection.getSlot();
      const epochInfo = await this.connection.getEpochInfo();
      
      // Get all vote accounts
      const voteAccounts = await this.connection.getVoteAccounts();
      const delinquentVoteAccounts = voteAccounts.delinquent || [];
      
      // Get validator names
      const voteAccountPubkeys = delinquentVoteAccounts.map(v => v.votePubkey);
      const validatorInfoMap = await this.fetchValidatorInfoBatch(voteAccountPubkeys);
      
      // Phase validator addresses
      const phaseValidators = new Set([
        // Add Phase validator vote accounts here when known
        'PhaseZkVtXkkLvH3PL4QGzPYkZYGqzfCGTkfSF4YE7', // Example
      ]);
      
      const delinquentValidators: import('../types/validator').DelinquentValidator[] = delinquentVoteAccounts.map(validator => {
        const lastVote = (validator as any).lastVote || null;
        const slotsSinceLastVote = lastVote ? currentSlot - lastVote : 0;
        
        // Estimate time: ~400ms per slot on average
        const minutesSinceLastVote = Math.floor((slotsSinceLastVote * 0.4) / 60);
        
        return {
          voteAccount: validator.votePubkey,
          name: validatorInfoMap.get(validator.votePubkey) || null,
          lastVote,
          slotsSinceLastVote,
          minutesSinceLastVote,
          stakeAtRisk: validator.activatedStake,
          commission: validator.commission,
          isPhaseValidator: phaseValidators.has(validator.votePubkey)
        };
      });
      
      const totalStakeAtRisk = delinquentValidators.reduce(
        (sum, validator) => sum + validator.stakeAtRisk, 0
      );
      
      const phaseValidatorsDelinquent = delinquentValidators.filter(
        v => v.isPhaseValidator
      ).length;
      
      const responseTime = Date.now() - startTime;
      
      return {
        delinquentValidators,
        totalDelinquent: delinquentValidators.length,
        totalStakeAtRisk,
        currentSlot,
        epoch: epochInfo.epoch,
        timestamp: Date.now(),
        meta: {
          responseTimeMs: responseTime,
          phaseValidatorsDelinquent
        }
      };
      
    } catch (error) {
      console.error('Error fetching delinquent validators:', error);
      throw new Error(`Failed to fetch delinquent validators: ${error}`);
    }
  }

  /**
   * Calculate validator performance score (0-100)
   */
  private calculateValidatorPerformanceScore(
    apy: number,
    uptime: number,
    skipRate: number,
    commission: number
  ): number {
    // Weight factors
    const apyWeight = 0.3;
    const uptimeWeight = 0.4;
    const skipRateWeight = 0.2;
    const commissionWeight = 0.1;
    
    // Normalize values to 0-100 scale
    const normalizedAPY = Math.min((apy / 10) * 100, 100); // Max APY of 10%
    const normalizedUptime = uptime; // Already 0-100
    const normalizedSkipRate = Math.max(0, 100 - skipRate); // Invert skip rate
    const normalizedCommission = Math.max(0, 100 - commission); // Lower commission is better
    
    const score = (
      normalizedAPY * apyWeight +
      normalizedUptime * uptimeWeight +
      normalizedSkipRate * skipRateWeight +
      normalizedCommission * commissionWeight
    );
    
    return Math.round(Math.max(0, Math.min(100, score)));
  }
}