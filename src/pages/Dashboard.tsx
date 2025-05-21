import { useState, useEffect, useCallback } from 'react';
import { Plus, RefreshCw, Search, CloudOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import VirtualMachineCard from '../components/dashboard/VirtualMachineCard';
import { VM } from '../types/vm';
import { toast } from 'react-hot-toast';
import { useAuth } from '../hooks/useAuth';
import { Hypervisor } from '../types/hypervisor'; // <-- Importado desde el archivo de tipos

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export default function Dashboard() {
  const [vms, setVms] = useState<VM[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true); // True: loading VMs or initial hypervisor check
  const [filter, setFilter] = useState<string>('all');
  const { user, token: authToken } = useAuth();

  const [hypervisors, setHypervisors] = useState<Hypervisor[]>([]);
  const [isLoadingHypervisors, setIsLoadingHypervisors] = useState(true);
  const [hasConnectedHypervisors, setHasConnectedHypervisors] = useState(false);

  const fetchHypervisors = useCallback(async () => {
    if (!authToken) {
      setIsLoadingHypervisors(false);
      setHasConnectedHypervisors(false);
      setIsLoading(false);
      setVms([]);
      return;
    }
    setIsLoadingHypervisors(true);
    try {
      const response = await fetch(`${API_BASE_URL}/hypervisors`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data: Hypervisor[] = await response.json();
      setHypervisors(data);
      const connected = data.some(h => h.status === 'connected');
      setHasConnectedHypervisors(connected);
      if (!connected) {
        setVms([]);
        setIsLoading(false);
      }
    } catch (error) {
      console.error('Error fetching hypervisors:', error);
      toast.error('Failed to load hypervisor information.');
      setHasConnectedHypervisors(false);
      setVms([]);
      setIsLoading(false);
    } finally {
      setIsLoadingHypervisors(false);
    }
  }, [authToken]);

  const fetchVMs = useCallback(async () => {
    if (!authToken) {
      setIsLoading(false);
      setVms([]);
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/vms`, {
         headers: {
           'Authorization': `Bearer ${authToken}`,
         },
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data: VM[] = await response.json();
      setVms(data);
    } catch (error) {
      console.error('Error fetching VMs:', error);
      toast.error('Failed to load virtual machines.');
      setVms([]);
    } finally {
      setIsLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    fetchHypervisors();
  }, [fetchHypervisors]);

  useEffect(() => {
    if (hasConnectedHypervisors && authToken) {
      fetchVMs();
    } else if (!hasConnectedHypervisors) {
      setVms([]);
      setIsLoading(false);
    }
  }, [hasConnectedHypervisors, fetchVMs, authToken]);

  const handleVMAction = async (action: 'start' | 'stop' | 'restart', vmId: string) => {
    if (!authToken) return toast.error("Authentication token not found.");

    const originalVM = vms.find(v => v.id === vmId);
    if (!originalVM) return;

    const optimisticStatus = action === 'start' ? 'running' : action === 'stop' ? 'stopped' : originalVM.status;
    setVms(prevVMs => prevVMs.map(vm =>
      vm.id === vmId ? { ...vm, status: optimisticStatus } : vm
    ));

    try {
      const response = await fetch(`${API_BASE_URL}/vms/${vmId}/action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ action }),
      });

      if (!response.ok) {
        setVms(prevVMs => prevVMs.map(vm =>
          vm.id === vmId ? originalVM : vm
        ));
        const errorData = await response.json().catch(() => ({ message: 'Failed to parse error response' }));
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      toast.success(`Acción VM '${action}' iniciada con éxito.`);
      // Optionally, re-fetch VMs after a short delay
      // setTimeout(fetchVMs, 3000); 
    } catch (error: unknown) {
      console.error(`Error performing action '${action}' on VM ${vmId}:`, error);
      setVms(prevVMs => prevVMs.map(vm => vm.id === vmId ? originalVM : vm ));
      let errorMessage = `Failed to perform action '${action}'.`;
      if (error instanceof Error) { errorMessage = `Failed to perform action '${action}': ${error.message}`; }
      toast.error(errorMessage);
    }
  };

  const filteredVMs = vms.filter(vm => {
    const matchesSearch = (vm.name?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
                          (vm.hypervisorType?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
                          (vm.nodeName?.toLowerCase() || '').includes(searchTerm.toLowerCase());
    const matchesFilter = filter === 'all' || 
                          (filter === 'running' && vm.status === 'running') ||
                          (filter === 'stopped' && vm.status === 'stopped') ||
                          (filter === 'proxmox' && vm.hypervisorType === 'proxmox') ||
                          (filter === 'vsphere' && vm.hypervisorType === 'vsphere');
    
    return matchesSearch && matchesFilter;
  });

  let mainContent;

  if (isLoadingHypervisors) {
    mainContent = (
      <div className="text-center py-10">
        <RefreshCw className="h-12 w-12 text-slate-400 animate-spin mx-auto" />
        <p className="mt-2 text-slate-500 dark:text-slate-400">Cargando información de hypervisores...</p>
      </div>
    );
  } else if (!hasConnectedHypervisors) {
    mainContent = (
      <div className="text-center py-10">
        <CloudOff className="mx-auto h-12 w-12 text-slate-400" />
        <h3 className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">No hay hypervisores conectados</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Para empezar a gestionar máquinas virtuales, primero debe {user?.role === 'admin' ? 'crear y conectar' : 'contactar a un administrador para configurar'} un hypervisor.
        </p>
        {(user?.role === 'admin') && (
          <div className="mt-6">
            <Link to="/hypervisors" className="btn btn-primary">
              <Plus className="h-4 w-4 mr-2" />
              Configurar Hypervisor
            </Link>
          </div>
        )}
      </div>
    );
  } else if (isLoading) {
    mainContent = (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="card">
            <div className="p-4 animate-pulse">
              <div className="h-6 bg-slate-200 dark:bg-slate-700 rounded w-3/4 mb-4"></div>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-full"></div>
                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-full"></div>
                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-full"></div>
                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-full"></div>
              </div>
              <div className="h-10 bg-slate-200 dark:bg-slate-700 rounded w-full"></div>
            </div>
          </div>
        ))}
      </div>
    );
  } else if (filteredVMs.length > 0) {
    mainContent = (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
      >
        {filteredVMs.map(vm => (
          <VirtualMachineCard 
            key={vm.id} 
            vm={vm} 
            onAction={handleVMAction} 
          />
        ))}
      </motion.div>
    );
  } else {
    mainContent = (
      <div className="text-center py-10">
        <div className="mx-auto h-12 w-12 text-slate-400">
          <Search className="h-full w-full" />
        </div>
        <h3 className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">No se encontraron VMs</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {searchTerm ? 'Intente con otro término de búsqueda o filtro.' : 'Empiece creando una nueva máquina virtual.'}
        </p>
        {(user?.role === 'admin' || user?.role === 'user') && (
          <div className="mt-6">
            <Link to="/create-vm" className="btn btn-primary">
              <Plus className="h-4 w-4 mr-2" />
              Nueva VM
            </Link>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Dashboard</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1">
          Maneje y monitoree lass maquinas virtual
        </p>
      </div>

      {!isLoadingHypervisors && hasConnectedHypervisors && (
        <div className="flex flex-col lg:flex-row gap-4 mb-6 justify-between">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-slate-400" />
            </div>
            <input
              type="text"
              placeholder="Busque VMs..."
              className="form-input pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex">
              {(['all', 'running', 'stopped', 'proxmox', 'vsphere'] as const).map((filterType, index, arr) => (
                <button
                  key={filterType}
                  className={`px-3 py-2 text-sm font-medium border border-slate-300 dark:border-slate-700 
                    ${filter === filterType ? 'bg-primary-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'}
                    ${index === 0 ? 'rounded-l-md' : ''}
                    ${index === arr.length -1 ? 'rounded-r-md' : 'border-r-0'}`}
                  onClick={() => setFilter(filterType)}
                >
                  {filterType.charAt(0).toUpperCase() + filterType.slice(1)}
                </button>
              ))}
            </div>
            
            <div className="flex gap-2">
              <button 
                onClick={fetchVMs}
                className="btn btn-secondary"
                disabled={isLoading}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                Refrescar
              </button>
              
              {(user?.role === 'admin' || user?.role === 'user') && (
                <Link to="/create-vm" className="btn btn-primary">
                  <Plus className="h-4 w-4 mr-2" />
                  Nueva VM
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      {mainContent}
    </div>
  );
}
