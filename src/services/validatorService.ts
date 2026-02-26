/**
 * Validator Service
 * Fetches validator data from Solana RPC only - no third-party APIs
 */

import { Connection, PublicKey, AccountInfo, VoteAccountInfo, VoteAccountStatus } from '@solana/web3.js';
import { 
  ValidatorInfo, 
  ValidatorInfoResponse, 
  ValidatorInfoProgramData
} from '../types/validator';

export class ValidatorService {
  private connection: Connection;
  private readonly VALIDATOR_INFO_PROGRAM_ID = new PublicKey('Va1idkzkB6LEmVFmxWbWU5Ao17SMcTLofw1bh6qr5RP');

  constructor(rpcUrl: string = 'https://api.mainnet-beta.solana.com') {
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  /**
   * Get all validators with their metadata from on-chain sources
   */
  async getValidators(): Promise<ValidatorInfoResponse> {
    try {
      console.log('Fetching vote accounts from RPC...');
      
      // Get current epoch
      const epochInfo = await this.connection.getEpochInfo();
      
      // Fetch all vote accounts
      const voteAccounts: VoteAccountStatus = await this.connection.getVoteAccounts();
      
      console.log(`Found ${voteAccounts.current.length} active validators and ${voteAccounts.delinquent.length} delinquent validators`);
      
      // Combine current and delinquent validators
      const allValidators = [...voteAccounts.current, ...voteAccounts.delinquent];
      
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
    const BATCH_SIZE = 100; // Reasonable batch size to avoid RPC limits
    
    console.log(`Fetching validator info for ${votePubkeys.length} validators in batches of ${BATCH_SIZE}...`);
    
    for (let i = 0; i < votePubkeys.length; i += BATCH_SIZE) {
      const batch = votePubkeys.slice(i, i + BATCH_SIZE);
      await this.processBatch(batch, validatorInfoMap);
      
      // Small delay to be respectful to RPC endpoint
      await new Promise(resolve => setTimeout(resolve, 100));
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
   * Get validator name from validator-info program
   */
  private async getValidatorName(votePubkey: string): Promise<string | null> {
    try {
      // Derive the validator info account PDA
      const [validatorInfoAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from('validator-info'), new PublicKey(votePubkey).toBuffer()],
        this.VALIDATOR_INFO_PROGRAM_ID
      );
      
      // Get the account data
      const accountInfo: AccountInfo<Buffer> | null = await this.connection.getAccountInfo(validatorInfoAccount);
      
      if (!accountInfo || !accountInfo.data) {
        return null;
      }
      
      // Parse the validator info data (simplified parsing)
      const data = this.parseValidatorInfoData(accountInfo.data);
      return data.name || null;
      
    } catch (error) {
      console.debug(`Error fetching validator info for ${votePubkey}:`, error);
      return null;
    }
  }

  /**
   * Parse validator info program data (simplified)
   * The actual format is more complex, but this extracts the name field
   */
  private parseValidatorInfoData(data: Buffer): ValidatorInfoProgramData {
    try {
      // Skip the discriminator (8 bytes) and parse the ConfigData struct
      // This is a simplified parser - full implementation would need proper borsh deserialization
      
      let offset = 8; // Skip discriminator
      
      // Read the config data (this is a simplified approach)
      // In production, you'd want to use borsh to properly deserialize
      
      // For now, let's try to extract strings that look like names
      const dataStr = data.toString('utf8', offset);
      
      // Look for patterns that might be validator names
      // This is a heuristic approach - proper implementation would decode the borsh format
      const nameMatch = dataStr.match(/([A-Za-z0-9\s\-_\.]+)/);
      
      return {
        name: nameMatch ? nameMatch[1].trim() : undefined
      };
      
    } catch (error) {
      console.debug('Error parsing validator info data:', error);
      return {};
    }
  }

  /**
   * Health check - verify RPC connection is working
   */
  async healthCheck(): Promise<{ status: string; blockHeight: number; epoch: number }> {
    try {
      const slot = await this.connection.getSlot();
      const epochInfo = await this.connection.getEpochInfo();
      
      return {
        status: 'healthy',
        blockHeight: slot,
        epoch: epochInfo.epoch
      };
    } catch (error) {
      throw new Error(`RPC health check failed: ${error}`);
    }
  }
}