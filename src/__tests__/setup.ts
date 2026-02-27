// Test setup file
import dotenv from 'dotenv';

// Load environment variables for testing
dotenv.config({ path: '.env.test' });

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

// Global test timeout
jest.setTimeout(30000);

// Mock console methods to reduce noise in tests
const originalError = console.error;
const originalWarn = console.warn;
const originalLog = console.log;

beforeAll(() => {
  console.error = jest.fn();
  console.warn = jest.fn();
  console.log = jest.fn();
});

afterAll(async () => {
  console.error = originalError;
  console.warn = originalWarn;
  console.log = originalLog;
  
  // Clear all timers to prevent Jest from hanging
  jest.clearAllTimers();
  jest.clearAllMocks();
  
  // Force close any remaining handles
  if ((global as any).__GLOBAL_TEST_SERVER__) {
    try {
      await (global as any).__GLOBAL_TEST_SERVER__.stop();
    } catch (error) {
      console.error('Error stopping test server:', error);
    }
  }
  
  // Give a moment for cleanup
  await new Promise(resolve => setTimeout(resolve, 100));
});