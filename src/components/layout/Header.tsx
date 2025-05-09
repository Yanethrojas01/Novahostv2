import { useAuth } from '../../hooks/useAuth'; // Corrected import path
import { useTheme } from '../../contexts/ThemeContext';
import { Bell, Menu, Moon, Sun, User, AlertTriangle, XCircle } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { Hypervisor } from '../../types/hypervisor'; // Import Hypervisor type
import { Link } from 'react-router-dom'; // For linking to hypervisors page

interface HeaderProps {
  onMenuClick: () => void;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export default function Header({ onMenuClick }: HeaderProps) {
  const { user, logout, token: authToken } = useAuth(); // Get authToken
  const { theme, toggleTheme } = useTheme();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [errorNotifications, setErrorNotifications] = useState<Hypervisor[]>([]);
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(false);
  const notificationsMenuRef = useRef<HTMLDivElement>(null);

  const fetchErrorNotifications = async () => {
    if (!authToken || !API_BASE_URL) return; // Check authToken
    setIsLoadingNotifications(true);
    try {
      const response = await fetch(`${API_BASE_URL}/hypervisors`, {
        headers: {
          'Authorization': `Bearer ${authToken}`, // Use authToken
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data: Hypervisor[] = await response.json();
      setErrorNotifications(data.filter(h => h.status === 'error'));
    } catch (error) {
      console.error('Error fetching error notifications:', error);
      setErrorNotifications([]); // Clear on error or show a specific error notification
    } finally {
      setIsLoadingNotifications(false);
    }
  };

  // Close menus when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
      if (notificationsMenuRef.current && !notificationsMenuRef.current.contains(event.target as Node)) {
        setIsNotificationsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    // Fetch notifications when the dropdown is opened, or periodically if desired
    if (isNotificationsOpen) {
      fetchErrorNotifications();
    }
  }, [isNotificationsOpen, authToken]); // Re-fetch if authToken changes

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

            {/* Notifications dropdown */}
            <div className="ml-3 relative" ref={notificationsMenuRef}>
              <button
                type="button"
                onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
                className="relative p-2 rounded-md text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <span className="sr-only">View notifications</span>
                <Bell className="h-5 w-5" aria-hidden="true" />
                {errorNotifications.length > 0 && (
                  <span className="absolute top-0 right-0 block h-2 w-2 transform -translate-y-1/2 translate-x-1/2 rounded-full bg-danger-500 ring-2 ring-white dark:ring-slate-800" />
                )}
              </button>

              {isNotificationsOpen && (
                <div
                  className="origin-top-right absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-md shadow-lg bg-white dark:bg-slate-800 ring-1 ring-black ring-opacity-5"
                  role="menu"
                  aria-orientation="vertical"
                  aria-labelledby="notifications-menu-button"
                >
                  <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                    <p className="text-sm font-medium text-slate-900 dark:text-white">
                      Notificaciones de Error
                    </p>
                  </div>
                  <div className="py-1" role="none">
                    {isLoadingNotifications ? (
                      <div className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400 text-center">Cargando...</div>
                    ) : errorNotifications.length > 0 ? (
                      errorNotifications.map((hypervisor) => (
                        <Link
                          key={hypervisor.id}
                          to="/hypervisors" // Or `/hypervisors/${hypervisor.id}` if you have a detail page anchor
                          onClick={() => setIsNotificationsOpen(false)} // Close dropdown on click
                          className="block px-4 py-3 hover:bg-slate-100 dark:hover:bg-slate-700"
                          role="menuitem"
                        >
                          <div className="flex items-start">
                            <div className="flex-shrink-0 pt-0.5">
                              <AlertTriangle className="h-5 w-5 text-danger-500" aria-hidden="true" />
                            </div>
                            <div className="ml-3 w-0 flex-1">
                              <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                                {hypervisor.name || hypervisor.host}
                              </p>
                              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                Falló la conexión. Verifica las credenciales o la red.
                              </p>
                            </div>
                          </div>
                        </Link>
                      ))
                    ) : (
                      <div className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400 text-center">
                        <XCircle className="h-6 w-6 mx-auto mb-1 text-slate-400" />
                        No hay notificaciones de error.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

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
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-200 truncate">
                      {user?.username || user?.name} {/* Display username if available */}
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