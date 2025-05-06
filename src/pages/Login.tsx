import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Server as Servers, EyeOff, Eye, FileCheck } from 'lucide-react'; // Added FileCheck
import { useAuth } from '../hooks/useAuth'; // Corrected import path
import { motion } from 'framer-motion';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL; // Define API base URL

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { login } = useAuth(); // Keep using the context's login function to store state
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password) {
      setError('Por favor, ingresa el correo electrónico y la contraseña');
      return;
    }

    setError('');
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, { // Use your API base URL
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Inicio de sesión fallido');
      }

      // If login is successful, call the context's login function with the received data
      // The context function should handle storing the token and user info
      login(data.accessToken, data.user); // Pass token and user info to context

      navigate('/');
    } catch (err) { // Catch specific error type if possible
      console.error('Login error:', err);
      if (err instanceof Error) {
        setError(err.message || 'Correo electrónico o contraseña inválidos'); // Display error from backend or generic one
      } else {
        setError('Ocurrió un error inesperado'); // Fallback for unknown error types
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-stretch bg-slate-100 dark:bg-slate-900">
      {/* Left Side: Login Form */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 xl:px-12">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="sm:mx-auto sm:w-full sm:max-w-md"
        >
          <div className="flex justify-center">
            <div className="h-12 w-12 rounded-full bg-primary-600 text-white flex items-center justify-center">
              <Servers className="h-6 w-6" />
            </div>
          </div>
          <h2 className="mt-6 text-center text-3xl font-bold text-slate-900 dark:text-white">
            Novahost
          </h2>
          <p className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">
            Inicia sesión en tu cuenta para administrar tus máquinas virtuales
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.5 }}
          className="mt-8 sm:mx-auto sm:w-full sm:max-w-md"
        >
          <div className="bg-white dark:bg-slate-800 py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-slate-200 dark:border-slate-700">
            <form className="space-y-6" onSubmit={handleSubmit}>
              {error && (
                <div className="bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-800 text-danger-700 dark:text-danger-300 px-4 py-3 rounded">
                  {error}
                </div>
              )}

              <div>
                <label htmlFor="email" className="form-label">
                  Dirección de correo electrónico
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="form-input"
                />
              </div>

              <div>
                <label htmlFor="password" className="form-label">
                  Contraseña
                </label>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="form-input pr-10"
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-500"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5" aria-hidden="true" />
                    ) : (
                      <Eye className="h-5 w-5" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <input
                    id="remember-me"
                    name="remember-me"
                    type="checkbox"
                    className="form-checkbox"
                  />
                  <label htmlFor="remember-me" className="ml-2 block text-sm text-slate-700 dark:text-slate-300">
                    Recuérdame
                  </label>
                </div>
              </div>

              <div>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full btn btn-primary py-3"
                >
                  {isLoading ? 'Iniciando sesión...' : 'Iniciar sesión'}
                </button>
              </div>
            </form>
          </div>
        </motion.div>
      </div>

      {/* Right Side: Hero Section */}
      <div className="hidden lg:flex lg:w-1/2 bg-primary-600 dark:bg-primary-700 text-white flex-col justify-center items-center p-8 xl:p-12">
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="max-w-xl"
        >
          <h1 className="text-4xl xl:text-5xl font-bold mb-6">
            Portal de Gestión de VM
          </h1>
          <p className="text-lg xl:text-xl text-primary-100 dark:text-primary-200 mb-8">
            Una plataforma integral para que los operadores de centros de
            datos gestionen las implementaciones de máquinas virtuales en
            los hipervisores Proxmox y vCenter.
          </p>
          <ul className="space-y-3 text-primary-50 dark:text-primary-100">
            {[
              "Crea fácilmente máquinas virtuales con configuraciones predefinidas o personalizadas",
              "Gestiona las conexiones de hipervisores para entornos Proxmox y vCenter",
              "Realiza un seguimiento de los datos de los clientes e informa los números de las máquinas virtuales",
              "Control de acceso basado en roles para administradores, operadores y espectadores"
            ].map((item, index) => (
              <li key={index} className="flex items-start">
                <FileCheck size={24} className="mr-3 mt-0.5 flex-shrink-0 text-green-300 dark:text-green-400" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </motion.div>
      </div>
    </div>
  );
}
