import { motion } from 'framer-motion';
import { User, Shield } from 'lucide-react';

export default function Profile() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Perfil</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1">
          Gestiona la información de tu cuenta y la configuración de seguridad.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {/* Account Settings */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="card"
        >
          <div className="p-6">
            <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-4 flex items-center">
              <User className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" />
              Ajustes de la Cuenta
            </h2>

            <div className="space-y-4">
              <div>
                <label className="form-label">Correo</label>
                <input
                  type="email"
                  className="form-input"
                  value="admin@example.com"
                  disabled
                />
              </div>

              <div>
                <label className="form-label">Nombre Completo</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Your full name"
                  defaultValue="Admin User"
                />
              </div>

              <div>
                <button className="btn btn-primary">
                  Actualizar Perfil
                </button>
              </div>
            </div>
          </div>
        </motion.section>

        {/* Security Settings */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="card"
        >
          <div className="p-6">
            <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-4 flex items-center">
              <Shield className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" />
              Seguridad
            </h2>

            <div className="space-y-4">
              <div>
                <label className="form-label">Actual Password</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Enter current password"
                />
              </div>

              <div>
                <label className="form-label">Nueva Password</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Enter new password"
                />
              </div>

              <div>
                <label className="form-label">Confirma nueva Password</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Confirm new password"
                />
              </div>

              <div>
                <button className="btn btn-primary">
                  Cambiar Password
                </button>
              </div>
            </div>
          </div>
        </motion.section>
      </div>
    </div>
  );
}