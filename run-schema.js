import 'dotenv/config'; // Carga las variables de entorno desde .env
import { readFile } from 'fs/promises';
import { Client } from 'pg';

// Configuración de la base de datos
const client = new Client({
  user: process.env.VITE_POSTGRES_USER, // Usuario desde .env
  host: process.env.VITE_POSTGRES_HOST, // Host desde .env
  database: process.env.VITE_POSTGRES_DB, // Base de datos desde .env
  password: process.env.VITE_POSTGRES_PASSWORD, // Contraseña desde .env
  port: process.env.VITE_POSTGRES_PORT, // Puerto desde .env
});

async function runSchema() {
  try {
    // Conectar a la base de datos
    await client.connect();

    // Leer el archivo schema.sql
    const schema = await readFile('./schema.sql', 'utf8');

    // Ejecutar el esquema
    await client.query(schema);
    console.log('Esquema ejecutado correctamente.');
  } catch (err) {
    console.error('Error ejecutando el esquema:', err);
  } finally {
    // Cerrar la conexión
    await client.end();
  }
}

runSchema();