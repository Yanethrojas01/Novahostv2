import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { Power, Terminal, RefreshCw, Edit, Trash2, ChevronLeft, Info, BarChart2, Settings, Play, StopCircle, RotateCcw } from 'lucide-react';
import { motion } from 'framer-motion';
import VMConsoleView, { ConsoleDetailsData } from '../components/VMConsoleView'; // Importa el componente de consola
import { VM, VMMetrics } from '../types/vm'; // Asegúrate que VM y VMMetrics estén bien definidos
import { useAuth } from '../hooks/useAuth'; // Para obtener el token

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export default function VMDetailsPage() {
  const { vmId } = useParams<{ vmId: string }>();
  const { token } = useAuth();
  const [vmDetails, setVmDetails] = useState<VM | null>(null);
  const [metrics, setMetrics] = useState<VMMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showConsoleModal, setShowConsoleModal] = useState(false);
  const [consoleDetailsData, setConsoleDetailsData] = useState<ConsoleDetailsData | null>(null);
  const [isLoadingConsole, setIsLoadingConsole] = useState(false);
  const [consoleApiError, setConsoleApiError] = useState<string | null>(null);

  const fetchVMDetails = async () => {
    if (!vmId) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/vms/${vmId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.details || errData.error || `Error al cargar detalles de la VM: ${response.statusText}`);
      }
      const data: VM = await response.json();
      setVmDetails(data);
    } catch (err) {
      console.error('Error fetching VM details:', err);
      setError(err instanceof Error ? err.message : 'Error desconocido al cargar detalles de la VM.');
      toast.error(err instanceof Error ? err.message : 'Error al cargar detalles de la VM.');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchVMMetrics = async () => {
    if (!vmId) return;
    try {
      const response = await fetch(`${API_BASE_URL}/vms/${vmId}/metrics`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!response.ok) {
        // No lanzar error si las métricas fallan, solo loguear o mostrar un mensaje menor
        console.warn(`Failed to fetch VM metrics: ${response.statusText}`);
        setMetrics(null); // o un estado de error para métricas
        return;
      }
      const data: VMMetrics = await response.json();
      setMetrics(data);
    } catch (err) {
      console.warn('Error fetching VM metrics:', err);
      setMetrics(null); // o un estado de error para métricas
    }
  };

  useEffect(() => {
    fetchVMDetails();
    fetchVMMetrics(); // Fetch initial metrics
    const intervalId = setInterval(fetchVMMetrics, 15000); // Refresh metrics every 15 seconds
    return () => clearInterval(intervalId);
  }, [vmId, token]);

  const handleOpenConsole = async () => {
    if (!vmId) return;
    setIsLoadingConsole(true);
    setConsoleApiError(null);
    setConsoleDetailsData(null);
    setShowConsoleModal(true);
    console.log(`[VMDetails] Attempting to open console for VM: ${vmId}`); // Log inicio

    try {
      const response = await fetch(`${API_BASE_URL}/vms/${vmId}/console`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });
      
      console.log(`[VMDetails] /console API response status: ${response.status}`); // Log status

      if (!response.ok) {
        let errorText = `Error del servidor: ${response.status}`;
        try {
            const errorData = await response.json();
            errorText = errorData.error || errorData.details || errorText;
            console.error("[VMDetails] /console API error response JSON:", errorData); // Log error JSON
        } catch (e) {
            console.error("[VMDetails] /console API could not parse error JSON:", e);
        }
        throw new Error(errorText);
      }
      const data: ConsoleDetailsData = await response.json();
      
      console.log("[VMDetails] /console API successful response JSON:", JSON.stringify(data, null, 2)); // Log success JSON

      if (data && data.connectionDetails && data.type) { // Verificar 'type' también
        console.log("[VMDetails] Datos de consola válidos recibidos:", data);
        setConsoleDetailsData(data);
      } else {
        console.error("[VMDetails] Respuesta de API para consola no tiene la estructura esperada:", data);
        setConsoleApiError("No se pudieron cargar los detalles de la consola. Respuesta inválida del servidor.");
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
      console.error('[VMDetails] Error en handleOpenConsole:', error);
      setConsoleApiError(`Error al obtener detalles de la consola: ${errorMessage}`);
    } finally {
      setIsLoadingConsole(false);
      console.log("[VMDetails] handleOpenConsole finished."); // Log fin
    }
  };

  const handleVMAction = async (action: 'start' | 'stop' | 'restart') => {
    if (!vmId) return;
    const toastId = toast.loading(`Ejecutando acción: ${action}...`);
    try {
      const response = await fetch(`${API_BASE_URL}/vms/${vmId}/action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ action }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.details || data.error || `Error al ejecutar acción ${action}`);
      }
      toast.success(`Acción '${action}' iniciada para ${vmDetails?.name || vmId}.`, { id: toastId });
      // Optionally refresh VM details after a short delay to reflect status change
      setTimeout(fetchVMDetails, 3000);
    } catch (err) {
      console.error(`Error performing action ${action}:`, err);
      toast.error(err instanceof Error ? err.message : `Error al ejecutar ${action}.`, { id: toastId });
    }
  };

  if (isLoading && !vmDetails) {
    return <div className="p-6 text-center">Cargando detalles de la Máquina Virtual...</div>;
  }

  if (error) {
    return <div className="p-6 text-center text-red-500">Error: {error}</div>;
  }

  if (!vmDetails) {
    return <div className="p-6 text-center">No se encontraron detalles para esta Máquina Virtual.</div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/vms" className="btn btn-secondary btn-sm">
          <ChevronLeft className="h-4 w-4 mr-1" />
          Volver a VMs
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          {vmDetails.name}
        </h1>
        <div className="flex space-x-2">
          <button onClick={fetchVMDetails} className="btn btn-outline btn-sm" title="Actualizar Detalles">
            <RefreshCw className="h-4 w-4" />
          </button>
          {/* Add Edit button if functionality exists */}
        </div>
      </div>

      {/* VM Actions Bar */}
      <div className="bg-white dark:bg-slate-800 p-4 rounded-lg shadow flex flex-wrap gap-2 justify-center">
        <button onClick={() => handleVMAction('start')} className="btn btn-success btn-sm" disabled={vmDetails.status === 'running'}>
          <Play className="h-4 w-4 mr-2" /> Iniciar
        </button>
        <button onClick={() => handleVMAction('stop')} className="btn btn-danger btn-sm" disabled={vmDetails.status !== 'running'}>
          <StopCircle className="h-4 w-4 mr-2" /> Detener
        </button>
        <button onClick={() => handleVMAction('restart')} className="btn btn-warning btn-sm" disabled={vmDetails.status !== 'running'}>
          <RotateCcw className="h-4 w-4 mr-2" /> Reiniciar
        </button>
        <button onClick={handleOpenConsole} className="btn btn-primary btn-sm" disabled={isLoadingConsole}>
          <Terminal className="h-4 w-4 mr-2" /> {isLoadingConsole ? 'Cargando...' : 'Consola'}
        </button>
      </div>

      {/* Main Details Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Column 1: Basic Info & Specs */}
        <div className="md:col-span-1 space-y-6">
          <div className="card">
            <div className="card-body">
              <h2 className="card-title"><Info className="h-5 w-5 mr-2" />Información General</h2>
              <p><strong>ID:</strong> {vmDetails.id}</p>
              <p><strong>Estado:</strong> <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                vmDetails.status === 'running' ? 'bg-success-100 text-success-700 dark:bg-success-700 dark:text-success-100' :
                vmDetails.status === 'stopped' ? 'bg-slate-200 text-slate-700 dark:bg-slate-600 dark:text-slate-200' :
                'bg-warning-100 text-warning-700 dark:bg-warning-700 dark:text-warning-100'
              }`}>{vmDetails.status}</span></p>
              <p><strong>Hipervisor:</strong> {vmDetails.hypervisorType} ({vmDetails.hypervisorId.substring(0,8)}...)</p>
              {vmDetails.nodeName && <p><strong>Nodo:</strong> {vmDetails.nodeName}</p>}
              {vmDetails.ipAddress && <p><strong>IP Principal:</strong> {vmDetails.ipAddress}</p>}
              {vmDetails.ipAddresses && vmDetails.ipAddresses.length > 1 && (
                <div><strong>Otras IPs:</strong> {vmDetails.ipAddresses.filter(ip => ip !== vmDetails.ipAddress).join(', ')}</div>
              )}
              {vmDetails.description && <p><strong>Descripción:</strong> {vmDetails.description}</p>}
              <p><strong>Creada:</strong> {new Date(vmDetails.createdAt).toLocaleString()}</p>
            </div>
          </div>

          <div className="card">
            <div className="card-body">
              <h2 className="card-title"><Settings className="h-5 w-5 mr-2" />Especificaciones</h2>
              <p><strong>CPU:</strong> {vmDetails.specs.cpu} cores</p>
              <p><strong>Memoria:</strong> {vmDetails.specs.memory} MB</p>
              <p><strong>Disco:</strong> {vmDetails.specs.disk} GB</p>
              {vmDetails.specs.os && <p><strong>SO:</strong> {vmDetails.specs.os}</p>}
            </div>
          </div>
        </div>

        {/* Column 2 & 3: Metrics & Other Details (e.g., Network, Disks) */}
        <div className="md:col-span-2 space-y-6">
          <div className="card">
            <div className="card-body">
              <h2 className="card-title"><BarChart2 className="h-5 w-5 mr-2" />Métricas en Tiempo Real</h2>
              {metrics ? (
                <div className="grid grid-cols-2 gap-4">
                  <div><strong>Uso CPU:</strong> {metrics.cpu.toFixed(2)}%</div>
                  <div><strong>Uso Memoria:</strong> {metrics.memory.toFixed(2)}%</div>
                  <div><strong>Red (Entrada):</strong> {(metrics.network.in / 1024).toFixed(2)} KB/s</div>
                  <div><strong>Red (Salida):</strong> {(metrics.network.out / 1024).toFixed(2)} KB/s</div>
                  <div><strong>Uptime:</strong> {Math.floor(metrics.uptime / 3600)}h {Math.floor((metrics.uptime % 3600) / 60)}m</div>
                </div>
              ) : (
                <p>Cargando métricas...</p>
              )}
            </div>
          </div>
          {/* Aquí podrías añadir más cards para detalles de red, discos, snapshots, etc. */}
        </div>
      </div>

      {/* Modal de Consola */}
      {showConsoleModal && (
        <VMConsoleView
          consoleDetails={consoleDetailsData} // Puede ser null inicialmente, VMConsoleView lo maneja
          onClose={() => {
            setShowConsoleModal(false);
            setConsoleDetailsData(null); // Limpiar datos al cerrar
          }}
          onError={(message) => {
            console.error("Error desde VMConsoleView:", message);
            toast.error(`Error en la consola: ${message}`);
            // Opcional: cerrar el modal si el error es crítico
            // setShowConsoleModal(false); 
            // setConsoleDetailsData(null);
          }}
        />
      )}
      {/* Mostrar error si la API de consola falló y no hay datos */}
      {showConsoleModal && consoleApiError && !consoleDetailsData && (
         <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-[100]">
            <div className="bg-slate-800 p-6 rounded-lg text-white">
                <p className="text-red-400 mb-3">{consoleApiError}</p>
                <button 
                  onClick={() => {
                    setShowConsoleModal(false);
                    setConsoleApiError(null);
                  }} 
                  className="btn btn-secondary btn-sm"
                >
                  Cerrar
                </button>
            </div>
        </div>
      )}
    </div>
  );
}
      