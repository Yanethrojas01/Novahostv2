interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_POSTGRES_HOST: string;
  readonly VITE_POSTGRES_PORT: string;
  readonly VITE_POSTGRES_USER: string;
  readonly VITE_POSTGRES_PASSWORD: string;
  readonly VITE_POSTGRES_DB: string;
  readonly VITE_USE_POSTGRES: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
