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

// V2 Types - Deep Analytics

export interface ValidatorDetailInfo {
  /** Validator vote account public key */
  voteAccount: string;
  
  /** Validator identity (node) public key */
  identity: string;
  
  /** Validator name from validator-info program */
  name: string | null;
  
  /** Commission percentage (0-100) */
  commission: number;
  
  /** Last vote slot */
  lastVote: number | null;
  
  /** Root slot */
  rootSlot: number | null;
  
  /** Activated stake amount in lamports */
  activatedStake: number;
  
  /** Whether the vote account is active in current epoch */
  epochVoteAccount: boolean;
  
  /** Is currently delinquent */
  delinquent: boolean;
  
  /** Epoch credits history (last 10 epochs) */
  epochCreditsHistory: Array<{
    epoch: number;
    credits: number;
    previousCredits: number;
  }>;
  
  /** Estimated APY based on recent performance */
  estimatedApy: number;
  
  /** Skip rate percentage */
  skipRate: number;
  
  /** Current epoch performance metrics */
  currentEpochPerformance: {
    creditsEarned: number;
    expectedCredits: number;
    performanceScore: number;
  };
}

export interface ValidatorHistoryData {
  /** Validator vote account public key */
  voteAccount: string;
  
  /** Historical epoch performance */
  epochHistory: Array<{
    epoch: number;
    credits: number;
    creditsEarned: number;
    commission: number;
    activatedStake: number;
    skipRate: number;
    timestamp: number;
  }>;
  
  /** Commission changes over time */
  commissionHistory: Array<{
    epoch: number;
    commission: number;
    changedAt: number;
  }>;
  
  /** Stake changes over time */
  stakeHistory: Array<{
    epoch: number;
    activatedStake: number;
    changedAt: number;
  }>;
}

export interface CurrentEpochInfo {
  /** Current epoch number */
  epoch: number;
  
  /** Current slot index within epoch */
  slotIndex: number;
  
  /** Total slots in current epoch */
  slotsInEpoch: number;
  
  /** Epoch progress percentage (0-100) */
  progress: number;
  
  /** Estimated time remaining in epoch (milliseconds) */
  timeRemainingMs: number;
  
  /** Total active stake across all validators */
  totalActiveStake: number;
  
  /** Number of active validators */
  activeValidatorCount: number;
  
  /** Current slot */
  currentSlot: number;
  
  /** Epoch start slot */
  epochStartSlot: number;
  
  /** Timestamp of data fetch */
  timestamp: number;
}

export interface StakeAccount {
  /** Stake account public key */
  pubkey: string;
  
  /** Delegated validator vote account */
  voteAccount: string | null;
  
  /** Validator name */
  validatorName: string | null;
  
  /** Stake amount in lamports */
  stake: number;
  
  /** Account activation state */
  state: 'active' | 'activating' | 'deactivating' | 'inactive';
  
  /** Activation epoch */
  activationEpoch: number | null;
  
  /** Deactivation epoch */
  deactivationEpoch: number | null;
  
  /** Stake authority public key */
  stakeAuthority: string;
  
  /** Withdraw authority public key */
  withdrawAuthority: string;
  
  /** Rent exempt reserve */
  rentExemptReserve: number;
  
  /** Credits observed */
  creditsObserved: number;
  
  /** Estimated rewards earned (lamports) */
  estimatedRewards: number;
}

export interface WalletStakeAccountsResponse {
  /** Wallet public key */
  wallet: string;
  
  /** Array of stake accounts */
  stakeAccounts: StakeAccount[];
  
  /** Total staked amount */
  totalStaked: number;
  
  /** Total estimated rewards */
  totalEstimatedRewards: number;
  
  /** Number of validators delegated to */
  validatorCount: number;
  
  /** Timestamp of data fetch */
  timestamp: number;
}

// WebSocket Types
export interface ValidatorUpdateEvent {
  type: 'validator_performance' | 'delinquency_alert' | 'commission_change';
  voteAccount: string;
  data: any;
  timestamp: number;
}

export interface ValidatorPerformanceUpdate {
  voteAccount: string;
  currentSlot: number;
  lastVote: number | null;
  skipRate: number;
  creditsEarned: number;
}

export interface DelinquencyAlert {
  voteAccount: string;
  validatorName: string | null;
  delinquent: boolean;
  missedSlots: number;
}

export interface CommissionChangeNotification {
  voteAccount: string;
  validatorName: string | null;
  oldCommission: number;
  newCommission: number;
  epoch: number;
}

// Use types from @solana/web3.js instead of redefining them

export interface ValidatorInfoProgramData {
  name?: string;
  website?: string;
  details?: string;
  keybaseUsername?: string;
}