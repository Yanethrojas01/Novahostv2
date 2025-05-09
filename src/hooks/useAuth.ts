import { createContext, useContext } from 'react';
import { User } from '../types/auth';

export interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  token: string | null; // Añadir token al contexto
  login: (token: string, userData: User, remember?: boolean) => void; // Asegurar que remember es opcional
  logout: () => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}