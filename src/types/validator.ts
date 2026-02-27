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

// Network Aggregation Types

/**
 * Network-wide staking statistics
 */
export interface NetworkStats {
  /** Total number of validators (active + delinquent) */
  totalValidators: number;
  
  /** Number of active validators */
  activeValidators: number;
  
  /** Number of delinquent validators */
  delinquentValidators: number;
  
  /** Total stake across all validators in lamports */
  totalStake: number;
  
  /** Average stake per validator in lamports */
  averageStake: number;
  
  /** Network-wide APY estimate (%) */
  networkAPY: number;
  
  /** Nakamoto coefficient (validators needed for 33% stake) */
  nakamotoCoefficient: number;
  
  /** Current epoch number */
  epoch: number;
  
  /** Slots in current epoch */
  slotsInEpoch: number;
  
  /** Current slot index in epoch */
  slotIndex: number;
  
  /** Epoch progress percentage */
  epochProgress: number;
  
  /** Timestamp when data was collected */
  timestamp: number;
}

/**
 * Validator comparison data
 */
export interface ValidatorComparison {
  /** Vote account public key */
  voteAccount: string;
  
  /** Validator name */
  name: string | null;
  
  /** Commission percentage */
  commission: number;
  
  /** Estimated APY percentage */
  apy: number;
  
  /** Uptime percentage (based on epoch credits) */
  uptime: number;
  
  /** Skip rate percentage */
  skipRate: number;
  
  /** Total stake in lamports */
  stake: number;
  
  /** Performance score (0-100) */
  performanceScore: number;
  
  /** Whether this is a Phase validator */
  isPhaseValidator: boolean;
  
  /** Last vote slot */
  lastVote: number | null;
  
  /** Whether validator is currently delinquent */
  isDelinquent: boolean;
}

/**
 * Validator comparison response
 */
export interface ValidatorComparisonResponse {
  /** Array of compared validators */
  validators: ValidatorComparison[];
  
  /** Validators that were requested but not found */
  notFound: string[];
  
  /** Current epoch */
  epoch: number;
  
  /** Timestamp */
  timestamp: number;
  
  /** Response metadata */
  meta: {
    responseTimeMs: number;
    requestedCount: number;
    foundCount: number;
  };
}

/**
 * Top validators leaderboard entry
 */
export interface TopValidator {
  /** Vote account public key */
  voteAccount: string;
  
  /** Validator name */
  name: string | null;
  
  /** Commission percentage */
  commission: number;
  
  /** Estimated APY percentage */
  apy: number;
  
  /** Uptime percentage */
  uptime: number;
  
  /** Total stake in lamports */
  stake: number;
  
  /** Stake growth percentage (last epoch) */
  stakeGrowth: number;
  
  /** Performance score */
  performanceScore: number;
  
  /** Whether this is a Phase validator */
  isPhaseValidator: boolean;
  
  /** Ranking position */
  rank: number;
}

/**
 * Top validators response
 */
export interface TopValidatorsResponse {
  /** Array of top validators */
  validators: TopValidator[];
  
  /** Sort criteria used */
  sortBy: 'apy' | 'uptime' | 'stake';
  
  /** Number of validators returned */
  limit: number;
  
  /** Current epoch */
  epoch: number;
  
  /** Timestamp */
  timestamp: number;
  
  /** Response metadata */
  meta: {
    responseTimeMs: number;
    totalValidators: number;
    phaseValidators: number;
  };
}

/**
 * Delinquent validator alert
 */
export interface DelinquentValidator {
  /** Vote account public key */
  voteAccount: string;
  
  /** Validator name */
  name: string | null;
  
  /** Last vote slot */
  lastVote: number | null;
  
  /** Slots since last vote */
  slotsSinceLastVote: number;
  
  /** Estimated time since last vote in minutes */
  minutesSinceLastVote: number;
  
  /** Total stake at risk in lamports */
  stakeAtRisk: number;
  
  /** Commission percentage */
  commission: number;
  
  /** Whether this is a Phase validator */
  isPhaseValidator: boolean;
}

/**
 * Delinquent alerts response
 */
export interface DelinquentAlertsResponse {
  /** Array of delinquent validators */
  delinquentValidators: DelinquentValidator[];
  
  /** Total number of delinquent validators */
  totalDelinquent: number;
  
  /** Total stake at risk across all delinquent validators */
  totalStakeAtRisk: number;
  
  /** Current slot */
  currentSlot: number;
  
  /** Current epoch */
  epoch: number;
  
  /** Timestamp */
  timestamp: number;
  
  /** Response metadata */
  meta: {
    responseTimeMs: number;
    phaseValidatorsDelinquent: number;
  };
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