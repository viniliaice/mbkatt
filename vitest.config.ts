import { defineConfig } from 'vitest/config';
import path from 'node:path';
import fs from 'node:fs';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    globals: false,
  },
  plugins: [
    {
      // `?raw` imports for fixtures, mirroring the Vite behaviour used by the app
      name: 'raw-fixtures',
      enforce: 'pre',
      load(id) {
        if (!id.includes('?raw')) return null;
        const file = id.replace('?raw', '');
        if (!fs.existsSync(file)) return null;
        const content = fs.readFileSync(file, 'utf8');
        return `export default ${JSON.stringify(content)};`;
      },
    },
  ],
});
