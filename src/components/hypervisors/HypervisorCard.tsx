import { useState } from 'react';
import { Cloud, Server as Servers, Clock, AlertCircle } from 'lucide-react';
import { Hypervisor } from '../../types/hypervisor';
import { formatDistanceToNow } from 'date-fns';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast';

// It might be better to define this in a central config file
const API_BASE_URL = 'http://localhost:3001/api';

interface HypervisorCardProps {
  hypervisor: Hypervisor;
  onDelete: (id: string) => void;
  onConnectionChange: (updatedHypervisor: Hypervisor) => void; // Callback to update parent state
}

export default function HypervisorCard({ hypervisor, onDelete, onConnectionChange }: HypervisorCardProps) {
  const [isConnecting, setIsConnecting] = useState(false);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected':
        return 'bg-success-500';
      case 'disconnected':
        return 'bg-slate-500';
      case 'error':
        return 'bg-danger-500';
      default:
        return 'bg-slate-300';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'connected':
        return 'Connected';
      case 'disconnected':
        return 'Disconnected';
      case 'error':
        return 'Error';
      default:
        return 'Unknown';
    }
  };

  const handleConnectionAttempt = async () => {
    setIsConnecting(true);
    const toastId = toast.loading('Attempting connection...');

    try {
      const response = await fetch(`${API_BASE_URL}/hypervisors/${hypervisor.id}/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer MOCK_TOKEN', // Replace with actual token logic
        },
        // Body might be needed if passing specific connection parameters in the future
      });

      const updatedHypervisorData = await response.json();

      if (!response.ok) {
        throw new Error(updatedHypervisorData.error || `HTTP error! status: ${response.status}`);
      }

      // Convert date strings from API response before passing up
      const formattedHypervisor: Hypervisor = {
        ...updatedHypervisorData,
        lastSync: updatedHypervisorData.lastSync ? new Date(updatedHypervisorData.lastSync) : null,
        createdAt: updatedHypervisorData.createdAt ? new Date(updatedHypervisorData.createdAt) : undefined,
        updatedAt: updatedHypervisorData.updatedAt ? new Date(updatedHypervisorData.updatedAt) : undefined,
      };

      toast.success(`Connection ${formattedHypervisor.status}!`, { id: toastId });
      onConnectionChange(formattedHypervisor); // Notify parent component
    } catch (error: unknown) {
      console.error('Connection attempt failed:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Connection failed: ${message}`, { id: toastId });
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="card"
    >
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            {hypervisor.type === 'proxmox' ? (
              <div className="p-2 bg-orange-100 dark:bg-orange-900/20 rounded-lg text-orange-600 dark:text-orange-400">
                <Servers className="h-5 w-5" />
              </div>
            ) : (
              <div className="p-2 bg-blue-100 dark:bg-blue-900/20 rounded-lg text-blue-600 dark:text-blue-400">
                <Cloud className="h-5 w-5" />
              </div>
            )}
            <div>
              <h3 className="font-medium text-lg text-slate-900 dark:text-white">
                {hypervisor.name}
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {hypervisor.host}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <div className={`h-3 w-3 rounded-full ${getStatusColor(hypervisor.status)}`}></div>
            <span className="text-sm text-slate-600 dark:text-slate-300">
              {getStatusText(hypervisor.status)}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          {/* nodeCount and totalVMs removed as they are not directly on the hypervisor record from DB */}
          {/* Conditionally render sync time only if lastSync is not null */}
          {hypervisor.lastSync ? (
            <div className="flex items-center space-x-2">
              <Clock className="h-4 w-4 text-slate-400" />
              <span className="text-sm text-slate-600 dark:text-slate-300">
                Synced {formatDistanceToNow(hypervisor.lastSync, { addSuffix: true })}
              </span>
            </div>
          ) : null /* Or render placeholder text like "Never synced" */}

          {hypervisor.status === 'error' && (
            <div className="flex items-center space-x-2">
              <AlertCircle className="h-4 w-4 text-danger-500" />
              <span className="text-sm text-danger-500">
                Connection error
              </span>
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 dark:border-slate-700 pt-3 flex justify-between">
          {hypervisor.status === 'disconnected' || hypervisor.status === 'error' ? (
            <button
              onClick={handleConnectionAttempt}
              className="btn btn-primary text-xs"
              disabled={isConnecting}
            >
              {isConnecting ? 'Connecting...' : 'Connect'}
            </button>
          ) : (
            <button
              onClick={handleConnectionAttempt} // Use the same handler for testing
              className="btn btn-outline text-xs"
              disabled={isConnecting}
            >
              {isConnecting ? 'Testing...' : 'Test Connection'}
            </button>
          )}
          <button
            onClick={() => onDelete(hypervisor.id)}
            className="btn btn-danger text-xs"
          >
            Remove
          </button>
        </div>
      </div>
    </motion.div>
  );
}
