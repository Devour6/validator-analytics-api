/**
 * Validator Analytics API Types
 * On-chain data structures for Solana validators
 */

export interface ValidatorInfo {
  /** Validator vote account public key */
  identity: string;
  
  /** Validator name from validator-info program */
  name: string | null;
  
  /** Delegated stake amount in lamports */
  stake: number;
  
  /** Commission percentage (0-100) */
  commission: number;
  
  /** Activated stake amount in lamports */
  activatedStake: number;
  
  /** Whether the vote account is active in current epoch */
  epochVoteAccount: boolean;
  
  /** Validator node public key */
  nodePubkey: string;
  
  /** Root slot for this validator */
  rootSlot: number | null;
  
  /** Last vote for this validator */
  lastVote: number | null;
  
  /** Credits for current epoch */
  epochCredits: Array<[number, number, number]>;
}

export interface ValidatorInfoResponse {
  /** Array of validator information */
  validators: ValidatorInfo[];
  
  /** Current epoch number */
  epoch: number;
  
  /** Total number of validators */
  totalValidators: number;
  
  /** Total active stake across all validators */
  totalStake: number;
  
  /** Timestamp of data fetch */
  timestamp: number;
}

// Use types from @solana/web3.js instead of redefining them

export interface ValidatorInfoProgramData {
  name?: string;
  website?: string;
  details?: string;
  keybaseUsername?: string;
}