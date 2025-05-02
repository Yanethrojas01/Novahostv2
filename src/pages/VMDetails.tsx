import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Server, Cpu, MemoryStick as Memory, HardDrive, Power } from 'lucide-react';
import type { VM } from '../types/vm'; // Use the correct VM type
import { toast } from 'react-hot-toast';

const API_BASE_URL = 'http://localhost:3001/api'; // Define the base URL

export default function VMDetails() {
  const { id } = useParams();
  const [vm, setVM] = useState<VM | null>(null); // Use VM type
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchVM = async () => {
      setLoading(true);
      try {
        const response = await fetch(`${API_BASE_URL}/vms/${id}`, {
          headers: {
            'Authorization': 'Bearer MOCK_TOKEN', // Replace with actual token logic
          },
        });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data: VM = await response.json();
        setVM(data);
      } catch (error) {
        console.error('Error fetching VM details:', error);
        toast.error('Failed to load VM details.');
        setVM(null); // Ensure VM is null on error
      } finally {
        setLoading(false);
      }
    };

    fetchVM();
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!vm) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <Server className="w-16 h-16 text-gray-400 mb-4" />
        <h2 className="text-2xl font-semibold text-gray-700">Virtual Machine Not Found</h2>
        <p className="text-gray-500 mt-2">The requested VM could not be found.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-800 px-6 py-4">
          <div className="flex items-center space-x-4">
            <Server className="w-8 h-8 text-white" />
            <div>
              <h1 className="text-2xl font-bold text-white">{vm.name}</h1>
              <p className="text-blue-100">ID: {vm.id}</p>
            </div>
            <div className="ml-auto flex items-center space-x-2">
              <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                vm.status === 'running' ? 'bg-success-100 text-success-800 dark:bg-success-900 dark:text-success-200' :
                vm.status === 'stopped' ? 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200' :
                'bg-warning-100 text-warning-800 dark:bg-warning-900 dark:text-warning-200' // Example for other statuses
              }`}>
                <Power className="w-4 h-4 mr-1" />
                {vm.status.charAt(0).toUpperCase() + vm.status.slice(1)}
              </span>
            </div>
          </div>
        </div>

        {/* Details Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
          {/* CPU Info */}
          <div className="bg-slate-50 dark:bg-slate-700 rounded-lg p-4">
            <div className="flex items-center space-x-3 mb-3">
              <Cpu className="w-6 h-6 text-blue-600" />
              <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200">CPU</h3>
            </div>
            <p className="text-slate-600 dark:text-slate-300">{vm.specs.cpu} vCPUs</p>
          </div>

          {/* Memory Info */}
          <div className="bg-slate-50 dark:bg-slate-700 rounded-lg p-4">
            <div className="flex items-center space-x-3 mb-3">
              <Memory className="w-6 h-6 text-blue-600" />
              <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200">Memory</h3>
            </div>
            <p className="text-slate-600 dark:text-slate-300">{vm.specs.memory >= 1024 ? `${(vm.specs.memory / 1024).toFixed(1)} GB` : `${vm.specs.memory} MB`} RAM</p>
          </div>

          {/* Storage Info */}
          <div className="bg-slate-50 dark:bg-slate-700 rounded-lg p-4">
            <div className="flex items-center space-x-3 mb-3">
              <HardDrive className="w-6 h-6 text-blue-600" />
              <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200">Storage</h3>
            </div>
            <p className="text-slate-600 dark:text-slate-300">{vm.specs.disk} GB</p>
          </div>
        </div>

        {/* Performance Metrics */}
        {/* Performance Metrics Section Removed - Backend does not provide this data yet */}
      </div>
    </div>
  );
}