export interface User {
  id: string;
  name?: string; // Make name optional as it might not be in the token initially
  email: string;
  role: 'admin' | 'user' | 'viewer';
}

export interface LoginCredentials {
  email: string;
  password: string;
}

// Interface for the decoded JWT payload
export interface DecodedToken {
  userId: string;
  email: string;
  role: 'admin' | 'user' | 'viewer';
  name?: string; // Optional: Include if you add name to the JWT payload in the backend
  iat: number; // Issued At timestamp
  exp: number; // Expiration timestamp
}