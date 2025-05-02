import { useState, useEffect } from 'react';
import { Cloud, Server as Servers, Clock, AlertCircle, HardDrive, Layers, Cpu, MemoryStick, Database } from 'lucide-react'; // Added Cpu, MemoryStick, Database
import { Hypervisor, NodeResource, StorageResource, OSTemplate } from '../../types/hypervisor';
import { formatDistanceToNow } from 'date-fns';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast';
import { formatBytes } from '../../utils/formatters'; // Import the new utility
// It might be better to define this in a central config file
const API_BASE_URL = 'http://localhost:3001/api';

interface HypervisorCardProps {
  hypervisor: Hypervisor;
  onDelete: (id: string) => void;
  onConnectionChange: (updatedHypervisor: Hypervisor) => void; // Callback to update parent state
}

export default function HypervisorCard({ hypervisor, onDelete, onConnectionChange }: HypervisorCardProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  // State for detailed resources
  const [nodes, setNodes] = useState<NodeResource[] | null>(null);
  const [storage, setStorage] = useState<StorageResource[] | null>(null);
  const [templates, setTemplates] = useState<OSTemplate[] | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

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

  // Function to fetch detailed resources
  const fetchDetails = async () => {
    if (hypervisor.status !== 'connected' || isLoadingDetails) return;

    setIsLoadingDetails(true);
    setNodes(null); // Clear previous details
    setStorage(null);
    setTemplates(null);
    console.log(`Fetching details for ${hypervisor.id}`);

    try {
      const headers = { 'Authorization': 'Bearer MOCK_TOKEN' }; // Replace with actual token logic
      const [nodesRes, storageRes, templatesRes] = await Promise.all([
        fetch(`${API_BASE_URL}/hypervisors/${hypervisor.id}/nodes`, { headers }),
        fetch(`${API_BASE_URL}/hypervisors/${hypervisor.id}/storage`, { headers }),
        fetch(`${API_BASE_URL}/hypervisors/${hypervisor.id}/templates`, { headers }),
      ]);

      if (!nodesRes.ok || !storageRes.ok || !templatesRes.ok) {
        // Handle errors more granularly if needed
        throw new Error('Failed to fetch one or more resources');
      }

      const nodesData = await nodesRes.json();
      const storageData = await storageRes.json();
      const templatesData = await templatesRes.json();

      setNodes(nodesData);
      setStorage(storageData);
      setTemplates(templatesData);
      console.log('Details fetched:', { nodesData, storageData, templatesData });

    } catch (error) {
      console.error('Failed to fetch hypervisor details:', error);
      toast.error('Could not load hypervisor details.');
    } finally {
      setIsLoadingDetails(false);
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
      console.log(response);
      const updatedHypervisorData = await response.json();

      if (!response.ok) {
        throw new Error(updatedHypervisorData.error || `HTTP error! status: ${response.status}`);
      }

      // The backend /connect endpoint ONLY returns { status, lastSync }
      // We need to merge this with the existing hypervisor data
      const formattedHypervisor: Hypervisor = {
        ...hypervisor, // Keep existing data
        status: updatedHypervisorData.status, // Update status
        lastSync: updatedHypervisorData.lastSync ? new Date(updatedHypervisorData.lastSync) : null,
        updatedAt: new Date(), // Assume update time is now
      };

      toast.success(`Connection ${formattedHypervisor.status}!`, { id: toastId });
      onConnectionChange(formattedHypervisor); // Notify parent component

      // If connection is successful, fetch details
      if (formattedHypervisor.status === 'connected') {
        fetchDetails();
      }

    } catch (error: unknown) {
      console.error('Connection attempt failed:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Connection failed: ${message}`, { id: toastId });
    } finally {
      setIsConnecting(false);
    }
  };

  // Fetch details when the component mounts if already connected
  useEffect(() => {
    if (hypervisor.status === 'connected') {
      fetchDetails();
    }
  }, [hypervisor.id, hypervisor.status]); // Re-fetch if ID or status changes

  // --- Calculation Helpers for Aggregated Stats ---
  const calculateAggregatedStats = () => {
    const onlineNodes = nodes?.filter(n => n.status === 'online') || [];

    // CPU
    const totalCores = onlineNodes.reduce((sum, node) => sum + (node.cpu?.cores || 0), 0);
    // Weighted average CPU usage: (usage1*cores1 + usage2*cores2 + ...) / totalCores
    const totalWeightedUsage = onlineNodes.reduce((sum, node) => sum + ((node.cpu?.usage || 0) * (node.cpu?.cores || 0)), 0);
    const avgCpuUsage = totalCores > 0 ? (totalWeightedUsage / totalCores) * 100 : 0; // Percentage

    // Memory
    const totalMemory = onlineNodes.reduce((sum, node) => sum + (node.memory?.total || 0), 0);
    const usedMemory = onlineNodes.reduce((sum, node) => sum + (node.memory?.used || 0), 0);

    // Disk (Storage)
    const totalDisk = storage?.reduce((sum, s) => sum + (s.size || 0), 0) || 0;
    const usedDisk = storage?.reduce((sum, s) => sum + (s.used || 0), 0) || 0;

    return {
      totalCores,
      avgCpuUsage,
      totalMemory,
      usedMemory,
      totalDisk,
      usedDisk,
    };
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

        {/* Detailed Resource Section */}
        {hypervisor.status === 'connected' && (
          <div className="border-t border-slate-200 dark:border-slate-700 pt-3 mt-3 text-xs text-slate-600 dark:text-slate-400 space-y-2">
            {isLoadingDetails && <div className="text-center text-slate-500">Loading details...</div>}
            {!isLoadingDetails && nodes !== null && storage !== null && templates !== null && (
              <>
                {/* Node Summary */}
                <div className="flex items-center space-x-2">
                  <Servers className="h-3.5 w-3.5 flex-shrink-0" />
                  <span>
                    Nodes: {nodes.length} ({nodes.filter(n => n.status === 'online').length} online)
                  </span>
                </div>

                {/* Aggregated Stats */}
                {(() => {
                  const stats = calculateAggregatedStats();
                  return (
                    <>
                      {/* CPU */}
                      <div className="flex items-center space-x-2">
                        <Cpu className="h-3.5 w-3.5 flex-shrink-0" />
                        <span>
                          CPU: {stats.avgCpuUsage.toFixed(1)}% used ({stats.totalCores} Cores)
                        </span>
                      </div>
                      {/* Memory */}
                      <div className="flex items-center space-x-2">
                        <MemoryStick className="h-3.5 w-3.5 flex-shrink-0" />
                        <span>
                          Memory: {formatBytes(stats.usedMemory)} / {formatBytes(stats.totalMemory)} used
                        </span>
                      </div>
                      {/* Disk */}
                      <div className="flex items-center space-x-2">
                        <Database className="h-3.5 w-3.5 flex-shrink-0" />
                        <span>
                          Disk: {formatBytes(stats.usedDisk)} / {formatBytes(stats.totalDisk)} used ({storage?.length || 0} Pools)
                        </span>
                      </div>
                    </>
                  );
                })()}

                {/* Template Summary */}
                <div className="flex items-center space-x-2">
                  <Layers className="h-3.5 w-3.5 flex-shrink-0" />
                  <span>
                    Templates/ISOs: {templates.length}
                  </span>
                </div>
              </>
            )}
            {!isLoadingDetails && (nodes === null || storage === null || templates === null) && (
              <div className="text-center text-slate-500">Could not load details.</div>
            )}
          </div>
        )}
        {/* End Detailed Resource Section */}

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
