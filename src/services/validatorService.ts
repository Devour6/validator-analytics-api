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
  ValidatorInfoProgramData
} from '../types/validator';

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
}