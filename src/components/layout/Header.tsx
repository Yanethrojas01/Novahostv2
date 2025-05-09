import { useAuth } from '../../hooks/useAuth'; // Corrected import path
import { useTheme } from '../../contexts/ThemeContext';
import { Bell, Menu, Moon, Sun, User } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

interface HeaderProps {
  onMenuClick: () => void;
}

export default function Header({ onMenuClick }: HeaderProps) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Close user menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <header className="bg-white dark:bg-slate-800 shadow-sm z-10">
      <div className="mx-auto px-4 sm:px-6">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <button
              type="button"
              className="p-2 rounded-md text-slate-500 dark:text-slate-400 lg:hidden focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500"
              onClick={onMenuClick}
            >
              <span className="sr-only">Sidebar</span>
              <Menu className="h-6 w-6" aria-hidden="true" />
            </button>
            <div className="lg:hidden ml-2 font-semibold text-lg text-primary-600 dark:text-primary-400">
              Novahost
            </div>
          </div>
          
          <div className="flex items-center">
            <button
              type="button"
              onClick={toggleTheme}
              className="p-2 rounded-md text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <span className="sr-only">Tema</span>
              {theme === 'dark' ? (
                <Sun className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Moon className="h-5 w-5" aria-hidden="true" />
              )}
            </button>
            
            <button
              type="button"
              className="ml-3 p-2 rounded-md text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <span className="sr-only">View notifications</span>
              <Bell className="h-5 w-5" aria-hidden="true" />
            </button>
            
            {/* Profile dropdown */}
            <div className="ml-3 relative" ref={userMenuRef}>
              <button
                type="button"
                className="flex items-center max-w-xs rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                id="user-menu-button"
                aria-expanded={userMenuOpen}
                onClick={() => setUserMenuOpen(!userMenuOpen)}
              >
                <span className="sr-only">Open user menu</span>
                <div className="h-8 w-8 rounded-full bg-primary-600 text-white flex items-center justify-center">
                  <User className="h-5 w-5" aria-hidden="true" />
                </div>
              </button>
              
              {userMenuOpen && (
                <div
                  className="origin-top-right absolute right-0 mt-2 w-48 rounded-md shadow-lg bg-white dark:bg-slate-800 ring-1 ring-black ring-opacity-5 divide-y divide-slate-200 dark:divide-slate-700"
                  role="menu"
                  aria-orientation="vertical"
                  aria-labelledby="user-menu-button"
                >
                  <div className="py-1 px-4">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-200">
                      {user?.name}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {user?.email}
                    </p>
                  </div>
                  
                  <div className="py-1" role="none">
                    <a
                      href="/profile"
                      className="block px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                      role="menuitem"
                    >
                      Tu Perfil
                    </a>
                    <a
                      href="/preferences" // Actualizado para apuntar a la nueva página de preferencias
                      className="block px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                      role="menuitem"
                    >
                      Preferencias
                    </a>
                  </div>
                  
                  <div className="py-1" role="none">
                    <button
                      type="button"
                      className="block w-full text-left px-4 py-2 text-sm text-danger-600 dark:text-danger-400 hover:bg-slate-100 dark:hover:bg-slate-700"
                      role="menuitem"
                      onClick={logout}
                    >
                      Logout
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}