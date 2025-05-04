import { Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';

export default function LoadingScreen() {
  return (
    <div className="h-screen w-full flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-900">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex flex-col items-center"
      >
        <Loader2 className="h-12 w-12 text-primary-600 dark:text-primary-400 animate-spin mb-4" />
        <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200">
          Cargando...
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
          Preparando tu panel de administración de VM
        </p>
      </motion.div>
    </div>
  );
}