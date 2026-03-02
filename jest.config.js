module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  testPathIgnorePatterns: [
    '/node_modules/', 
    'src/__tests__/validatorService.test.ts',     // Skip integration test that makes real RPC calls
    'src/__tests__/validatorAnalytics.test.ts'   // Skip if it makes real RPC calls
  ],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/__tests__/**/*',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  testTimeout: 15000,
  maxWorkers: 1,
  forceExit: true, // Force Jest to exit after tests complete
  detectOpenHandles: true, // Help debug async issues
};