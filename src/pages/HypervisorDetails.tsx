import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Cloud, Server as ServersIcon, Clock, AlertCircle, Cpu, MemoryStick, Database, Layers } from 'lucide-react';
import { Hypervisor } from '../types/hypervisor'; // Import the updated Hypervisor type
import { toast } from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';
import { formatBytes } from '../utils/formatters'; // Assuming you have this utility

const API_BASE_URL = 'http://localhost:3001/api';

export default function HypervisorDetails() {
  const { id } = useParams<{ id: string }>(); // Get ID from URL
  const [hypervisor, setHypervisor] = useState<Hypervisor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchHypervisorDetails = async () => {
      if (!id) return; // Should not happen with the route setup

      setLoading(true);
      setError(null);
      const token = localStorage.getItem('authToken');

      try {
        const response = await fetch(`${API_BASE_URL}/hypervisors/${id}`, {
          headers: {
            ...(token && { 'Authorization': `Bearer ${token}` }),
          },
        });

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Hypervisor no encontrado.');
          }
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Error HTTP: ${response.status}`);
        }

        const data: Hypervisor = await response.json();
        // Convert date strings if necessary (backend might already send Date objects)
        setHypervisor({
          ...data,
          lastSync: data.lastSync ? new Date(data.lastSync) : null,
          createdAt: data.createdAt ? new Date(data.createdAt) : undefined,
          updatedAt: data.updatedAt ? new Date(data.updatedAt) : undefined,
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
  }, [id]); // Re-fetch if ID changes

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

  // Calculate aggregated stats (similar to the card, but using data from the fetched hypervisor object)
  const calculateAggregatedStats = () => {
    const onlineNodes = hypervisor.nodes?.filter(n => n.status === 'online') || [];
    const totalCores = onlineNodes.reduce((sum, node) => sum + (node.cpu?.cores || 0), 0);
    const totalWeightedUsage = onlineNodes.reduce((sum, node) => sum + ((node.cpu?.usage || 0) * (node.cpu?.cores || 0)), 0);
    const avgCpuUsage = totalCores > 0 ? (totalWeightedUsage / totalCores) * 100 : 0;
    const totalMemory = onlineNodes.reduce((sum, node) => sum + (node.memory?.total || 0), 0);
    const usedMemory = onlineNodes.reduce((sum, node) => sum + (node.memory?.used || 0), 0);
    const totalDisk = hypervisor.storage?.reduce((sum, s) => sum + (s.size || 0), 0) || 0;
    const usedDisk = hypervisor.storage?.reduce((sum, s) => sum + (s.used || 0), 0) || 0;
    return { totalCores, avgCpuUsage, totalMemory, usedMemory, totalDisk, usedDisk };
  };
  const stats = calculateAggregatedStats();

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <Link to="/hypervisors" className="inline-flex items-center text-sm text-primary-600 dark:text-primary-400 hover:underline mb-2">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Volver a Hypervisores
        </Link>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {hypervisor.type === 'proxmox' ? <ServersIcon className="h-8 w-8 text-orange-500" /> : <Cloud className="h-8 w-8 text-blue-500" />}
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{hypervisor.name || hypervisor.host}</h1>
              <p className="text-slate-500 dark:text-slate-400">{hypervisor.host} ({hypervisor.type})</p>
            </div>
          </div>
          {renderStatusBadge(hypervisor.status)}
        </div>
        <div className="mt-2 flex items-center space-x-4 text-sm text-slate-500 dark:text-slate-400">
          {hypervisor.lastSync && (
            <span className="flex items-center"><Clock className="h-4 w-4 mr-1" /> Sincronizado {formatDistanceToNow(hypervisor.lastSync, { addSuffix: true })}</span>
          )}
          {hypervisor.status === 'error' && (
            <span className="flex items-center text-danger-500"><AlertCircle className="h-4 w-4 mr-1" /> Error de conexión</span>
          )}
        </div>
      </div>

      {/* Details Section */}
      <div className="bg-white dark:bg-slate-800 shadow rounded-lg border border-slate-200 dark:border-slate-700 p-6">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Detalles del Recurso</h2>
        {hypervisor.status === 'connected' && hypervisor.nodes && hypervisor.storage && hypervisor.templates ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
            {/* Nodes Summary */}
            <div>
              <h3 className="font-medium text-slate-700 dark:text-slate-300 mb-2 flex items-center"><ServersIcon className="h-4 w-4 mr-2"/>Nodos ({hypervisor.nodes.length})</h3>
              <ul className="list-disc list-inside space-y-1 text-slate-600 dark:text-slate-400">
                {hypervisor.nodes.map(node => (
                  <li key={node.id}>{node.name} ({node.status})</li>
                ))}
              </ul>
            </div>
            {/* Aggregated Stats */}
            <div className="space-y-2">
               <h3 className="font-medium text-slate-700 dark:text-slate-300 mb-2">Recursos Agregados</h3>
               <p className="flex items-center"><Cpu className="h-4 w-4 mr-2 text-blue-500"/> CPU: {stats.avgCpuUsage.toFixed(1)}% usada ({stats.totalCores} Núcleos)</p>
               <p className="flex items-center"><MemoryStick className="h-4 w-4 mr-2 text-green-500"/> Memoria: {formatBytes(stats.usedMemory)} / {formatBytes(stats.totalMemory)} usada</p>
               <p className="flex items-center"><Database className="h-4 w-4 mr-2 text-purple-500"/> Disco: {formatBytes(stats.usedDisk)} / {formatBytes(stats.totalDisk)} usado ({hypervisor.storage.length} Pools)</p>
            </div>
             {/* Storage Pools */}
             <div>
              <h3 className="font-medium text-slate-700 dark:text-slate-300 mb-2 flex items-center"><Database className="h-4 w-4 mr-2"/>Almacenamiento ({hypervisor.storage.length})</h3>
              <ul className="list-disc list-inside space-y-1 text-slate-600 dark:text-slate-400">
                {hypervisor.storage.map(s => (
                  <li key={s.id}>{s.name} ({s.type}) - {formatBytes(s.used)} / {formatBytes(s.size)}</li>
                ))}
              </ul>
            </div>
            {/* Templates/ISOs */}
            <div>
              <h3 className="font-medium text-slate-700 dark:text-slate-300 mb-2 flex items-center"><Layers className="h-4 w-4 mr-2"/>Plantillas/ISOs ({hypervisor.templates.length})</h3>
              <ul className="list-disc list-inside space-y-1 text-slate-600 dark:text-slate-400">
                {hypervisor.templates.slice(0, 5).map(t => ( // Show first 5 for brevity
                  <li key={t.id}>{t.name} ({formatBytes(t.size)})</li>
                ))}
                {hypervisor.templates.length > 5 && <li>... y {hypervisor.templates.length - 5} más</li>}
              </ul>
            </div>
          </div>
        ) : (
          <p className="text-slate-500 dark:text-slate-400">
            {hypervisor.status === 'connected' ? 'Cargando detalles...' : 'Los detalles solo están disponibles cuando el hypervisor está conectado.'}
          </p>
        )}
      </div>
    </div>
  );
}