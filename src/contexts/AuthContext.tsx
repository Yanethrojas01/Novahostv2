import { useState, useEffect, ReactNode } from 'react';
import { User, DecodedToken } from '../types/auth'; // Import DecodedToken
import { jwtDecode } from 'jwt-decode'; // Import jwt-decode
import { AuthContext, AuthContextType } from '../hooks/useAuth'; // Import context and type from the new file

// Define las claves para localStorage y sessionStorage
const LOCAL_STORAGE_TOKEN_KEY = 'authToken';
const TOKEN_KEY = 'authToken'; // Key for localStorage

// Only export the Provider component from this file
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null); // Estado para el token
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check for existing token on initial load
    const checkAuth = async () => {
      try {
        // Intentar cargar desde localStorage primero (para "Recuérdame")
        let storedToken = localStorage.getItem(LOCAL_STORAGE_TOKEN_KEY);
        // Si no está en localStorage, intentar desde sessionStorage
        if (!storedToken) {
            storedToken = sessionStorage.getItem(TOKEN_KEY);
        }
        if (storedToken) {
          // Decode token to get user info (basic check, ideally verify with backend)
          try {
            const decodedToken: DecodedToken = jwtDecode(storedToken); // Use the specific type
            // Check if token is expired (optional but recommended)
            const currentTime = Date.now() / 1000;
            if (decodedToken.exp && decodedToken.exp < currentTime) {
              console.log("Token expired, logging out.");
              logout(); // Token is expired
            } else {
              // Reconstruct user object from token payload
              const userData: User = {
                id: decodedToken.userId,
                username: decodedToken.username, 
                email: decodedToken.email,
                role: decodedToken.role,
                // Add name if it's included in the token, otherwise it might be null/undefined initially
                name: decodedToken.name || decodedToken.email, // Example: use email if name is missing
              };
              setToken(storedToken); // Guardar el token en el estado
              setUser(userData);
              console.log("User session restored from token:", userData);
            }
          } catch (decodeError) {
            console.error("Error decoding token:", decodeError);
            // Si el token es inválido, limpiar ambos almacenamientos
            clearAuthStorage();
          }
        }
      } catch (error) {
        console.error('Error checking authentication state:', error);
      } finally {
        setIsLoading(false);
      }
    };
    checkAuth();
  }, []);

  // Helper function to clear both storage types
  const clearAuthStorage = () => {
    localStorage.removeItem(LOCAL_STORAGE_TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
  };

  // Login function now receives token, user data, and the rememberMe flag
  const login = (newToken: string, userData: User, remember?: boolean) => {
    clearAuthStorage(); // Limpiar cualquier sesión previa

    if (remember) {
      localStorage.setItem(LOCAL_STORAGE_TOKEN_KEY, newToken);
    } else {
      sessionStorage.setItem(TOKEN_KEY, newToken);
    }

    setToken(newToken); // Actualizar el token en el estado
    setUser(userData);
    console.log("User logged in:", userData);
  };

  const logout = () => {
    clearAuthStorage(); // Limpiar ambos almacenamientos
    setToken(null); // Limpiar el token del estado
    setUser(null);
    console.log("User logged out.");
  };

  // El objeto de contexto se crea implícitamente por el Provider
  return (
    
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}