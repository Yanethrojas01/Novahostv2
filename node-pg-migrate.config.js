export const dir = 'supabase/migrations';
export const direction = 'up';
export const logFileName = 'pg-migrate.log';
export const databaseUrl = process.env.DATABASE_URL || `postgres://${process.env.VITE_POSTGRES_USER}:${process.env.VITE_POSTGRES_PASSWORD}@${process.env.VITE_POSTGRES_HOST}:${process.env.VITE_POSTGRES_PORT}/${process.env.VITE_POSTGRES_DB}`;
