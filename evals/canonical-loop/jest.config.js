/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^@brotto/agent-orchestrator$': '<rootDir>/../../services/brotto-orchestrator/src/index.ts',
    '^@brotto/brotto-action-schema$': '<rootDir>/../../packages/brotto-action-schema/src/index.ts',
    '^@brotto/relay-protocol$': '<rootDir>/../../packages/brotto-relay-protocol/src/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'node',
        lib: ['ES2022', 'DOM'],
        types: ['jest', 'node', 'chrome'],
        typeRoots: [
          '../../services/brotto-orchestrator/node_modules/.pnpm/node_modules/@types',
          '../../clients/brotto-extension/node_modules/@types'
        ],
        baseUrl: '.',
        paths: {
          '@brotto/agent-orchestrator': ['../../services/brotto-orchestrator/src/index.ts'],
          '@brotto/brotto-action-schema': ['../../packages/brotto-action-schema/src/index.ts'],
          '@brotto/relay-protocol': ['../../packages/brotto-relay-protocol/src/index.ts']
        },
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true
      }
    }]
  },
  testMatch: ['**/*.test.ts'],
  verbose: true
};
