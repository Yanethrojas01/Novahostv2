/*
  Esquema completo corregido - BoltV2 (Ordenado por dependencias)
*/

-- Ensure the public schema is used
SET search_path TO public;

-- 1. Tablas base sin dependencias
CREATE TABLE roles (
    id serial PRIMARY KEY,
    name text NOT NULL UNIQUE,
    description text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE hypervisors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    type text NOT NULL CHECK (type IN ('proxmox', 'vsphere')),
    host text NOT NULL,
    username text NOT NULL,
    password text,
    api_token text,
    token_name text,
    vsphere_subtype text CHECK (vsphere_subtype IN ('vcenter', 'esxi')), -- Added subtype
    status text NOT NULL DEFAULT 'disconnected',
    last_sync timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

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

-- 2. Tablas que dependen de roles
CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username text NOT NULL UNIQUE,
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    role_id integer REFERENCES roles(id) NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- 3. Tablas que dependen de users
CREATE TABLE final_clients (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    rif text NOT NULL UNIQUE, -- Registro de Información Fiscal
    contact_info jsonb, -- Información de contacto estructurada
    additional_info text,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- 4. Tablas que dependen de hypervisors, users, final_clients
CREATE TABLE virtual_machines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    description text,
    hypervisor_id uuid REFERENCES hypervisors(id) ON DELETE CASCADE,
    hypervisor_vm_id text, -- Stores the ID from the hypervisor (e.g., Proxmox VMID)
    status text NOT NULL DEFAULT 'stopped',
    cpu_cores integer NOT NULL,
    memory_mb integer NOT NULL,
    disk_gb integer NOT NULL,
    ticket text,
    final_client_id uuid REFERENCES final_clients(id) ON DELETE SET NULL, -- Relación modificada
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    os text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- 5. Tablas que dependen de virtual_machines
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

-- Funciones y triggers
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers para todas las tablas
CREATE TRIGGER update_final_clients_updated_at
    BEFORE UPDATE ON final_clients
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_hypervisors_updated_at
    BEFORE UPDATE ON hypervisors
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_virtual_machines_updated_at
    BEFORE UPDATE ON virtual_machines
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_vm_plans_updated_at
    BEFORE UPDATE ON vm_plans
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_roles_updated_at
    BEFORE UPDATE ON roles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Datos iniciales
INSERT INTO roles (name, description) VALUES
    ('admin', 'Administrator role with full access'),
    ('user', 'Standard user role'),
    ('viewer', 'Read-only access')
ON CONFLICT (name) DO NOTHING;

INSERT INTO users (username, email, password_hash, role_id, is_active) VALUES (
    'admin',
    'admin@example.com',
    '$2b$10$6Zl/3W9GpzjKIm6yGl4Vo.zYLJR23ntLqVz0mxkXlR4Di0U73pf4u', -- Reemplaza con tu hash real
    (SELECT id FROM roles WHERE name = 'admin'),
    true
) ON CONFLICT (email) DO NOTHING;

-- Configuración de seguridad
-- Habilitar RLS para todas las tablas
ALTER TABLE final_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE hypervisors ENABLE ROW LEVEL SECURITY;
ALTER TABLE virtual_machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE vm_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE vm_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Forzar RLS
ALTER TABLE final_clients FORCE ROW LEVEL SECURITY;
ALTER TABLE hypervisors FORCE ROW LEVEL SECURITY;
ALTER TABLE virtual_machines FORCE ROW LEVEL SECURITY;
ALTER TABLE vm_metrics FORCE ROW LEVEL SECURITY;
ALTER TABLE vm_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

-- Políticas de acceso para final_clients
CREATE POLICY "Allow public read access to final clients" ON final_clients
    FOR SELECT USING (true);

CREATE POLICY "Allow postgres user to manage final clients" ON final_clients
    FOR ALL TO postgres USING (true);

-- Allow your application user to manage final clients
CREATE POLICY "Allow app user to manage final clients" ON final_clients
    FOR ALL TO novahost_app_user USING (true);

-- Políticas de acceso
-- Hypervisors
CREATE POLICY "Allow public read access to hypervisors" ON hypervisors
    FOR SELECT USING (true);
CREATE POLICY "Allow app user to read hypervisors" ON hypervisors
    FOR SELECT TO novahost_app_user USING (true); -- App user needs read access

CREATE POLICY "Allow postgres user to manage hypervisors" ON hypervisors
    FOR ALL TO postgres USING (true);

-- Virtual Machines
CREATE POLICY "Allow public read access to VMs" ON virtual_machines
    FOR SELECT USING (true);
-- Allow app user to read VMs
CREATE POLICY "Allow app user to read VMs" ON virtual_machines
    FOR SELECT TO novahost_app_user USING (true);

CREATE POLICY "Allow postgres user to manage VMs" ON virtual_machines
    FOR ALL TO postgres USING (true);
-- Allow app user to manage VMs
CREATE POLICY "Allow app user to manage VMs" ON virtual_machines
    FOR ALL TO novahost_app_user USING (true);


-- VM Metrics
CREATE POLICY "Allow public read access to VM metrics" ON vm_metrics
    FOR SELECT USING (true);

CREATE POLICY "Allow postgres user to manage VM metrics" ON vm_metrics
    FOR ALL TO postgres USING (true);
-- Allow app user to manage VM metrics
CREATE POLICY "Allow app user to manage VM metrics" ON vm_metrics
    FOR ALL TO novahost_app_user USING (true);


-- VM Plans
CREATE POLICY "Allow public read access to active plans" ON vm_plans
    FOR SELECT USING (is_active = true);
-- Allow app user to read active plans
CREATE POLICY "Allow app user to read active plans" ON vm_plans FOR SELECT TO novahost_app_user USING (is_active = true);

CREATE POLICY "Allow postgres user to manage plans" ON vm_plans
    FOR ALL TO postgres USING (true);

-- Roles
CREATE POLICY "Allow public read access to roles" ON roles
    FOR SELECT USING (true);
-- Allow app user to read roles
CREATE POLICY "Allow app user to read roles" ON roles
    FOR SELECT TO novahost_app_user USING (true);

CREATE POLICY "Allow postgres user to manage roles" ON roles
    FOR ALL TO postgres USING (true);
-- Allow app user to manage roles (if needed, e.g., for user creation/update)
-- CREATE POLICY "Allow app user to manage roles" ON roles FOR ALL TO novahost_app_user USING (true); -- Uncomment if your app modifies roles

-- Users
CREATE POLICY "Allow postgres user to manage users" ON users
    FOR ALL TO postgres USING (true);
-- Allow app user to manage users (if needed, e.g., for user creation/update)
CREATE POLICY "Allow app user to manage users" ON users
    FOR ALL TO novahost_app_user USING (true);