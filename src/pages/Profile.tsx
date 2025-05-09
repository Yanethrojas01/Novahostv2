import { useState, useEffect, FormEvent } from 'react';
import { motion } from 'framer-motion';
import { User as UserIcon, Shield, Loader2 } from 'lucide-react'; // Renamed User to UserIcon
import { useAuth } from '../hooks/useAuth';
import { toast } from 'react-hot-toast';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export default function Profile() {
  const { user, token, updateUser: updateAuthContextUser, isLoading: authLoading } = useAuth();

  // Profile state
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

  // Password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  useEffect(() => {
    if (user) {
      setFullName(user.username || user.name || ''); // Usar username o name del contexto
      setEmail(user.email || '');
    }
  }, [user]);

  const handleProfileUpdate = async (e: FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      toast.error('El nombre completo no puede estar vacío.');
      return;
    }
    setIsUpdatingProfile(true);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ fullName: fullName.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error al actualizar el perfil.');
      }

      toast.success(data.message || 'Perfil actualizado correctamente.');
      if (data.user) {
        updateAuthContextUser(data.user); // Actualizar usuario en AuthContext
      }

    } catch (error: unknown) {
      let errorMessage = 'Error al actualizar el perfil.';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      toast.error(errorMessage);
      console.error("Profile update error:", error); // Log the full error for debugging
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  const handlePasswordChange = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmNewPassword) {
      toast.error('Todos los campos de contraseña son obligatorios.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      toast.error('La nueva contraseña y la confirmación no coinciden.');
      return;
    }
    if (newPassword.length < 6) {
      toast.error('La nueva contraseña debe tener al menos 6 caracteres.');
      return;
    }

    setIsChangingPassword(true);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/password`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error al cambiar la contraseña.');
      }

      toast.success(data.message || 'Contraseña cambiada correctamente.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (error: unknown) {
      let errorMessage = 'Error al cambiar la contraseña.';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      toast.error(errorMessage);
      console.error("Password change error:", error); // Log the full error for debugging
    } finally {
      setIsChangingPassword(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Perfil</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1">
          Gestiona la información de tu cuenta y la configuración de seguridad.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Account Settings */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="card"
        >
          <form onSubmit={handleProfileUpdate} className="p-6">
            <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-4 flex items-center">
              <UserIcon className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" />
              Ajustes de la Cuenta
            </h2>

            <div className="space-y-4">
              <div>
                <label htmlFor="email" className="form-label">Correo</label>
                <input
                  id="email"
                  type="email"
                  className="form-input"
                  value={email}
                  disabled
                />
              </div>

              <div>
                <label htmlFor="fullName" className="form-label">Nombre Completo / Usuario</label>
                <input
                  id="fullName"
                  type="text"
                  className="form-input"
                  placeholder="Tu nombre completo o usuario"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  disabled={isUpdatingProfile}
                />
              </div>

              <div>
                <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={isUpdatingProfile}>
                  {isUpdatingProfile ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Actualizando...
                    </>
                  ) : (
                    'Actualizar Perfil'
                  )}
                </button>
              </div>
            </div>
          </form>
        </motion.section>

        {/* Security Settings */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="card"
        >
          <form onSubmit={handlePasswordChange} className="p-6">
            <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-4 flex items-center">
              <Shield className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" />
              Seguridad
            </h2>

            <div className="space-y-4">
              <div>
                <label htmlFor="currentPassword" className="form-label">Contraseña Actual</label>
                <input
                  id="currentPassword"
                  type="password"
                  className="form-input"
                  placeholder="Ingresa tu contraseña actual"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  disabled={isChangingPassword}
                />
              </div>

              <div>
                <label htmlFor="newPassword" className="form-label">Nueva Contraseña</label>
                <input
                  id="newPassword"
                  type="password"
                  className="form-input"
                  placeholder="Ingresa tu nueva contraseña"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={isChangingPassword}
                />
              </div>

              <div>
                <label htmlFor="confirmNewPassword" className="form-label">Confirmar Nueva Contraseña</label>
                <input
                  id="confirmNewPassword"
                  type="password"
                  className="form-input"
                  placeholder="Confirma tu nueva contraseña"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  disabled={isChangingPassword}
                />
              </div>

              <div>
                <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={isChangingPassword}>
                   {isChangingPassword ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Cambiando...
                    </>
                  ) : (
                    'Cambiar Contraseña'
                  )}
                </button>
              </div>
            </div>
          </form>
        </motion.section>
      </div>
    </div>
  );
}