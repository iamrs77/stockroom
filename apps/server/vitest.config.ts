import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the "@/..." import paths defined in tsconfig.json.
  resolve: { tsconfigPaths: true },
  test: {
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
});
