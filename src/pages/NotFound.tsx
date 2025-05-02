import { Link } from 'react-router-dom';
import { ArrowLeft, Server } from 'lucide-react';
import { motion } from 'framer-motion';

export default function NotFound() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col justify-center py-12 sm:px-6 lg:px-8"
    >
      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md text-center">
        <Server className="mx-auto h-16 w-16 text-primary-600 dark:text-primary-400" />
        <h1 className="mt-6 text-5xl font-bold text-slate-900 dark:text-white">404</h1>
        <h2 className="mt-2 text-2xl font-semibold text-slate-800 dark:text-slate-200">Page not found</h2>
        <p className="mt-2 text-slate-600 dark:text-slate-400">
          Sorry, we couldn't find the page you're looking for.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
          >
            <ArrowLeft className="h-5 w-5" />
            Back to dashboard
          </Link>
        </div>
      </div>
    </motion.div>
  );
}