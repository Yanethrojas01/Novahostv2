import { motion } from 'framer-motion';
import { Moon, Sun, Globe } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

export default function PreferencesPage() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Preferencias</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1">
          Personaliza la apariencia y el comportamiento de la aplicación.
        </p>
      </div>

      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="card"
      >
        <div className="p-6">
          <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-4 flex items-center">
            <Globe className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" />
            Apariencia
          </h2>

          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                {theme === 'dark' ? (
                  <Moon className="h-5 w-5 text-slate-400" />
                ) : (
                  <Sun className="h-5 w-5 text-slate-400" />
                )}
                <span className="text-slate-700 dark:text-slate-300">Tema</span>
              </div>
              <button
                onClick={toggleTheme}
                className="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-600 focus:ring-offset-2 bg-slate-200 dark:bg-slate-700"
              >
                <span className="sr-only">Toggle theme</span>
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    theme === 'dark' ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      </motion.section>
    </div>
  );
}