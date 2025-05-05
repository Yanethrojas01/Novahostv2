// Carga las variables de entorno si usas dotenv
// require('dotenv').config(); // Descomenta si necesitas cargar .env aquí

module.exports = {
    dir: '/', // Considera cambiar esto a tu directorio de migraciones real, p.ej., 'supabase/migrations'
    direction: 'up',
    logFileName: 'pg-migrate.log',
    // Usar directamente la variable DATABASE_URL definida en .env es más simple
    databaseUrl: process.env.DATABASE_URL,
    // Opcionalmente, puedes mantener la construcción de la URL si prefieres no depender
    // de la variable DATABASE_URL en .env para esta configuración específica:
    // databaseUrl: process.env.DATABASE_URL || `postgres://${process.env.VITE_POSTGRES_USER}:${process.env.VITE_POSTGRES_PASSWORD}@${process.env.VITE_POSTGRES_HOST}:${process.env.VITE_POSTGRES_PORT}/${process.env.VITE_POSTGRES_DB}`,
  
    // Asegúrate de que las migraciones se creen en el directorio correcto
    migrationsTable: 'pgmigrations', // Nombre de la tabla de migraciones (por defecto)
    // migrationFileFormat: 'js', // Opcional: formato del archivo de migración
    // checkOrder: true, // Opcional: verifica el orden de las migraciones
  };
  