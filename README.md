# Novahost

Novahost is a modern web application for managing virtual machines across Proxmox and vSphere environments. It provides a unified interface for creating, monitoring, and managing VMs across different hypervisor platforms.

## Features

- 🖥️ Unified VM management for Proxmox and vSphere
- 🚀 Create and manage VMs with an intuitive interface
- 📊 Real-time monitoring and metrics
- 📈 VM creation statistics with date range selection and daily charts (`Stats.tsx`)
- ℹ️ Detailed hypervisor view showing nodes, storage, templates, resource usage per node, and capacity predictions (`HypervisorDetails.tsx`)
- 👤 User profile management page (`Profile.tsx`)
- 🔐 Secure authentication and role-based access control
- 🌙 Dark mode support
- 🔄 Real-time updates and notifications

## Tech Stack

- Frontend: React + TypeScript + Vite
- Styling: Tailwind CSS
- State Management: React Query + Jotai
- Database: Supabase or PostgreSQL
- Authentication: Supabase Auth (when using Supabase)
- API: Express.js

## Prerequisites

- Node.js 18.x or higher
- npm 9.x or higher
- A Supabase account (if using Supabase)

## Development Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/yourusername/vm-forge.git
   cd vm-forge
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Set up the database connection:

   - To use Supabase:
     - Create a new project in Supabase
     - Click "Connect to Supabase" in the top right of the editor
     - Follow the setup wizard to connect your project
     - Create a `.env` file in the root directory with:

       ```env
       VITE_SUPABASE_URL=your_supabase_url
       VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
       VITE_USE_POSTGRES=false
       JWT_SECRET=your_very_strong_and_secret_jwt_key # Needed for signing authentication tokens
       ```

   - To use PostgreSQL:
     - Set up a PostgreSQL database instance
     - Create a `.env` file in the root directory with:

       ```env
       VITE_POSTGRES_HOST=your_postgres_host
       VITE_POSTGRES_PORT=5432
       VITE_POSTGRES_USER=your_postgres_user
       VITE_POSTGRES_PASSWORD=your_postgres_password
       VITE_POSTGRES_DB=your_postgres_database
       VITE_USE_POSTGRES=true
       JWT_SECRET=your_very_strong_and_secret_jwt_key # Needed for signing authentication tokens
       ```


     - **Generate Default Admin Password Hash:**
       - Run the script to generate a bcrypt hash for your desired default admin password:

         ```bash
         node server/generate-hash.js your_chosen_password
         ```

       - Copy the generated hash output (the long string starting with `$2b$10$...`).
       - Paste this hash into the `INSERT INTO users` statement within the `migrations/schema.sql` file, replacing the placeholder `'YOUR_BCRYPT_HASH_HERE'`.
     - Run migrations to create the database schema:

       ```bash
       npm run migrate:up
       ```

     - To create new migrations for schema changes:

       ```bash
       npm run migrate:create -- migration_name
       ```

- **Generate Default Admin Password Hash:**
  - Run the script to generate a bcrypt hash for your desired default admin password:

       ```bash
       node server/generate-hash.js your_chosen_password
       ```

  - Copy the generated hash output (the long string starting with `$2b$10$...`).
  - Paste this hash into the `INSERT INTO users` statement within the `migrations/schema.sql` file, replacing the placeholder `'YOUR_BCRYPT_HASH_HERE'`.

4. Start the development server:

   ```bash
   npm run dev
   ```

5. Start the backend server:

   ```bash
   npm run server
   ```

The application will be available at `http://localhost:5173`
       VITE_USE_POSTGRES=false

## Production Deployment

1. Build the application:

   ```bash
   npm run build
   ```

2. The build output will be in the `dist` directory. Deploy this to your hosting provider.

3. Set up environment variables in your hosting platform:

   - If using Supabase:
     - `VITE_SUPABASE_URL`
     - `VITE_SUPABASE_ANON_KEY`
     - `VITE_USE_POSTGRES=false`

   - If using PostgreSQL:
     - `VITE_POSTGRES_HOST`
     - `VITE_POSTGRES_PORT`
     - `VITE_POSTGRES_USER`
     - `VITE_POSTGRES_PASSWORD`
     - `VITE_POSTGRES_DB`
     - `VITE_USE_POSTGRES=true`

4. Deploy the backend server:
   - Set up a Node.js environment
   - Install dependencies: `npm install`
   - Start the server: `npm run server`
   - Configure your reverse proxy to forward API requests to the backend server

## Database Schema

The application uses the following main tables:

- When using Supabase:

  - `hypervisors` - Stores hypervisor connection details
  - `virtual_machines` - Stores VM information
  - `vm_metrics` - Stores VM performance metrics
  - `users` - Managed by Supabase Auth

- When using PostgreSQL:

  - The same tables as Supabase should be created manually or via migrations:
    - `hypervisors`
    - `virtual_machines`
    - `vm_metrics`
    - `users` (authentication needs to be handled separately)

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -am 'Add new feature'`
4. Push to the branch: `git push origin feature/my-feature`
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
