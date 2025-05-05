// Basic structure for FinalClient based on schema.sql and index.js
export interface FinalClient {
  id: string;
  name: string;
  rif: string;
  contact_info?: Record<string, unknown>; // Use Record<string, unknown> instead of any
  additional_info?: string;
  created_at: string;
  updated_at: string;
}