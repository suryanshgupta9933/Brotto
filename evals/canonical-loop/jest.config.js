/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^@fara/agent-orchestrator$': '<rootDir>/../../services/agent-orchestrator/src/index.ts',
    '^@fara-platform/fara-action-schema$': '<rootDir>/../../packages/fara-action-schema/src/index.ts',
    '^@fara-platform/relay-protocol$': '<rootDir>/../../packages/relay-protocol/src/index.ts',
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
          '../../services/agent-orchestrator/node_modules/.pnpm/node_modules/@types',
          '../../clients/browser-extension/node_modules/@types'
        ],
        baseUrl: '.',
        paths: {
          '@fara/agent-orchestrator': ['../../services/agent-orchestrator/src/index.ts'],
          '@fara-platform/fara-action-schema': ['../../packages/fara-action-schema/src/index.ts'],
          '@fara-platform/relay-protocol': ['../../packages/relay-protocol/src/index.ts']
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
