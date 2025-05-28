import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom"; // Importar Link
import {
  Server,
  Cpu,
  MemoryStick as Memory,
  HardDrive,
  Power,
  Network,
  Clock,
  Activity,
  Info,
  ServerCog,
  NetworkIcon,
  FileText, // Importar FileText para el icono de descripción
  Tag,
  Ticket,
  Users,
  TerminalSquare,
  ArrowLeft, // Importar ArrowLeft
} from "lucide-react"; // Added Ticket
import type { VM, VMMetrics, PowerAction } from "../types/vm"; // Use the correct VM type and import VMMetrics, PowerAction
import { formatBytes } from "../utils/formatters"; // Helper function to format bytes (create this file if needed)
import { toast } from "react-hot-toast";
import { useAuth } from "../hooks/useAuth";
import VMConsoleView, { type ConsoleDetailsData } from "../components/VMConsoleView"; // Import ConsoleDetailsData
import VMControls from "../components/vmdetails/VMControls"; // Import the new VMControls component

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL; // Read from .env

export default function VMDetails() {
  const { id } = useParams();
  const [vm, setVM] = useState<VM | null>(null); // Use VM type
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<VMMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const { user, token: authToken } = useAuth(); // Get user and token from context
  const [consoleDetails, setConsoleDetails] = useState<ConsoleDetailsData | null>(null); // Use specific type
  const [isConsoleLoading, setIsConsoleLoading] = useState(false);
  const [showConsoleView, setShowConsoleView] = useState(false); // To toggle console modal

  const fetchVMDetails = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/vms/${id}`, {
        headers: {
          ...(authToken && { Authorization: `Bearer ${authToken}` }),
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data: VM = await response.json();
      setVM(data);
    } catch (error) {
      console.error("Error fetching VM details:", error);
      toast.error("Failed to load VM details.");
      setVM(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVMDetails();
  }, [id, authToken]);

  // Fetch metrics periodically
  useEffect(() => {
    if (!vm || vm.status !== "running") {
      setMetrics(null); // Clear metrics if VM is not running or not loaded
      return; // Don't fetch if VM isn't running
    }

    const fetchMetrics = async () => {
      setMetricsLoading(true);
      try {
        //const token = localStorage.getItem('authToken');
        const response = await fetch(`${API_BASE_URL}/vms/${id}/metrics`, {
          headers: {
            ...(authToken && { Authorization: `Bearer ${authToken}` }),
          },
        });
        if (!response.ok) {
          // Don't toast every time, maybe just log or show a subtle indicator
          console.error(`Metrics fetch failed: ${response.status}`);
          setMetrics(null); // Clear metrics on error
        } else {
          const data: VMMetrics = await response.json();
          setMetrics(data);
        }
      } catch (error) {
        console.error("Error fetching VM metrics:", error);
        setMetrics(null); // Clear metrics on error
      } finally {
        setMetricsLoading(false);
      }
    };

    fetchMetrics(); // Fetch immediately
    const intervalId = setInterval(fetchMetrics, 10000); // Fetch every 10 seconds

    return () => clearInterval(intervalId); // Cleanup interval on unmount or when VM/status changes
  }, [id, vm, vm?.status, authToken]); // Re-run if VM data or status changes

  const handleOpenConsole = async () => {
    if (!vm) return;
    setIsConsoleLoading(true);
    setConsoleDetails(null);
    try {
      const response = await fetch(`${API_BASE_URL}/vms/${vm.id}/console`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken && { Authorization: `Bearer ${authToken}` }),
        },
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.details ||
            errorData.error ||
            `Failed to get console details (status: ${response.status})`
        );
      }
      const data = await response.json();
      setConsoleDetails(data);
      setShowConsoleView(true); // Show the console view modal
      console.log("Console Details:", data);
    } catch (error: any) {
      console.error("Error fetching console details:", error);
      toast.error(`Failed to open console: ${error.message}`);
      setConsoleDetails(null);
      setShowConsoleView(false);
    } finally {
      setIsConsoleLoading(false);
    }
  };

  const handleVMAction = async (action: PowerAction) => {
    if (!vm) {
      toast.error("VM data not available to perform action.");
      return;
    }
    // Optional: Optimistic UI update for status can be done here
    // For example: setVM(prev => prev ? ({ ...prev, status: 'pending' }) : null);

    try {
      const response = await fetch(`${API_BASE_URL}/vms/${vm.id}/action`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken && { Authorization: `Bearer ${authToken}` }),
        },
        body: JSON.stringify({ action }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || errorData.error || `Failed to perform action: ${action}`);
      }

      toast.success(`Action '${action}' initiated successfully for ${vm.name}.`);
      // Refresh VM details after a short delay to allow hypervisor to process
      setTimeout(() => {
        fetchVMDetails(); // Use the new standalone fetch function
        // Also refetch metrics if VM was started/resumed
        if (action === 'start' || action === 'resume') setMetricsLoading(true); // This will trigger metrics useEffect
      }, 3000); // Adjust delay as needed
    } catch (error: any) {
      console.error(`Error performing action ${action} on VM ${vm.id}:`, error);
      toast.error(`Failed to ${action} VM: ${error.message}`);
      // Optional: Revert optimistic UI update if one was made
    }
  };

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
        <h2 className="text-2xl font-semibold text-gray-700">
          Virtual Machine No Encontrada
        </h2>
        <p className="text-gray-500 mt-2">La VM requerida no se encuentra.</p>
      </div>
    );
  }

  // Helper to format uptime
  const formatUptime = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    // const s = Math.floor(seconds % 60);
    let str = "";
    if (d > 0) str += `${d}d `;
    if (h > 0 || d > 0) str += `${h}h `; // Show hours if days > 0
    if (m > 0 || h > 0 || d > 0) str += `${m}m`; // Show minutes if hours > 0
    // if (s > 0) str += `${s}s`;
    return str.trim() || "0s";
  };

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Botón Volver */}
      <div className="mb-4">
        <Link to="/" className="inline-flex items-center text-sm text-primary-600 dark:text-primary-400 hover:underline">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Volver al Dashboard
        </Link>
      </div>
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
              <span
                className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                  vm.status === "running"
                    ? "bg-success-100 text-success-800 dark:bg-success-900 dark:text-success-200"
                    : vm.status === "stopped"
                    ? "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200"
                    : "bg-warning-100 text-warning-800 dark:bg-warning-900 dark:text-warning-200" // Example for other statuses
                }`}
              >
                <Power className="w-4 h-4 mr-1" />
                {vm.status.charAt(0).toUpperCase() + vm.status.slice(1)}
              </span>
            {/* Console Button */}
            {vm.status === "running" && (
                <button
                    onClick={handleOpenConsole}
                    disabled={isConsoleLoading}
                    className="ml-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                >
                    <TerminalSquare className="w-5 h-5 mr-2" />
                    {isConsoleLoading ? "Loading..." : "Open Console"}
                </button>
            )}
            </div> {/* This was the div for ml-auto flex items-center space-x-2 */}
            {/* Debug: Display consoleDetails if not showing modal (can be removed later) */}
            {/* {consoleDetails && !showConsoleView && (
                <pre className="mt-2 p-2 bg-slate-900 text-xs text-white rounded overflow-auto max-h-32">{JSON.stringify(consoleDetails, null, 2)}</pre>
            )} */}
          </div>
        </div>

        {/* VM Controls Section */}
        {vm && (user?.role === 'admin' || user?.role === 'user') && (
            <VMControls vm={vm} onAction={handleVMAction} />
        )}

        {/* Details Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
          {/* CPU Info */}
          <div className="bg-slate-50 dark:bg-slate-700 rounded-lg p-4">
            <div className="flex items-center space-x-3 mb-3">
              <Cpu className="w-6 h-6 text-blue-600" />
              <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200">
                CPU
              </h3>
            </div>
            <p className="text-slate-600 dark:text-slate-300">
              {vm.specs.cpu} vCPUs
            </p>
          </div>

          {/* Memory Info */}
          <div className="bg-slate-50 dark:bg-slate-700 rounded-lg p-4">
            <div className="flex items-center space-x-3 mb-3">
              <Memory className="w-6 h-6 text-blue-600" />
              <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200">
                Memory
              </h3>
            </div>
            <p className="text-slate-600 dark:text-slate-300">
              {vm.specs.memory >= 1024
                ? `${(vm.specs.memory / 1024).toFixed(1)} GB`
                : `${vm.specs.memory} MB`}{" "}
              RAM
            </p>
          </div>

          {/* Storage Info */}
          <div className="bg-slate-50 dark:bg-slate-700 rounded-lg p-4">
            <div className="flex items-center space-x-3 mb-3">
              <HardDrive className="w-6 h-6 text-blue-600" />
              <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200">
                Storage
              </h3>
            </div>
            <p className="text-slate-600 dark:text-slate-300">
              {vm.specs.disk} GB
            </p>
          </div>
        </div>

        {/* Additional Information Section (Combined) */}
        {(vm.description ||
          vm.hypervisorType ||
          vm.nodeName ||
          (vm.tags && vm.tags.length > 0) ||
          vm.ticket ||
          vm.finalClientName) && (
          <div className="border-t border-slate-200 dark:border-slate-700 p-6">
            <h3 className="text-xl font-semibold text-slate-800 dark:text-slate-100 mb-4 flex items-center">
              <Info className="w-6 h-6 mr-2 text-primary-600" />
              Información Adicional
            </h3>
            <div className="space-y-3">
              {/* Hypervisor Type */}
              {vm.hypervisorType && (
                <div className="flex items-start space-x-2">
                  <ServerCog className="w-5 h-5 text-slate-500 dark:text-slate-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                      Tipo Hypervisor:
                    </span>
                    <p className="text-slate-800 dark:text-slate-100">
                      {vm.hypervisorType}
                    </p>
                  </div>
                </div>
              )}
              {/* Node */}
              {vm.nodeName && (
                <div className="flex items-start space-x-2">
                  <NetworkIcon className="w-5 h-5 text-slate-500 dark:text-slate-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                      Nodo:
                    </span>
                    <p className="text-slate-800 dark:text-slate-100">
                      {vm.nodeName}
                    </p>
                  </div>
                </div>
              )}
              {/* Description */}
              {vm.description && (
                <div className="flex items-start space-x-2 pt-1">
                  <FileText className="w-5 h-5 text-slate-500 dark:text-slate-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                      Descripción:
                    </span>
                    <p className="text-slate-800 dark:text-slate-100 whitespace-pre-wrap">
                      {vm.description}
                    </p>
                  </div>
                </div>
              )}
              {/* Tags */}
              {vm.tags && vm.tags.length > 0 && (
                <div className="flex items-start space-x-2">
                  <Tag className="w-5 h-5 text-slate-500 dark:text-slate-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                      Tags:
                    </span>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {vm.tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-800 dark:text-primary-300"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            {/* Ticket */}
            {vm.ticket && (
                <div className="flex items-start space-x-2">
                    <Ticket className="w-5 h-5 text-slate-500 dark:text-slate-400 mt-0.5 flex-shrink-0" />
                    <div>
                    <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                        Ticket:
                    </span>
                    <p className="text-slate-800 dark:text-slate-100">{vm.ticket}</p>
                    </div>
                </div>
            )}
            {/* Final Client */}
            {vm.finalClientName && (
                <div className="flex items-start space-x-2">
                    <Users className="w-5 h-5 text-slate-500 dark:text-slate-400 mt-0.5 flex-shrink-0" />{" "}
                    {/* Assuming Users icon from lucide */}
                    <div>
                    <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                        Cliente Final:
                    </span>
                    <p className="text-slate-800 dark:text-slate-100">
                        {vm.finalClientName}
                    </p>
                    </div>
                </div>
            )}
            </div>
          </div>
        )}
       
        {/* Performance Metrics Section */}
        {vm.status === "running" && (
          <div className="border-t border-slate-200 dark:border-slate-700 p-6">
            <h3 className="text-xl font-semibold text-slate-800 dark:text-slate-100 mb-4 flex items-center">
              <Activity className="w-6 h-6 mr-2 text-primary-600" />
              Performance Metrics
              {metricsLoading && (
                <div className="ml-2 animate-spin rounded-full h-4 w-4 border-b-2 border-slate-400"></div>
              )}
            </h3>
            {metrics ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* CPU Usage */}
                <div className="bg-slate-50 dark:bg-slate-700 rounded-lg p-3">
                  <div className="flex items-center space-x-2 mb-1">
                    <Cpu className="w-5 h-5 text-blue-500" />
                    <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                      CPU Usage
                    </span>
                  </div>
                  <p className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                    {metrics.cpu.toFixed(1)}%
                  </p>
                </div>
                {/* Memory Usage */}
                <div className="bg-slate-50 dark:bg-slate-700 rounded-lg p-3">
                  <div className="flex items-center space-x-2 mb-1">
                    <Memory className="w-5 h-5 text-green-500" />
                    <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                      Memory Usage
                    </span>
                  </div>
                  <p className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                    {metrics.memory.toFixed(1)}%
                  </p>
                </div>
                {/* Network I/O (Total) */}
                <div className="bg-slate-50 dark:bg-slate-700 rounded-lg p-3">
                  <div className="flex items-center space-x-2 mb-1">
                    <Network className="w-5 h-5 text-purple-500" />
                    <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                      Network (Total)
                    </span>
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-200">
                    In: {formatBytes(metrics.network.in)}
                  </p>
                  <p className="text-sm text-slate-700 dark:text-slate-200">
                    Out: {formatBytes(metrics.network.out)}
                  </p>
                </div>
                {/* Uptime */}
                <div className="bg-slate-50 dark:bg-slate-700 rounded-lg p-3">
                  <div className="flex items-center space-x-2 mb-1">
                    <Clock className="w-5 h-5 text-orange-500" />
                    <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                      Uptime
                    </span>
                  </div>
                  <p className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                    {formatUptime(metrics.uptime)}
                  </p>
                </div>
              </div>
            ) : (
              !metricsLoading && (
                <p className="text-slate-500 dark:text-slate-400">
                  Metrics data is currently unavailable.
                </p>
              )
            )}
          </div>
        )}
      </div>
      {/* Console Modal */}
      {showConsoleView && consoleDetails && (
        <VMConsoleView
          consoleDetails={consoleDetails}
          onClose={() => {
            setShowConsoleView(false);
            setConsoleDetails(null); // Clear details when closing
          }}
          onError={(message) => toast.error(`Console Error: ${message}`)}
        />
      )}
    </div>
  );
}
