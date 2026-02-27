/**
 * Quick Validator Service Tests - Mocked for speed
 */

import { ValidatorService } from '../services/validatorService';

// Mock all Solana dependencies
jest.mock('@solana/web3.js', () => {
  const mockConnection = {
    getEpochInfo: jest.fn().mockResolvedValue({ epoch: 1030 }),
    getVoteAccounts: jest.fn().mockResolvedValue({
      current: [
        {
          votePubkey: 'test1',
          nodePubkey: 'node1',
          activatedStake: 1000000000,
          commission: 5,
          epochVoteAccount: true,
          epochCredits: []
        }
      ],
      delinquent: []
    }),
    getAccountInfo: jest.fn().mockResolvedValue(null),
    getSlot: jest.fn().mockResolvedValue(12345),
    getBlockHeight: jest.fn().mockResolvedValue(12345),
  };

  const mockPublicKey: any = jest.fn().mockImplementation((key) => ({
    toString: () => key,
    toBuffer: () => Buffer.from(key),
  }));
  
  mockPublicKey.findProgramAddressSync = jest.fn().mockReturnValue(['mockAddress', 0]);

  return {
    Connection: jest.fn().mockImplementation(() => mockConnection),
    PublicKey: mockPublicKey,
  };
});

describe('ValidatorService - Mocked Tests', () => {
  let service: ValidatorService;

  beforeEach(() => {
    service = new ValidatorService('https://api.devnet.solana.com');
    jest.clearAllMocks();
  });

  it('should create validator service instance', () => {
    expect(service).toBeInstanceOf(ValidatorService);
  });

  it('should fetch validators successfully', async () => {
    const result = await service.getValidators();
    
    expect(result).toBeDefined();
    expect(result.validators).toBeInstanceOf(Array);
    expect(result.epoch).toBe(1030);
    expect(result.totalValidators).toBeGreaterThanOrEqual(0);
    expect(result.timestamp).toBeDefined();
  });

  it('should perform health check', async () => {
    const health = await service.healthCheck();
    
    expect(health).toBeDefined();
    expect(health.status).toBe('healthy');
    expect(health.blockHeight).toBeDefined();
    expect(health.responseTimeMs).toBeDefined();
  });
});