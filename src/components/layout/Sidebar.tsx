import { Link, useLocation } from 'react-router-dom';
import { BarChart3, Cloud, Cog, Home, Monitor, Plus, Server as Servers, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { clsx } from 'clsx';
import logodch from "../../img/CDHLogo.png"
import { useAuth } from '../../hooks/useAuth'; // Import useAuth
interface SidebarProps {
  mobile?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ mobile = false, onClose }: SidebarProps) {
  const location = useLocation();
    const { user, token: authToken } = useAuth(); 
; // Get current user
  
  const baseNavigation = [
    { name: 'Dashboard', href: '/', icon: Home },
    { name: 'Hypervisores', href: '/hypervisors', icon: Cloud },
    { name: 'Estadisticas', href: '/stats', icon: BarChart3 },
    { name: 'Configuración', href: '/settings', icon: Cog },
  ];

  // Conditionally add "Crear VM" based on user role
  const navigation = [...baseNavigation];
  if (user?.role === 'admin' || user?.role === 'user') {
    // Insert "Crear VM" after "Dashboard"
    navigation.splice(1, 0, { name: 'Crear VM', href: '/create-vm', icon: Plus });
  }

  return (
    <div className="flex flex-col h-full border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
      {mobile && (
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center space-x-2">
            <Servers className="h-6 w-6 text-primary-600 dark:text-primary-400" />
            <span className="text-lg font-semibold text-primary-600 dark:text-primary-400">
              Novahost
            </span>
          </div>
          <button
            type="button"
            className="p-2 rounded-md text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
            onClick={onClose}
          >
            <span className="sr-only">Close sidebar</span>
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      )}
      
      <div className={clsx("flex-shrink-0", !mobile && "p-4 border-b border-slate-200 dark:border-slate-700")}>
        {!mobile && (
          <div className="flex items-center space-x-2">
            {/* <Servers className="h-6 w-6 text-primary-600 dark:text-primary-400" /> */}
            <img src={logodch} alt="Novahost" className="h-17 w-20" />
            <span className="text-lg font-semibold text-primary-600 dark:text-primary-400">
                            Novahost 
            </span>
           
          </div>
        )}
      </div>
      
      <div className="flex-1 overflow-y-auto pt-5 pb-4">
        <nav className="mt-5 flex-1 px-2 space-y-1">
          {navigation.map((item) => {
            const isActive = location.pathname === item.href;
            
            return (
              <Link
                key={item.name}
                to={item.href}
                className={clsx(
                  isActive
                    ? 'bg-primary-50 dark:bg-primary-900/50 text-primary-600 dark:text-primary-400'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50',
                  'group flex items-center px-2 py-2 text-sm font-medium rounded-md relative'
                )}
                onClick={mobile ? onClose : undefined}
              >
                {isActive && (
                  <motion.div
                    layoutId="sidebar-indicator"
                    className="absolute left-0 w-1 h-6 bg-primary-600 dark:bg-primary-400 rounded-r-full"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  />
                )}
                <item.icon
                  className={clsx(
                    isActive
                      ? 'text-primary-600 dark:text-primary-400'
                      : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-500 dark:group-hover:text-slate-400',
                    'mr-3 flex-shrink-0 h-5 w-5'
                  )}
                  aria-hidden="true"
                />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </div>
      
      <div className="p-4 mt-auto border-t border-slate-200 dark:border-slate-700">
        <div className="flex items-center">
          <div className="flex-shrink-0">
            <Monitor className="h-6 w-6 text-slate-400 dark:text-slate-500" />
          </div>
          <div className="ml-3">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Estatus del Sistema
            </p>
            <div className="flex items-center mt-1">
              <div className="h-2 w-2 rounded-full bg-success-500 mr-2"></div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Operacional</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}