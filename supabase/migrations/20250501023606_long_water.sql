/*
  # Create VM plans table

  1. New Tables
    - `vm_plans`
      - `id` (uuid, primary key)
      - `name` (text)
      - `description` (text)
      - `specs` (jsonb)
      - `icon` (text, nullable)
      - `is_active` (boolean)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `vm_plans` table
    - Add policies for authenticated users to read plans
    - Add policies for admins to manage plans
*/

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

ALTER TABLE vm_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view active plans"
  ON vm_plans
  FOR SELECT
  TO authenticated
  USING (is_active = true);

CREATE POLICY "Admins can manage plans"
  ON vm_plans
  USING (auth.uid() IN (
    SELECT id FROM auth.users WHERE role = 'admin'
  ));

-- Add trigger for updated_at
CREATE TRIGGER update_vm_plans_updated_at
  BEFORE UPDATE ON vm_plans
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();