import { useState, useEffect, useCallback } from 'react'; // Import useCallback
import { Plus, RefreshCw, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import VirtualMachineCard from '../components/dashboard/VirtualMachineCard';
import { VM } from '../types/vm';
// import { mockVMs } from '../utils/mockData'; // No longer using mock data
import { toast } from 'react-hot-toast'; // For user feedback

const API_BASE_URL = 'http://localhost:3001/api'; // Define the base URL like in Hypervisors.tsx

export default function Dashboard() {
  const [vms, setVms] = useState<VM[]>([]); // State to hold VMs from API
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  // Define fetchVMs outside useEffect, wrapped in useCallback
  const fetchVMs = useCallback(async () => {
    setIsLoading(true);
    try {
      // Replace mock data with API call
      const response = await fetch(`${API_BASE_URL}/vms`, { // Use the full API URL
         headers: {
           // Include auth header if needed by your backend middleware
           'Authorization': 'Bearer MOCK_TOKEN', // Replace with actual token logic later
         },
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data: VM[] = await response.json();
      setVms(data); // Update state with fetched VMs
    } catch (error) {
      console.error('Error fetching VMs:', error);
      toast.error('Failed to load virtual machines.'); // User feedback
      setIsLoading(false);
    } finally {
      setIsLoading(false); // Ensure loading stops even if there's an error
    }
  }, []); // Empty dependency array as it doesn't depend on props/state that change

  useEffect(() => {
    fetchVMs();
    // fetchVMs is now stable due to useCallback, so it's safe to include if your linter insists,
    // but technically not needed here as the function itself doesn't change.
  }, []);

  const handleVMAction = async (action: 'start' | 'stop' | 'restart', vmId: string) => {
    console.log(`Action ${action} requested for VM ${vmId}`); // Placeholder

    // Find the VM to potentially revert state on error
    const originalVM = vms.find(v => v.id === vmId);
    if (!originalVM) return; // Should not happen

    // Optimistic UI update (optional, but makes UI feel faster)
    // Note: 'restart' doesn't have an immediate visual status change in this simple model
    const optimisticStatus = action === 'start' ? 'running' : action === 'stop' ? 'stopped' : originalVM.status;
    setVms(prevVMs => prevVMs.map(vm =>
      vm.id === vmId ? { ...vm, status: optimisticStatus } : vm
    ));

    try {
      const response = await fetch(`${API_BASE_URL}/vms/${vmId}/action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer MOCK_TOKEN', // Replace with actual token logic
        },
        body: JSON.stringify({ action }), // Send the action in the body
      });

      if (!response.ok) {
        // Revert optimistic update on failure
        setVms(prevVMs => prevVMs.map(vm =>
          vm.id === vmId ? originalVM : vm
        ));
        const errorData = await response.json().catch(() => ({ message: 'Failed to parse error response' }));
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      // const result = await response.json(); // Process result if needed (backend currently sends mock)
      toast.success(`VM action '${action}' initiated successfully.`);

      // Optionally, re-fetch VMs after a short delay to get the actual status from Proxmox
      // setTimeout(fetchVMs, 3000); // Example: refresh after 3 seconds

    } catch (error: unknown) {
      console.error(`Error performing action '${action}' on VM ${vmId}:`, error);
      // Revert optimistic update if not already done
      setVms(prevVMs => prevVMs.map(vm => vm.id === vmId ? originalVM : vm ));
      let errorMessage = `Failed to perform action '${action}'.`;
      if (error instanceof Error) { errorMessage = `Failed to perform action '${action}': ${error.message}`; }
      toast.error(errorMessage);
    }
  };

  const filteredVMs = vms.filter(vm => {
    const matchesSearch = (vm.name?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
                          (vm.hypervisorType?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
                          (vm.nodeName?.toLowerCase() || '').includes(searchTerm.toLowerCase()); // Add node to search
    const matchesFilter = filter === 'all' || 
                          (filter === 'running' && vm.status === 'running') ||
                          (filter === 'stopped' && vm.status === 'stopped') ||
                          (filter === 'proxmox' && vm.hypervisorType === 'proxmox') ||
                          (filter === 'vsphere' && vm.hypervisorType === 'vsphere');
    
    return matchesSearch && matchesFilter;
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Dashboard</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1">
          Maneje y monitoree lass maquinas virtual
        </p>
      </div>

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
            <button
              className={`px-3 py-2 text-sm font-medium ${filter === 'all' ? 'bg-primary-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'} border border-slate-300 dark:border-slate-700 border-r-0 rounded-l-md`}
              onClick={() => setFilter('all')}
            >
              Todas
            </button>
            <button
              className={`px-3 py-2 text-sm font-medium ${filter === 'running' ? 'bg-primary-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'} border border-slate-300 dark:border-slate-700 border-r-0`}
              onClick={() => setFilter('running')}
            >
              Running
            </button>
            <button
              className={`px-3 py-2 text-sm font-medium ${filter === 'stopped' ? 'bg-primary-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'} border border-slate-300 dark:border-slate-700 border-r-0`}
              onClick={() => setFilter('stopped')}
            >
              Detenidas
            </button>
            <button
              className={`px-3 py-2 text-sm font-medium ${filter === 'proxmox' ? 'bg-primary-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'} border border-slate-300 dark:border-slate-700 border-r-0`}
              onClick={() => setFilter('proxmox')}
            >
              Proxmox
            </button>
            <button
              className={`px-3 py-2 text-sm font-medium ${filter === 'vsphere' ? 'bg-primary-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'} border border-slate-300 dark:border-slate-700 rounded-r-md`}
              onClick={() => setFilter('vsphere')}
            >
              vSphere
            </button>
          </div>
          
          <div className="flex gap-2">
            <button 
              onClick={fetchVMs} // Call fetchVMs directly on refresh
              className="btn btn-secondary"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </button>
            
            <Link to="/create-vm" className="btn btn-primary">
              <Plus className="h-4 w-4 mr-2" />
              Nueva VM
            </Link>
          </div>
        </div>
      </div>

      {isLoading ? (
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
      ) : filteredVMs.length > 0 ? (
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
      ) : (
        <div className="text-center py-10">
          <div className="mx-auto h-12 w-12 text-slate-400">
            <Search className="h-full w-full" />
          </div>
          <h3 className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">No se encontraron VMs</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {searchTerm ? 'Try a different search term or filter.' : 'Start by creating a new virtual machine.'}
          </p>
          <div className="mt-6">
            <Link to="/create-vm" className="btn btn-primary">
              <Plus className="h-4 w-4 mr-2" />
              Nueva VM
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}