import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit runs from this package, while the environment file lives at the
// repository root so that every workspace reads the same one.
config({ path: '../../.env' });

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  // Ask before running anything destructive, and show the statements being applied.
  strict: true,
  verbose: true,
});
