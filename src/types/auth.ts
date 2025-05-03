export interface User {
  id: string;
  username: string; // Add username
  name?: string; // Make name optional as it might not be in the token initially
  email: string;
  role: 'admin' | 'user' | 'viewer';
  is_active?: boolean; // Add is_active (optional as it might not always be present)
}

export interface LoginCredentials {
  email: string;
  password: string;
}

// Interface for the decoded JWT payload
export interface DecodedToken {
  userId: string;
  email: string;
  username: string; // <-- Añadir username
  role: 'admin' | 'user' | 'viewer';
  name?: string; // Optional: Include if you add name to the JWT payload in the backend
  iat: number; // Issued At timestamp
  exp: number; // Expiration timestamp
}