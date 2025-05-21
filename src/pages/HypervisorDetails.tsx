import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Cloud, Server as ServersIconLucide, Clock, AlertCircle, Cpu, MemoryStick, Database, Layers, Calculator, HardDrive, Activity, Box, Power, WifiOff, CheckCircle, AlertTriangle, Users, ExternalLink } from 'lucide-react'; // Added ExternalLink
import { Hypervisor, AggregatedStats } from '../types/hypervisor'; // Import AggregatedStats, removed HypervisorDetailsData
import { toast } from 'react-hot-toast';
// import { formatDistanceToNow } from 'date-fns'; // Removed unused import
import { formatBytes } from '../utils/formatters'; // Assuming you have this utility
import { useAuth } from '../hooks/useAuth'; // Import useAuth

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;


export default function HypervisorDetails() {
  const { id } = useParams<{ id: string }>(); // Get ID from URL
  const [hypervisor, setHypervisor] = useState<Hypervisor | null>(null); // <-- Use Hypervisor type
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { token: authToken } = useAuth(); // Get token from context

  useEffect(() => {
    const fetchHypervisorDetails = async () => {
      if (!id) return; // Should not happen with the route setup

      setLoading(true);
      setError(null);
      //const token = localStorage.getItem('authToken');

      try {
        const response = await fetch(`${API_BASE_URL}/hypervisors/${id}`, {
          headers: {
            ...(authToken && { 'Authorization': `Bearer ${authToken}` }),
          },
        });

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Hypervisor no encontrado.');
          }
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Error HTTP: ${response.status}`);
        }

        const data: Hypervisor = await response.json(); // Use the Hypervisor type
        // Convert date strings if necessary
        setHypervisor({
          ...data,
          // Ensure these fields exist on HypervisorDetailsData if needed, or handle potential undefined
          last_sync: data.last_sync ? data.last_sync : null, // Keep as string from API
          created_at: data.created_at ? data.created_at : undefined,
          updated_at: data.updated_at ? data.updated_at : undefined,
        });

      } catch (err: unknown) {
        console.error('Error fetching hypervisor details:', err);
        const message = err instanceof Error ? err.message : 'Ocurrió un error desconocido.';
        setError(message);
        toast.error(`Error al cargar detalles: ${message}`);
        setHypervisor(null);
      } finally {
        setLoading(false);
      }
    };

    fetchHypervisorDetails();
  }, [id, authToken]); // Re-fetch if ID changes

  // Helper to render status badge
  const renderStatusBadge = (status: Hypervisor['status']) => {
    let colorClasses = 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200';
    let text = 'Desconocido';
    if (status === 'connected') {
      colorClasses = 'bg-success-100 text-success-800 dark:bg-success-900 dark:text-success-200';
      text = 'Conectado';
    } else if (status === 'disconnected') {
      colorClasses = 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200';
      text = 'Desconectado';
    } else if (status === 'error') {
      colorClasses = 'bg-danger-100 text-danger-800 dark:bg-danger-900 dark:text-danger-200';
      text = 'Error';
    }
    return <span className={`inline-flex items-center px-3 py-0.5 rounded-full text-xs font-medium ${colorClasses}`}>{text}</span>;
  };

  if (loading) {
    return <div className="p-6 text-center">Cargando detalles del hypervisor...</div>;
  }

  if (error) {
    return <div className="p-6 text-center text-danger-600">Error: {error}</div>;
  }

  if (!hypervisor) {
    return <div className="p-6 text-center">Hypervisor no encontrado.</div>;
  }

  // Use pre-calculated stats from backend if available (though we removed the display for aggregated)
  const aggregatedStats: AggregatedStats | null | undefined = hypervisor.aggregatedStats;

  // Custom formatDistanceToNow implementation
  function formatDistanceToNow(dateString: string, options: { addSuffix: boolean }): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    let result = '';
    if (diffDays > 0) {
      result = `${diffDays} día${diffDays > 1 ? 's' : ''}`;
    } else if (diffHours > 0) {
      result = `${diffHours} hora${diffHours > 1 ? 's' : ''}`;
    } else if (diffMinutes > 0) {
      result = `${diffMinutes} minuto${diffMinutes > 1 ? 's' : ''}`;
    } else if (diffSeconds >= 0) { // Handle 0 seconds
      result = `${diffSeconds} segundo${diffSeconds === 1 ? '' : 's'}`;
    } else { // Future date
      result = 'en el futuro';
      if (options.addSuffix) return result; // No "atrás" for future
    }


    if (options.addSuffix && diffMs >= 0) { // Only add "atrás" if it's in the past
      result += ' atrás';
    }

    return result;
  }
  const getNodeStatusIcon = (status: string | undefined, connectionState?: string, powerState?: string) => {
    if (status === 'online') return <CheckCircle className="h-4 w-4 text-success-500" />;
    if (status === 'warning') return <AlertTriangle className="h-4 w-4 text-warning-500" />;
    if (status === 'offline') {
      if (connectionState === 'disconnected' || connectionState === 'notResponding') {
        return <WifiOff className="h-4 w-4 text-slate-500" />;
      }
      if (powerState === 'poweredOff') {
        return <Power className="h-4 w-4 text-slate-500" />;
      }
      return <AlertCircle className="h-4 w-4 text-danger-500" />;
    }
    return <AlertCircle className="h-4 w-4 text-slate-500" />; // Default for unknown
  };

  const getHypervisorManagementUrl = () => {
    if (!hypervisor || !hypervisor.host) return null;

    const hostOnly = hypervisor.host.split(':')[0]; // Remove port if present

    if (hypervisor.type === 'proxmox') {
      // Proxmox typically runs on port 8006 and uses HTTPS
      return `https://${hostOnly}:8006`;
    } else if (hypervisor.type === 'vsphere') {
      // vSphere (vCenter/ESXi) typically uses /ui path and HTTPS
      return `https://${hostOnly}/ui`;
    }
    return null;
  };

  return (
    <div className="p-4 md:p-6">
      {/* Header Section */}
      <div className="mb-6">
        <Link to="/hypervisors" className="inline-flex items-center text-sm text-primary-600 dark:text-primary-400 hover:underline mb-2">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Volver a Hypervisores
        </Link>
        <div className="flex items-center justify-between">
          <div className="flex-grow">
            <div className="flex items-center space-x-3">
              {hypervisor.type === 'proxmox' ? <ServersIconLucide className="h-8 w-8 text-orange-500" /> : <Cloud className="h-8 w-8 text-blue-500" />}
              <div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{hypervisor.name || hypervisor.host}</h1>
                <p className="text-slate-500 dark:text-slate-400">{hypervisor.host} ({hypervisor.type}{hypervisor.vsphere_subtype ? ` - ${hypervisor.vsphere_subtype}` : ''})</p>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end space-y-1">
            {renderStatusBadge(hypervisor.status)}
            {hypervisor.status === 'connected' && getHypervisorManagementUrl() && (
              <a href={getHypervisorManagementUrl()!} target="_blank" rel="noopener noreferrer" className="btn btn-xs btn-outline btn-primary mt-1">
                Ir a {hypervisor.type === 'proxmox' ? 'Proxmox' : 'vSphere'} <ExternalLink className="h-3 w-3 ml-1.5" />
              </a>
            )}
          </div>
        </div>
        {/* Optional: Add back sync time if needed */}
        <div className="mt-2 flex items-center space-x-4 text-sm text-slate-500 dark:text-slate-400">
          {hypervisor.last_sync && (
            <span className="flex items-center"><Clock className="h-4 w-4 mr-1" /> Sincronizado {formatDistanceToNow(hypervisor.last_sync, { addSuffix: true })}</span>
          )}
          {hypervisor.status === 'error' && (
            <span className="flex items-center text-danger-500"><AlertCircle className="h-4 w-4 mr-1" /> Error de conexión</span>
          )}
        </div>
      </div>

      {/* Aggregated Stats Section (if available) */}
      {hypervisor.status === 'connected' && aggregatedStats && (
        <div className="bg-white dark:bg-slate-800 shadow rounded-lg border border-slate-200 dark:border-slate-700 p-6 mb-6">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center">
            <Calculator className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" />
            Estadísticas Agregadas del Cluster/Host
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div className="p-3 bg-slate-50 dark:bg-slate-700/50 rounded-md space-y-1">
              <p className="flex items-center text-slate-500 dark:text-slate-400 mb-1"><Cpu className="h-4 w-4 mr-1.5"/>CPU Total</p>
              <p className="font-semibold text-slate-700 dark:text-slate-200">{aggregatedStats.totalCores} Núcleos</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Uso Promedio: {aggregatedStats.avgCpuUsagePercent.toFixed(1)}%</p>
              {/* CPU Progress Bar */}
              <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-1.5">
                <div
                  className="bg-primary-500 h-1.5 rounded-full"
                  style={{ width: `${aggregatedStats.avgCpuUsagePercent.toFixed(1)}%` }}
                ></div>
              </div>
            </div>
            <div className="p-3 bg-slate-50 dark:bg-slate-700/50 rounded-md space-y-1">
              <p className="flex items-center text-slate-500 dark:text-slate-400 mb-1"><MemoryStick className="h-4 w-4 mr-1.5"/>Memoria Total</p>
              <p className="font-semibold text-slate-700 dark:text-slate-200">{formatBytes(aggregatedStats.totalMemoryBytes)}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Usada: {formatBytes(aggregatedStats.usedMemoryBytes)}</p>
              {/* Memory Progress Bar */}
              {aggregatedStats.totalMemoryBytes > 0 && (
                <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-1.5">
                  <div
                    className="bg-primary-500 h-1.5 rounded-full"
                    style={{ width: `${((aggregatedStats.usedMemoryBytes / aggregatedStats.totalMemoryBytes) * 100).toFixed(1)}%` }}
                  ></div>
                </div>
              )}
            </div>
            <div className="p-3 bg-slate-50 dark:bg-slate-700/50 rounded-md space-y-1">
              <p className="flex items-center text-slate-500 dark:text-slate-400 mb-1"><Database className="h-4 w-4 mr-1.5"/>Almacenamiento Total</p>
              <p className="font-semibold text-slate-700 dark:text-slate-200">{formatBytes(aggregatedStats.totalDiskBytes)}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Usado: {formatBytes(aggregatedStats.usedDiskBytes)} ({aggregatedStats.storagePoolCount} Pools/Datastores)</p>
              {/* Disk Progress Bar */}
              {aggregatedStats.totalDiskBytes > 0 && (
                <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-1.5">
                  <div
                    className="bg-primary-500 h-1.5 rounded-full"
                    style={{ width: `${((aggregatedStats.usedDiskBytes / aggregatedStats.totalDiskBytes) * 100).toFixed(1)}%` }}
                  ></div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Resource Details Section: Nodes/Hosts */}
      <div className="bg-white dark:bg-slate-800 shadow rounded-lg border border-slate-200 dark:border-slate-700 p-6">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-6">
          {hypervisor.type === 'vsphere' ? 'Hosts ESXi' : 'Nodos'}
          {hypervisor.nodes && ` (${hypervisor.nodes.length})`}
        </h2>
        {hypervisor.status === 'connected' && hypervisor.nodes && hypervisor.nodes.length > 0 ? (
          <div className="space-y-6">
            {hypervisor.nodes.map(node => (
              <div key={node.id} className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-lg border border-slate-200 dark:border-slate-600">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center">
                    <ServersIconLucide className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" />
                    {node.name || 'Nombre Desconocido'}
                  </h3>
                  <span className="flex items-center text-sm font-medium">
                    {getNodeStatusIcon(node.status, node.connectionState, node.powerState)}
                    <span className="ml-1.5 capitalize">{node.status}</span>
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-slate-500 dark:text-slate-400">CPU</p>
                    <p className="text-slate-700 dark:text-slate-200">
                      {node.cpu ? `${(node.cpu.usage * 100).toFixed(1)}% de ${node.cpu.cores} Cores` : 'N/A'}
                    </p>
                    {/* Node CPU Progress Bar */}
                    {node.cpu && (
                      <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-1 mt-0.5">
                        <div
                          className="bg-sky-500 h-1 rounded-full"
                          style={{ width: `${(node.cpu.usage * 100).toFixed(1)}%` }}
                        ></div>
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-slate-500 dark:text-slate-400">Memoria</p>
                    <p className="text-slate-700 dark:text-slate-200">
                      {node.memory ? `${formatBytes(node.memory.used)} / ${formatBytes(node.memory.total)}` : 'N/A'}
                    </p>
                    {/* Node Memory Progress Bar */}
                    {node.memory && node.memory.total > 0 && (
                      <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-1 mt-0.5">
                        <div
                          className="bg-sky-500 h-1 rounded-full"
                          style={{ width: `${((node.memory.used / node.memory.total) * 100).toFixed(1)}%` }}
                        ></div>
                      </div>
                    )}
                  </div>
                  {hypervisor.type === 'proxmox' && node.rootfs && (
                    <div>
                      <p className="text-slate-500 dark:text-slate-400">Disco Raíz</p>
                      <p className="text-slate-700 dark:text-slate-200">
                        {`${formatBytes(node.rootfs.used)} / ${formatBytes(node.rootfs.total)}`}
                      </p>
                      {/* Node RootFS Progress Bar */}
                      {node.rootfs.total > 0 && (
                        <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-1 mt-0.5">
                          <div
                            className="bg-sky-500 h-1 rounded-full"
                            style={{ width: `${((node.rootfs.used / node.rootfs.total) * 100).toFixed(1)}%` }}
                          ></div>
                        </div>
                      )}
                    </div>
                  )}
                  {hypervisor.type === 'vsphere' && node.vmCount !== undefined && (
                     <div>
                      <p className="text-slate-500 dark:text-slate-400 flex items-center"><Users className="h-4 w-4 mr-1"/> VMs</p>
                      <p className="text-slate-700 dark:text-slate-200">{node.vmCount}</p>
                    </div>
                  )}
                  {hypervisor.type === 'vsphere' && (
                    <>
                      {node.powerState && <div><p className="text-slate-500 dark:text-slate-400">Estado Energía:</p><p className="text-slate-700 dark:text-slate-200 capitalize">{node.powerState.replace('powered','')}</p></div>}
                      {node.connectionState && <div><p className="text-slate-500 dark:text-slate-400">Estado Conexión:</p><p className="text-slate-700 dark:text-slate-200 capitalize">{node.connectionState}</p></div>}
                    </>
                  )}
                </div>

                {/* Display Physical Disks (Keep this section if NodeResource provides it) */}
                {node.physicalDisks && node.physicalDisks.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-600">
                    <h4 className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Discos Físicos:</h4>
                    <ul className="list-['-_'] list-inside pl-1 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {node.physicalDisks.map(disk => (
                        <li key={disk.devpath} className="flex items-center space-x-1">
                          <HardDrive className="h-3 w-3 flex-shrink-0" />
                          <span>
                            {disk.devpath}: {disk.model || 'Modelo Desconocido'} ({formatBytes(disk.size || 0)}, {disk.type || 'Tipo Desconocido'})
                            {disk.health && ` - ${disk.health}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Per-Node Capacity Prediction (Keep this section if NodeResource provides it) */}
                {node.status === 'online' && node.planCapacityEstimates && node.planCapacityEstimates.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-600 text-xs text-slate-500 dark:text-slate-400">
                      <h4 className="font-medium text-slate-600 dark:text-slate-300 mb-1 flex items-center"><Calculator className="h-3 w-3 mr-1.5"/>Capacidad Estimada:</h4>
                      <ul className="list-['»_'] list-inside space-y-0.5">
                        {node.planCapacityEstimates.map(estimate => (
                          <li key={estimate.planId}>
                            {estimate.planName}: ~<span className="font-semibold text-emerald-600 dark:text-emerald-500">{estimate.estimatedCount}</span> VMs
                          </li>
                        ))}
                      </ul>
                    </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-slate-500 dark:text-slate-400">
            {hypervisor.status === 'connected' 
              ? (hypervisor.nodes && hypervisor.nodes.length === 0 ? 'No se encontraron nodos/hosts.' : 'Cargando nodos/hosts...') 
              : 'Los detalles de nodos/hosts solo están disponibles cuando el hypervisor está conectado.'}
          </p>
        )}
      </div>

      {/* Storage and Templates sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
        {/* Storage Pools */}
        <div className="bg-white dark:bg-slate-800 shadow rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center">
            <Database className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" />
            Almacenamiento
            {hypervisor.storage && ` (${hypervisor.storage.length})`}
          </h2>
          {hypervisor.status === 'connected' && hypervisor.storage && hypervisor.storage.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {hypervisor.storage.map(s => (
                <li key={s.id} className="p-2 bg-slate-50 dark:bg-slate-700/50 rounded-md">
                  <p className="font-medium text-slate-700 dark:text-slate-200">{s.name} <span className="text-xs text-slate-500 dark:text-slate-400">({s.type})</span></p>
                  <p className="text-slate-600 dark:text-slate-300">{formatBytes(s.used)} / {formatBytes(s.size)} usado</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              {hypervisor.status === 'connected' ? 'No hay información de almacenamiento disponible.' : 'Conecte el hypervisor para ver el almacenamiento.'}
            </p>
          )}
        </div>

        {/* Templates/ISOs */}
        {hypervisor.templates && hypervisor.templates.length > 0 && (
          <div className="bg-white dark:bg-slate-800 shadow rounded-lg border border-slate-200 dark:border-slate-700 p-6">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center">
              <Layers className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" />
              Plantillas/ISOs ({hypervisor.templates.length})
            </h2>
            <ul className="space-y-2 text-sm">
              {hypervisor.templates.slice(0, 5).map(t => ( // Show first 5 for brevity
                <li key={t.id} className="p-2 bg-slate-50 dark:bg-slate-700/50 rounded-md text-slate-700 dark:text-slate-200">
                  {t.name} <span className="text-xs text-slate-500 dark:text-slate-400">({formatBytes(t.size)})</span>
                </li>
              ))}
              {hypervisor.templates.length > 5 && <li key="templates-more" className="text-slate-500 dark:text-slate-400 text-xs">... y {hypervisor.templates.length - 5} más</li>}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
