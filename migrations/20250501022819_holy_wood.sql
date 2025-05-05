/*
  # Initial Schema Setup

  1. New Tables
    - `hypervisors`
      - `id` (uuid, primary key)
      - `name` (text)
      - `type` (text)
      - `host` (text)
      - `username` (text)
      - `api_token` (text, encrypted)
      - `status` (text)
      - `last_sync` (timestamptz)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `virtual_machines`
      - `id` (uuid, primary key)
      - `name` (text)
      - `description` (text)
      - `hypervisor_id` (uuid, foreign key)
      - `status` (text)
      - `cpu_cores` (integer)
      - `memory_mb` (integer)
      - `disk_gb` (integer)
      - `os` (text)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `vm_metrics`
      - `id` (uuid, primary key)
      - `vm_id` (uuid, foreign key)
      - `cpu_usage` (float)
      - `memory_usage` (float)
      - `disk_usage` (float)
      - `network_in` (bigint)
      - `network_out` (bigint)
      - `timestamp` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users
*/

-- Create hypervisors table
CREATE TABLE hypervisors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('proxmox', 'vsphere')),
  host text NOT NULL,
  username text NOT NULL,
  api_token text,
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

-- Enable RLS
ALTER TABLE hypervisors ENABLE ROW LEVEL SECURITY;
ALTER TABLE virtual_machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE vm_metrics ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view all hypervisors"
  ON hypervisors
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can manage hypervisors"
  ON hypervisors
  USING (auth.uid() IN (
    SELECT id FROM auth.users WHERE role = 'admin'
  ));

CREATE POLICY "Users can view all VMs"
  ON virtual_machines
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can manage VMs"
  ON virtual_machines
  USING (auth.uid() IN (
    SELECT id FROM auth.users WHERE role = 'admin'
  ));

CREATE POLICY "Users can view VM metrics"
  ON vm_metrics
  FOR SELECT
  TO authenticated
  USING (true);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers for updated_at
CREATE TRIGGER update_hypervisors_updated_at
  BEFORE UPDATE ON hypervisors
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_virtual_machines_updated_at
  BEFORE UPDATE ON virtual_machines
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();