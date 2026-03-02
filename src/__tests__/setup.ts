// Test setup file
import dotenv from 'dotenv';

// Load environment variables for testing
dotenv.config({ path: '.env.test' });

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

// Global test timeout
jest.setTimeout(15000);

// Mock console methods to reduce noise in tests (but allow errors to show)
const originalError = console.error;
const originalWarn = console.warn;
const originalLog = console.log;

beforeAll(() => {
  console.warn = jest.fn();
  console.log = jest.fn();
  // Keep console.error for debugging
});

afterAll(async () => {
  console.error = originalError;
  console.warn = originalWarn;
  console.log = originalLog;
  
  // Give time for async operations to complete
  await new Promise(resolve => setTimeout(resolve, 100));
});

// Suppress specific Solana rate limiting warnings during tests
beforeEach(() => {
  const originalConsoleError = console.error;
  console.error = (...args: any[]) => {
    const message = args.join(' ');
    if (
      message.includes('Too Many Requests') ||
      message.includes('429') ||
      message.includes('rate limit') ||
      message.includes('Retrying after')
    ) {
      return; // Suppress these specific errors
    }
    originalConsoleError.apply(console, args);
  };
});

afterEach(async () => {
  // Clean up any hanging connections
  await new Promise(resolve => setTimeout(resolve, 50));
});