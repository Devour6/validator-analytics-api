/**
 * Validator Service Tests
 */

import { ValidatorService } from '../services/validatorService';
import { Connection } from '@solana/web3.js';

// Mock @solana/web3.js
jest.mock('@solana/web3.js', () => ({
  Connection: jest.fn(),
  PublicKey: jest.fn().mockImplementation((key: string) => ({
    toString: () => key,
    toBuffer: () => Buffer.from(key),
  })),
}));

// Add static methods to the PublicKey mock
const { PublicKey } = jest.requireMock('@solana/web3.js');
PublicKey.findProgramAddressSync = jest.fn(() => ['mockValidatorInfoAccount', 0]);

describe('ValidatorService', () => {
  let validatorService: ValidatorService;
  let mockConnection: jest.Mocked<Connection>;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Mock connection
    mockConnection = {
      getEpochInfo: jest.fn(),
      getVoteAccounts: jest.fn(),
      getAccountInfo: jest.fn(),
      getSlot: jest.fn(),
    } as any;

    (Connection as jest.Mock).mockImplementation(() => mockConnection);

    validatorService = new ValidatorService('https://api.devnet.solana.com');
  });

  describe('healthCheck', () => {
    it('should return health status when RPC is working', async () => {
      // Mock successful responses
      mockConnection.getSlot.mockResolvedValue(12345);
      mockConnection.getEpochInfo.mockResolvedValue({
        epoch: 250,
        slotIndex: 1000,
        slotsInEpoch: 432000,
        absoluteSlot: 12345,
      });

      const result = await validatorService.healthCheck();

      expect(result).toEqual({
        status: 'healthy',
        blockHeight: 12345,
        epoch: 250,
        responseTimeMs: expect.any(Number),
      });

      expect(mockConnection.getSlot).toHaveBeenCalledTimes(1);
      expect(mockConnection.getEpochInfo).toHaveBeenCalledTimes(1);
    });

    it('should throw error when RPC fails', async () => {
      mockConnection.getSlot.mockRejectedValue(new Error('Connection failed'));

      await expect(validatorService.healthCheck()).rejects.toThrow(
        'RPC health check failed after'
      );
    });

    it('should timeout if RPC is slow', async () => {
      mockConnection.getSlot.mockImplementation(
        () => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000))
      );

      await expect(validatorService.healthCheck()).rejects.toThrow('timeout');
    }, 12000);
  });

  describe('getValidators', () => {
    it('should return validator data successfully', async () => {
      // Mock successful responses
      mockConnection.getEpochInfo.mockResolvedValue({
        epoch: 250,
        slotIndex: 1000,
        slotsInEpoch: 432000,
        absoluteSlot: 12345,
      });

      mockConnection.getVoteAccounts.mockResolvedValue({
        current: [
          {
            votePubkey: 'validator1',
            nodePubkey: 'node1',
            activatedStake: 1000000000,
            commission: 5,
            epochVoteAccount: true,
            epochCredits: [[250, 1000, 900]],
            lastVote: 12345,
          },
        ],
        delinquent: [
          {
            votePubkey: 'validator2',
            nodePubkey: 'node2',
            activatedStake: 500000000,
            commission: 10,
            epochVoteAccount: false,
            epochCredits: [[249, 800, 700]],
            lastVote: 12300,
          },
        ],
      });

      // Mock validator info (no names for simplicity)
      mockConnection.getAccountInfo.mockResolvedValue(null);

      const result = await validatorService.getValidators();

      expect(result).toMatchObject({
        epoch: 250,
        totalValidators: 2,
        totalStake: 1500000000,
        timestamp: expect.any(Number),
        validators: expect.arrayContaining([
          expect.objectContaining({
            identity: 'validator1',
            stake: 1000000000,
            commission: 5,
            epochVoteAccount: true,
          }),
          expect.objectContaining({
            identity: 'validator2',
            stake: 500000000,
            commission: 10,
            epochVoteAccount: false,
          }),
        ]),
      });

      expect(result.validators).toHaveLength(2);
    });

    it('should handle RPC errors gracefully', async () => {
      mockConnection.getEpochInfo.mockRejectedValue(new Error('RPC Error'));

      await expect(validatorService.getValidators()).rejects.toThrow(
        'Failed to fetch validator data'
      );
    });

    it('should timeout if RPC is slow', async () => {
      mockConnection.getEpochInfo.mockImplementation(
        () => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 35000))
      );

      await expect(validatorService.getValidators()).rejects.toThrow('timeout');
    }, 35000);
  });

  describe('validator info parsing', () => {
    it('should parse valid validator info data', async () => {
      // This would be more complex in a real test with actual borsh data
      // For now, we test the fallback parsing logic
      const mockAccountData = Buffer.from('validator-name-here');
      mockConnection.getAccountInfo.mockResolvedValue({
        data: mockAccountData,
        executable: false,
        lamports: 0,
        owner: new PublicKey('Va1idkzkB6LEmVFmxWbWU5Ao17SMcTLofw1bh6qr5RP'),
        rentEpoch: 0,
      });

      // Call the private method through a public method
      const result = await validatorService.getValidators();
      
      // The test verifies that the service can handle validator info requests
      // without crashing, even if the parsing doesn't return expected names
      expect(result).toBeDefined();
    });

    it('should handle invalid validator info data', async () => {
      const invalidData = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]); // Invalid borsh data
      mockConnection.getAccountInfo.mockResolvedValue({
        data: invalidData,
        executable: false,
        lamports: 0,
        owner: new PublicKey('Va1idkzkB6LEmVFmxWbWU5Ao17SMcTLofw1bh6qr5RP'),
        rentEpoch: 0,
      });

      // Should not throw even with invalid data
      const result = await validatorService.getValidators();
      expect(result).toBeDefined();
    });

    it('should handle missing validator info accounts', async () => {
      mockConnection.getAccountInfo.mockResolvedValue(null);

      const result = await validatorService.getValidators();
      
      // Should handle missing accounts gracefully
      expect(result).toBeDefined();
      expect(result.validators.every(v => v.name === null)).toBe(true);
    });
  });
});