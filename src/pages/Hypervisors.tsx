import { useState, useEffect } from 'react';
import { Plus, RefreshCw, Search } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast'; // Assuming you have react-hot-toast or similar
import HypervisorCard from '../components/hypervisors/HypervisorCard';
import { Hypervisor, HypervisorCredentials } from '../types/hypervisor';
import { useAuth } from '../hooks/useAuth'; // Import useAuth


const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;; // Adjust if your server runs elsewhere
export default function Hypervisors() {
  const [hypervisors, setHypervisors] = useState<Hypervisor[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newHypervisor, setNewHypervisor] = useState<HypervisorCredentials>({
    type: 'proxmox',
    host: '',
    username: '',
    password: '', // Para vSphere
    proxmoxPassword: '', // Para Proxmox
    apiToken: '', // Asegurarse de que apiToken también se inicialice
    tokenName: '', // Initialize tokenName
  });

  const { user, token: authToken } = useAuth(); // Get current user and token

  // Function to fetch hypervisors from the API
  const fetchHypervisors = async () => {
    setIsLoading(true);
    try {
      // //const token = localStorage.getItem('authToken'); // Ya no se usa directamente
      const response = await fetch(`${API_BASE_URL}/hypervisors`, {
        headers: {
          // Include auth header if needed by your backend middleware
          ...(authToken && { 'Authorization': `Bearer ${authToken}` }), // Usar token del contexto
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data: Hypervisor[] = await response.json();
      // Convert date strings to Date objects if necessary
      // Also ensure vsphere_subtype is handled (it should be included in ...h)
      const formattedData = data.map(h => ({
        ...h,
        last_sync: h.last_sync ? new Date(h.last_sync).toISOString() : null,
        created_at: h.created_at ? new Date(h.created_at).toISOString() : undefined, // Convert createdAt
        updated_at: h.updated_at ? new Date(h.updated_at).toISOString() : undefined, // Convert updatedAt
      }));
      setHypervisors(formattedData);
    } catch (error) {
      console.error('Error fetching hypervisors:', error);
      toast.error('Error al cargar los hipervisores.'); // User feedback
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchHypervisors();
  }, [authToken]); // Añadir authToken como dependencia si la carga inicial depende de él

  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/hypervisors/${id}`, {
        method: 'DELETE',
        headers: {
          ...(authToken && { 'Authorization': `Bearer ${authToken}` }), // Usar token del contexto
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      toast.success('Hipervisor eliminado correctamente.');
      // Re-fetch the list to ensure consistency
      fetchHypervisors();

    } catch (error) {
      console.error('Error deleting hypervisor:', error);
      toast.error('Error al eliminar el hipervisor.');
    }
  };

  const handleAddNew = async () => {
    // Validation logic for enabling the button
    const isVSpherePasswordAuthValid = newHypervisor.type === 'vsphere' && !!newHypervisor.password && newHypervisor.password.length > 0;
    const isProxmoxPasswordAuthValid = newHypervisor.type === 'proxmox' && !!newHypervisor.proxmoxPassword && newHypervisor.proxmoxPassword.length > 0;
    const isProxmoxTokenAuthValid =
      newHypervisor.type === 'proxmox' &&
      !!newHypervisor.apiToken && newHypervisor.apiToken.length > 0 &&
      !!newHypervisor.tokenName && newHypervisor.tokenName.length > 0;
    
    let isFormValid = false;
    if (newHypervisor.type === 'vsphere') {
      isFormValid = newHypervisor.host && newHypervisor.username && isVSpherePasswordAuthValid;
    } else if (newHypervisor.type === 'proxmox') {
      // Para Proxmox, se requiere host y usuario.
      // Opcionalmente, puede tener contraseña, token, o ambos.
      // La prueba de conexión en el backend determinará si las credenciales son válidas.
      // Para el frontend, solo validamos que los campos obligatorios estén.
      isFormValid = newHypervisor.host && newHypervisor.username;
      if (!isProxmoxPasswordAuthValid && !isProxmoxTokenAuthValid) {
        // Si es Proxmox y no se proporciona ni contraseña ni token, no es válido para la conexión.
        // Aunque el backend podría permitir guardarlo sin credenciales activas.
        // Para "Conectar y Guardar", al menos un método de auth es deseable.
        // toast.error('Para Proxmox, proporcione contraseña o Token API para la conexión inicial.');
        // isFormValid = false; // Descomentar si se quiere forzar al menos un método de auth
      }
    }


    if (isFormValid) {
      // El payload ahora incluye todos los campos; el backend decidirá cómo usarlos/guardarlos.
      // Para vSphere, newHypervisor.password se usa.
      // Para Proxmox, newHypervisor.proxmoxPassword y/o (apiToken + tokenName) se usan.
      const payload: HypervisorCredentials = { ...newHypervisor };

      console.log('Payload to send:', payload); // Debugging line
      setIsLoading(true); // Indicate activity
      try {
        const response = await fetch(`${API_BASE_URL}/hypervisors`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken && { 'Authorization': `Bearer ${authToken}` }), // Usar token del contexto
          },
          body: JSON.stringify(payload), // Send potentially modified payload
        });
        console.log('Response status:', response); // Debugging line

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response', details: 'Server returned non-JSON error or network issue.' }));
          // Usar errorData.details si existe, sino errorData.error
          const errorMessageFromServer = errorData.details || errorData.error || `HTTP error! status: ${response.status}`;
          throw new Error(errorMessageFromServer);
        }

        toast.success('Hipervisor añadido correctamente.');

        // Reset form and close
        setNewHypervisor({
          type: 'proxmox', // Default back to proxmox or keep current type?
          host: '',
          username: '',
          password: '',
          proxmoxPassword: '',
          apiToken: '', // Reset token field too
          tokenName: '', // Reset token name field
        });
        setIsAddingNew(false);

        // Refresh the list
        fetchHypervisors();

      } catch (error: unknown) { // Changed 'any' to 'unknown'
        console.error('Error adding hypervisor:', error);
        // Type check before accessing properties
        let errorMessage = 'Error al añadir el hipervisor.';
        if (error instanceof Error) {
          errorMessage = `Error al añadir el hipervisor: ${error.message}`;
        }
        toast.error(errorMessage);
      } finally {
        setIsLoading(false); // Stop loading indicator
      }
    } else {
      if (newHypervisor.type === 'vsphere') {
        toast.error('Para vSphere, por favor complete Host, Usuario y Contraseña.');
      } else { // Proxmox
        toast.error('Para Proxmox, por favor complete Host y Usuario. Contraseña y/o Token API son opcionales pero recomendados para funcionalidad completa.');
      }
    }
  };

  const handleRefresh = () => {
    fetchHypervisors();
  };

  // Determine if the connect button should be enabled
  const isConnectButtonEnabled =
    newHypervisor.host && newHypervisor.username &&
    ( (newHypervisor.type === 'vsphere' && !!newHypervisor.password) ||
      // Para Proxmox, habilitar si hay host y usuario. La validez de la auth se verifica en backend.
      (newHypervisor.type === 'proxmox') 
    );

  // Callback function for HypervisorCard to update state
  const handleConnectionChange = (updatedHypervisor: Hypervisor) => {
    setHypervisors(prevHypervisors =>
      prevHypervisors.map(h =>
        h.id === updatedHypervisor.id ? updatedHypervisor : h
      )
    );
  };

  const filteredHypervisors = hypervisors.filter(h =>
    (h.name?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
    (h.host?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
    (h.type?.toLowerCase() || '').includes(searchTerm.toLowerCase())
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Hipervisores</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1">
          Gestiona tus conexiones de Proxmox y vSphere
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 mb-6 justify-between">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-slate-400" />
          </div>
          <input
            type="text"
            placeholder="Buscar hipervisores..."
            className="form-input pl-10 w-full sm:w-auto"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleRefresh}
            className="btn btn-secondary"
            disabled={isLoading} // Disable while loading
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Actualizar
          </button>

          {(user?.role === 'admin' || user?.role === 'user') && (
            <button
              onClick={() => setIsAddingNew(true)}
              className="btn btn-primary"
            >
              <Plus className="h-4 w-4 mr-2" />
              Añadir Hipervisor
            </button>
          )}
        </div>
      </div>

      {isAddingNew && (user?.role === 'admin' || user?.role === 'user') && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 p-6 bg-white dark:bg-slate-800 rounded-lg shadow border border-slate-200 dark:border-slate-700"
        >
          <h2 className="text-lg font-medium mb-4 text-slate-900 dark:text-white">Añadir Nuevo Hipervisor</h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="form-label">Tipo</label>
              <select
                className="form-select"
                value={newHypervisor.type}
                onChange={(e) => setNewHypervisor(prev => ({
                  ...prev,
                  type: e.target.value as 'proxmox' | 'vsphere',
                  // Reset auth fields when type changes for clarity
                  password: '',
                  proxmoxPassword: '',
                  apiToken: '',
                  tokenName: ''
                }))}
              >
                <option value="proxmox">Proxmox</option>
                <option value="vsphere">vSphere</option>
              </select>
            </div>

            <div>
              <label className="form-label">Host</label>
              <input
                type="text"
                className="form-input"
                placeholder={newHypervisor.type === 'proxmox' ? 'https://hostname.example.com:8006' : 'hostname.example.com'}
                value={newHypervisor.host}
                onChange={(e) => setNewHypervisor(prev => ({ ...prev, host: e.target.value }))}
              />
            </div>

            <div>
              <label className="form-label">Usuario</label>
              <input
                type="text"
                className="form-input"
                placeholder={newHypervisor.type === 'proxmox' ? 'usuario@pam' : 'administrator@vsphere.local'}
                value={newHypervisor.username}
                onChange={(e) => setNewHypervisor(prev => ({ ...prev, username: e.target.value }))}
              />
            </div>

            {newHypervisor.type === 'proxmox' && (
              <>
                {/* Contraseña específica para Proxmox */}
                <div>
                  <label className="form-label">Contraseña Proxmox</label>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="(Para login/consola)"
                    value={newHypervisor.proxmoxPassword}
                    onChange={(e) => setNewHypervisor(prev => ({ ...prev, proxmoxPassword: e.target.value }))}
                  />
                </div>
                {/* Token API para Proxmox */}
                <div className="sm:col-span-2 my-1 text-sm text-slate-500 dark:text-slate-400">
                  Y/O Token API (para operaciones generales):
                </div>
                <div className="sm:col-span-1">
                  <label className="form-label">Nombre del Token </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="mytoken"
                    value={newHypervisor.tokenName || ''}
                    onChange={(e) => setNewHypervisor(prev => ({ ...prev, tokenName: e.target.value }))}
                  />
                </div>
                <div className="sm:col-span-1">
                  <label className="form-label">Secreto del Token API </label>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    value={newHypervisor.apiToken || ''}
                    onChange={(e) => setNewHypervisor(prev => ({ ...prev, apiToken: e.target.value }))}
                  />
                </div>
              </>
            )}
            {newHypervisor.type === 'vsphere' && (
              <div>
                <label className="form-label">Contraseña vSphere</label>
                <input
                  type="password"
                  className="form-input"
                  value={newHypervisor.password}
                  onChange={(e) => setNewHypervisor(prev => ({ ...prev, password: e.target.value }))}
                />
              </div>
            )}
          </div>

          <div className="mt-6 flex justify-end space-x-3">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setIsAddingNew(false);
                // Reset form on cancel
                setNewHypervisor({ type: 'proxmox', host: '', username: '', password: '', proxmoxPassword: '', apiToken: '', tokenName: '' });
              }}
              disabled={isLoading} // Disable while add is in progress
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleAddNew}
              disabled={!isConnectButtonEnabled || isLoading}
            >
              {isLoading ? 'Conectando...' : 'Conectar y Guardar'}
            </button>
          </div>
        </motion.div>
      )}

      {isLoading && hypervisors.length === 0 ? ( // Show skeleton only on initial load
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="card">
              <div className="p-4 animate-pulse">
                <div className="flex justify-between mb-4">
                  <div className="h-10 bg-slate-200 dark:bg-slate-700 rounded w-1/2"></div>
                  <div className="h-6 bg-slate-200 dark:bg-slate-700 rounded w-1/4"></div>
                </div>
                <div className="space-y-3">
                  <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-full"></div>
                  <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-full"></div>
                  <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4"></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : filteredHypervisors.length > 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          {filteredHypervisors.map(hypervisor => (
            <HypervisorCard
              key={hypervisor.id}
              hypervisor={hypervisor}
              onConnectionChange={handleConnectionChange} // Pass the callback function
              onDelete={handleDelete}
            />
          ))}
        </motion.div>
      ) : (
        <div className="text-center py-10">
          <div className="mx-auto h-12 w-12 text-slate-400">
            {/* Use a different icon or keep Search */}
            <Search className="h-full w-full" />
          </div>
          <h3 className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">No se encontraron hipervisores</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {searchTerm ? 'Intenta ajustar tu búsqueda.' : 'Empieza añadiendo una conexión de hipervisor.'}
          </p>
          {!searchTerm && (user?.role === 'admin' || user?.role === 'user') && (
            // Only show button if not searching and user has correct role
            <>
              <div className="mt-6">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setIsAddingNew(true)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Añadir Hipervisor
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
                  />
                </div>
              </>
            )}
          </div>

          <div className="mt-6 flex justify-end space-x-3">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setIsAddingNew(false);
                // Reset form on cancel
                setNewHypervisor({ type: 'proxmox', host: '', username: '', password: '', apiToken: '', tokenName: '' });
              }}
              disabled={isLoading} // Disable while add is in progress
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleAddNew}
              disabled={!isConnectButtonEnabled || isLoading}
            >
              {isLoading ? 'Conectando...' : 'Conectar y Guardar'}
            </button>
          </div>
        </motion.div>
      )}

      {isLoading && hypervisors.length === 0 ? ( // Show skeleton only on initial load
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="card">
              <div className="p-4 animate-pulse">
                <div className="flex justify-between mb-4">
                  <div className="h-10 bg-slate-200 dark:bg-slate-700 rounded w-1/2"></div>
                  <div className="h-6 bg-slate-200 dark:bg-slate-700 rounded w-1/4"></div>
                </div>
                <div className="space-y-3">
                  <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-full"></div>
                  <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-full"></div>
                  <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4"></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : filteredHypervisors.length > 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          {filteredHypervisors.map(hypervisor => (
            <HypervisorCard
              key={hypervisor.id}
              hypervisor={hypervisor}
              onConnectionChange={handleConnectionChange} // Pass the callback function
              onDelete={handleDelete}
            />
          ))}
        </motion.div>
      ) : (
        <div className="text-center py-10">
          <div className="mx-auto h-12 w-12 text-slate-400">
            {/* Use a different icon or keep Search */}
            <Search className="h-full w-full" />
          </div>
          <h3 className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">No se encontraron hipervisores</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {searchTerm ? 'Intenta ajustar tu búsqueda.' : 'Empieza añadiendo una conexión de hipervisor.'}
          </p>
          {!searchTerm && (user?.role === 'admin' || user?.role === 'user') && (
            // Only show button if not searching and user has correct role
            <>
              <div className="mt-6">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setIsAddingNew(true)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Añadir Hipervisor
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
