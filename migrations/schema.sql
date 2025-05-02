/*
  # Initial Schema Setup (Combined & PostgreSQL Compatible)

  ## From 20250501022819_holy_wood.sql

  1. New Tables
    - `hypervisors`
    - `virtual_machines`
    - `vm_metrics`

  2. Security
    - Enable RLS on all tables
    - Add policies for public read access
    - Add policies for 'postgres' user management

  ## From 20250501023606_long_water.sql

  1. New Tables
    - `vm_plans`

  2. Security
    - Enable RLS on `vm_plans` table
    - Add policies for public read access to active plans
    - Add policies for 'postgres' user management
*/




-- Create hypervisors table
CREATE TABLE hypervisors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('proxmox', 'vsphere')),
  host text NOT NULL,
  username text NOT NULL,
  api_token text, -- Consider encrypting this if storing sensitive tokens
  token_name text, -- Added for Proxmox API Token Name (e.g., 'mytoken' part of user@pam!mytoken)
  status text NOT NULL DEFAULT 'disconnected',
  last_sync timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create virtual_machines table
CREATE TABLE virtual_machines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  hypervisor_id uuid REFERENCES hypervisors(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'stopped',
  cpu_cores integer NOT NULL,
  memory_mb integer NOT NULL,
  disk_gb integer NOT NULL,
  os text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create vm_metrics table
CREATE TABLE vm_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vm_id uuid REFERENCES virtual_machines(id) ON DELETE CASCADE,
  cpu_usage float NOT NULL,
  memory_usage float NOT NULL,
  disk_usage float NOT NULL,
  network_in bigint NOT NULL,
  network_out bigint NOT NULL,
  timestamp timestamptz DEFAULT now()
);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers for updated_at on initial tables
CREATE TRIGGER update_hypervisors_updated_at
  BEFORE UPDATE ON hypervisors
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_virtual_machines_updated_at
  BEFORE UPDATE ON virtual_machines
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Create vm_plans table
CREATE TABLE vm_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL,
  specs jsonb NOT NULL,
  icon text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Add trigger for updated_at on vm_plans
CREATE TRIGGER update_vm_plans_updated_at
  BEFORE UPDATE ON vm_plans
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Create roles table
CREATE TABLE roles (
  id serial PRIMARY KEY, -- Using serial for simplicity, could be uuid
  name text NOT NULL UNIQUE,
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create users table
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL, -- Store hashed passwords only!
  role_id integer REFERENCES roles(id) NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Add triggers for updated_at on new tables
CREATE TRIGGER update_roles_updated_at BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- Enable RLS
ALTER TABLE hypervisors ENABLE ROW LEVEL SECURITY;
ALTER TABLE virtual_machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE vm_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE vm_plans ENABLE ROW LEVEL SECURITY;

-- Force RLS for table owners (important for local PG)
-- Enable RLS for new tables
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Force RLS for table owners (important for local PG)
ALTER TABLE hypervisors FORCE ROW LEVEL SECURITY;
ALTER TABLE virtual_machines FORCE ROW LEVEL SECURITY;
ALTER TABLE vm_metrics FORCE ROW LEVEL SECURITY;
ALTER TABLE vm_plans FORCE ROW LEVEL SECURITY;

-- Create policies for hypervisors
CREATE POLICY "Allow public read access to hypervisors"
  ON hypervisors
  FOR SELECT
  TO public -- Grant read access to any connected user
  USING (true);

CREATE POLICY "Allow postgres user to manage hypervisors"
  ON hypervisors
  FOR ALL -- Grant insert, update, delete
  TO postgres -- Grant specifically to the 'postgres' user
  USING (true); -- Allow all rows for this user

-- Force RLS for new tables
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

-- Create policies for roles
CREATE POLICY "Allow public read access to roles"
  ON roles
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow postgres user to manage roles"
  ON roles
  FOR ALL
  TO postgres
  USING (true);

-- Create policies for users (Restrictive: only postgres can manage for now)
CREATE POLICY "Allow postgres user to manage users"
  ON users
  FOR ALL
  TO postgres
  USING (true);
-- Create policies for virtual_machines
CREATE POLICY "Allow public read access to VMs"
  ON virtual_machines
  FOR SELECT
  TO public -- Grant read access to any connected user
  USING (true);

CREATE POLICY "Allow postgres user to manage VMs"
  ON virtual_machines
  FOR ALL -- Grant insert, update, delete
  TO postgres -- Grant specifically to the 'postgres' user
  USING (true); -- Allow all rows for this user

-- Create policies for vm_metrics
CREATE POLICY "Allow public read access to VM metrics"
  ON vm_metrics
  FOR SELECT
  TO public -- Grant read access to any connected user
  USING (true);

-- Note: Typically, you might not need INSERT/UPDATE/DELETE policies for metrics from the app,
-- but adding a management policy for postgres user for completeness.
CREATE POLICY "Allow postgres user to manage VM metrics"
  ON vm_metrics
  FOR ALL
  TO postgres
  USING (true);

-- Create policies for vm_plans
CREATE POLICY "Allow public read access to active plans"
  ON vm_plans
  FOR SELECT
  TO public -- Grant read access to any connected user
  USING (is_active = true);

CREATE POLICY "Allow postgres user to manage plans"
  ON vm_plans
  FOR ALL -- Grant insert, update, delete
  TO postgres -- Grant specifically to the 'postgres' user
  USING (true); -- Allow all rows for this user
