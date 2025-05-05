export interface FinalClient {
    id: string;
    name: string;
    rif: string; // Registro de Información Fiscal
    contact_info?: Record<string, any>; // JSONB for contact details
    additional_info?: string;
    created_by_user_id?: string; // UUID of the creator user
    created_at: string; // ISO date string
    updated_at: string; // ISO date string
    // Optionally add creator username if joined in backend query
  }