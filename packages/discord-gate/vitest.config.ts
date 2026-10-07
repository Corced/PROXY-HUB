import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: ['./tests/globalSetup.ts'],
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        'dist/',
        'src/config/discordGateConfig.ts',
        'src/routes/auth.ts',
      ],
    },
    alias: {
      '@proxy-hub/discord-gate': path.resolve(__dirname, 'src'),
      '@proxy-hub/discord-gate/tests': path.resolve(__dirname, 'tests'),
    },
  },
});