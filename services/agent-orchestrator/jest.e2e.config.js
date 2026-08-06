export default {
  testEnvironment: "node",
  testMatch: ["<rootDir>/__e2e__/**/*.test.ts"],
  testTimeout: 180_000,
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { useESM: true }],
  },
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
};
