import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
  rootDir: 'src',
  preset: 'ts-jest',
  moduleFileExtensions: ['js', 'ts', 'json'],
  modulePaths: ['<rootDir>/src'],
  transform: {
    // Transpile only: type checking is the typecheck job's responsibility, and it avoids
    // needing prebuilt `dist/` type declarations of sibling workspace packages.
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true }],
  },
  collectCoverageFrom: ['src/**', '!**/*.d.ts'],
};

export default config;
