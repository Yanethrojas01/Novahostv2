import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// PostgreSQL client setup
const pgHost = import.meta.env.VITE_POSTGRES_HOST;
const pgPort = import.meta.env.VITE_POSTGRES_PORT ? parseInt(import.meta.env.VITE_POSTGRES_PORT) : 5432;
const pgUser = import.meta.env.VITE_POSTGRES_USER;
const pgPassword = import.meta.env.VITE_POSTGRES_PASSWORD;
const pgDatabase = import.meta.env.VITE_POSTGRES_DB;

if (!pgHost || !pgUser || !pgPassword || !pgDatabase) {
  console.warn('PostgreSQL environment variables are not fully set. PostgreSQL client will not be initialized.');
}

export const pgPool = (pgHost && pgUser && pgPassword && pgDatabase) ? new Pool({
  host: pgHost,
  port: pgPort,
  user: pgUser,
  password: pgPassword,
  database: pgDatabase,
}) : null;

// Unified client selector based on environment variable
const usePostgres = import.meta.env.VITE_USE_POSTGRES === 'true';

export const dbClient = usePostgres ? pgPool : supabase;
