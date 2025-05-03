import { useState, useEffect, ReactNode } from 'react';
import { User, DecodedToken } from '../types/auth'; // Import DecodedToken
import { jwtDecode } from 'jwt-decode'; // Import jwt-decode
import { AuthContext,  } from '../hooks/useAuth'; // Import context from the new file

const TOKEN_KEY = 'authToken'; // Key for localStorage

// Only export the Provider component from this file
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // const [token, setToken] = useState<string | null>(null); // Removed unused state
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check for existing token on initial load
    const checkAuth = async () => {
      try {
        const storedToken = localStorage.getItem(TOKEN_KEY);
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
              setUser(userData);
              // setToken(storedToken); // No longer needed
              console.log("User session restored from token:", userData);
            }
          } catch (decodeError) {
            console.error("Error decoding token:", decodeError);
            logout(); // Invalid token
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

  // Login function now receives token and user data from the Login component
  const login = (newToken: string, userData: User) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    // setToken(newToken); // No longer needed
    setUser(userData);
    console.log("User logged in:", userData);
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    // setToken(null); // No longer needed
    setUser(null);
    console.log("User logged out.");
  };

  const value = {
    user,
    isAuthenticated: !!user,
    isLoading,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}