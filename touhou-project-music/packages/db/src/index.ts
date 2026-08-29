import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

declare global {
  // eslint-disable-next-line no-var
  var __thm_db_client: ReturnType<typeof postgres> | undefined;
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

const client = globalThis.__thm_db_client ?? postgres(connectionString, { prepare: false });
if (process.env.NODE_ENV !== 'production') globalThis.__thm_db_client = client;

export const db = drizzle(client, { schema, casing: 'snake_case' });
export { schema };
export * from './schema';
export type Database = typeof db;
