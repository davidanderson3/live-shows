import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  resolve: {
    alias: {
      supertest: path.resolve(__dirname, 'tests/helpers/mockSupertest.js')
    }
  },
  test: {
    include: ['tests/shows*.test.js'],
    exclude: ['node_modules/**', 'tests/e2e/**', '.git/**', 'functions/**']
  }
});
