/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      diagnostics: false,
    }],
  },
  // Always mock Telegram in every jest run — prevents accidental real API calls
  // regardless of how jest is invoked (npm script, npx jest, IDE test runner, etc.)
  testEnvironmentOptions: {},
  globalSetup: undefined,
  setupFiles: ['<rootDir>/tests/setup.ts'],
};
