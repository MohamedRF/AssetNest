import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
    // Every suite spins up its own PGlite (WASM) instance; unconstrained
    // fork fan-out crashed a worker on this Windows dev box (exit
    // 0xC0000409 at startup). Cap concurrency — still fast enough.
    pool: 'forks',
    maxWorkers: 2,
  },
});
