import { useState, useEffect, useCallback } from 'react';
import { Calendar, Users, Server, ChevronLeft, ChevronRight } from 'lucide-react'; // Added Users, Server, Chevrons
import { toast } from 'react-hot-toast';
import {
  LineChart, // Changed from BarChart
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,    // Optional: if you want a legend
} from 'recharts';
import { BarChart, Bar } from 'recharts'; // Import BarChart and Bar for the new chart type

import { Link } from 'react-router-dom'; // Import Link from react-router-dom
import { FinalClient } from '../types/client'; // Import FinalClient type
import { VM } from '../types/vm'; // Import VM type
import { useAuth } from '../hooks/useAuth'; // Import useAuth

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL; // Read from .env

// Define una interfaz para la respuesta esperada de la API
interface VMCreationStats {
  count: number;
  startDate: string;
  endDate: string;
  dailyCounts?: {
    date: string;
    proxmox: number;
    vsphere: number;
    total: number; // Keep total if you still want to show it or use it
  }[] | null;
}

export default function StatsPage() {
  const today = new Date().toISOString().split('T')[0]; // Formato YYYY-MM-DD
  const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const [startDate, setStartDate] = useState<string>(oneMonthAgo);
  const [endDate, setEndDate] = useState<string>(today);
  const [stats, setStats] = useState<VMCreationStats | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // State for Client VMs section
  const [finalClients, setFinalClients] = useState<FinalClient[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [clientVms, setClientVms] = useState<VM[]>([]);
  const [clientVmsPagination, setClientVmsPagination] = useState<{ currentPage: number, totalPages: number, totalItems: number, limit: number } | null>(null);
  const [isFetchingClients, setIsFetchingClients] = useState<boolean>(true);
  const [isFetchingClientVms, setIsFetchingClientVms] = useState<boolean>(false);
  const { token: authToken } = useAuth(); // Get token from context

  const fetchStats = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setStats(null); // Limpia estadísticas anteriores
    if (!authToken) {
      toast.error("Token de autenticación no encontrado.");
      setIsLoading(false); return;
    }

    // Verificar si API_BASE_URL está definida
    if (!API_BASE_URL) {
      toast.error("La URL base de la API no está configurada. Por favor, contacte al administrador.");
      setError("La URL base de la API no está configurada.");
      setIsLoading(false);
      return;
    }

    // Validar fechas
    if (!startDate || !endDate || new Date(startDate) > new Date(endDate)) {
      toast.error('Por favor selecciona un rango de fechas válido.');
      setIsLoading(false);
      return;
    }

    try {
      // Construye la URL con parámetros de consulta para las fechas
      const url = new URL(`${API_BASE_URL}/stats/vm-creation-count`);
      url.searchParams.append('startDate', startDate);
      url.searchParams.append('endDate', endDate);

      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Error desconocido del servidor' }));
        throw new Error(errorData.message || `Error HTTP: ${response.status}`);
      }

      const data: VMCreationStats = await response.json();
      setStats(data);

    } catch (err: unknown) {
      console.error('Error fetching VM creation stats:', err);
      const message = err instanceof Error ? err.message : 'Ocurrió un error inesperado.';
      setError(message);
      toast.error(`No se pudieron cargar las estadísticas: ${message}`);
    } finally {
      setIsLoading(false);
    }
  }, [startDate, endDate, authToken]); // Depende de las fechas seleccionadas

  // Opcional: Cargar estadísticas iniciales al montar el componente
   useEffect(() => {
     fetchStats();
   }, [fetchStats]); // fetchStats está envuelto en useCallback

  // Fetch Final Clients
  useEffect(() => {
    const fetchClients = async () => {
      if (!authToken) {
        setIsFetchingClients(false); return;
      }
      setIsFetchingClients(true);
      //const token = localStorage.getItem('authToken');
      try {
        const response = await fetch(`${API_BASE_URL}/final-clients?limit=1000`, { // Fetch a large number for dropdown
          headers: { 'Authorization': `Bearer ${authToken}` },
        });
        if (!response.ok) throw new Error('Failed to fetch final clients');
        const data = await response.json();
        setFinalClients(data.items || []);
      } catch (err) {
        console.error('Error fetching final clients for stats:', err);
        toast.error('No se pudieron cargar los clientes finales.');
      } finally {
        setIsFetchingClients(false);
      }
    };
    fetchClients();
  }, [authToken]);

  // Fetch VMs for selected client
  const fetchClientVms = useCallback(async (clientId: string, page = 1) => {
    if (!clientId) {
      setClientVms([]);
      setClientVmsPagination(null);
      return;
    }
    if (!authToken) {
      toast.error("Token de autenticación no encontrado.");
      return;
    }
    setIsFetchingClientVms(true);
    try {
      const response = await fetch(`${API_BASE_URL}/stats/client-vms/${clientId}?page=${page}&limit=5`, {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Error desconocido del servidor' }));
        throw new Error(errorData.message || `Error HTTP: ${response.status}`);
      }
      const data = await response.json();
      setClientVms(data.items || []);
      setClientVmsPagination(data.pagination || null);
    } catch (err: unknown) {
      console.error(`Error fetching VMs for client ${clientId}:`, err);
      const message = err instanceof Error ? err.message : 'Ocurrió un error inesperado.';
      toast.error(`No se pudieron cargar las VMs del cliente: ${message}`);
      setClientVms([]);
      setClientVmsPagination(null);
    } finally {
      setIsFetchingClientVms(false);
    }
  }, [authToken]);

  useEffect(() => {
    if (selectedClientId) {
      fetchClientVms(selectedClientId, 1); // Fetch first page when client changes
    }
  }, [selectedClientId, fetchClientVms]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Estadísticas de Creación de VMs</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1">
          Visualiza cuántas máquinas virtuales se crearon en un período específico.
        </p>
      </div>

      <div className="bg-white dark:bg-slate-800 shadow rounded-lg border border-slate-200 dark:border-slate-700 p-6 mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="startDate" className="form-label">Fecha de Inicio</label>
            <input
              type="date"
              id="startDate"
              className="form-input"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              max={today} // No permitir fechas futuras
            />
          </div>
          <div>
            <label htmlFor="endDate" className="form-label">Fecha de Fin</label>
            <input
              type="date"
              id="endDate"
              className="form-input"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              max={today} // No permitir fechas futuras
            />
          </div>
          <button onClick={fetchStats} className="btn btn-primary" disabled={isLoading}>
            {isLoading ? 'Cargando...' : <><Calendar className="h-4 w-4 mr-2" /> Consultar</>}
          </button>
        </div>
      </div>

      {isLoading && <div className="text-center p-4">Cargando estadísticas...</div>}
      {error && <div className="text-center p-4 text-red-600 dark:text-red-400">Error: {error}</div>}
      {stats && !isLoading && !error && (
        <div className="bg-white dark:bg-slate-800 shadow rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-4">Resultados</h2>
          <p className="text-slate-600 dark:text-slate-300">
            Entre <span className="font-semibold">{new Date(stats.startDate + 'T00:00:00').toLocaleDateString()}</span> y <span className="font-semibold">{new Date(stats.endDate + 'T00:00:00').toLocaleDateString()}</span>, se crearon:
          </p>
          <p className="text-4xl font-bold text-primary-600 dark:text-primary-400 mt-2">{stats.count}</p>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">máquinas virtuales.</p>

          {/* Gráfico de Barras si hay datos diarios */}
          {stats.dailyCounts && stats.dailyCounts.length > 0 ? (
            <div className="mt-8">
              <h3 className="text-md font-medium text-slate-900 dark:text-white mb-4">Creaciones por Día</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={stats.dailyCounts}
                  margin={{ top: 5, right: 20, left: -10, bottom: 5 }} // Ajusta márgenes si es necesario
                >
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(30, 41, 59, 0.8)', // bg-slate-800 with opacity
                      borderColor: 'rgba(71, 85, 105, 0.8)', // border-slate-600 with opacity
                      borderRadius: '0.375rem' // rounded-md
                    }}
                    itemStyle={{ color: '#cbd5e1' }} // text-slate-300
                    labelStyle={{ color: '#f1f5f9', fontWeight: 'bold' }} // text-slate-100
                  />
                  <Legend />
                  {/* <Bar dataKey="total" fill="var(--color-primary-500)" name="Total VMs" /> */}
                  <Bar dataKey="proxmox" stackId="a" fill="var(--color-orange-500)" name="Proxmox" /> {/* Ejemplo: Verde para Proxmox */}
                  <Bar dataKey="vsphere" stackId="a" fill="var(--color-blue-500)" name="vSphere" /> {/* Ejemplo: Morado para vSphere */}
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : null} {/* Explicitly return null if condition is false */}

        </div>
      )}
       {!stats && !isLoading && !error && (
         <div className="text-center p-4 text-slate-500 dark:text-slate-400">
           Selecciona un rango de fechas y haz clic en 'Consultar' para ver las estadísticas.
         </div>
       )}

      {/* VMs por Cliente Final Section */}
      <div className="mt-10">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center">
            <Users className="h-6 w-6 mr-2 text-primary-600 dark:text-primary-400" />
            Máquinas Virtuales por Cliente Final
          </h2>
          <p className="text-slate-500 dark:text-slate-400 mt-1">
            Selecciona un cliente para ver sus máquinas virtuales asociadas.
          </p>
        </div>

        <div className="bg-white dark:bg-slate-800 shadow rounded-lg border border-slate-200 dark:border-slate-700 p-6">
          <div>
            <label htmlFor="finalClientSelect" className="form-label">Seleccionar Cliente Final</label>
            <select
              id="finalClientSelect"
              className="form-select"
              value={selectedClientId}
              onChange={(e) => setSelectedClientId(e.target.value)}
              disabled={isFetchingClients}
            >
              <option value="">{isFetchingClients ? 'Cargando clientes...' : 'Selecciona un cliente'}</option>
              {finalClients.map(client => (
                <option key={client.id} value={client.id}>{client.name} ({client.rif})</option>
              ))}
            </select>
          </div>

          {isFetchingClientVms && <div className="text-center p-4 mt-4">Cargando VMs del cliente...</div>}
          
          {!isFetchingClientVms && selectedClientId && clientVms.length === 0 && (
            <p className="text-slate-500 dark:text-slate-400 mt-4 text-center">Este cliente no tiene máquinas virtuales registradas.</p>
          )}

          {!isFetchingClientVms && clientVms.length > 0 && (
            <div className="mt-6">
              <ul className="space-y-3">
                {clientVms.map(vm => (
                  <li key={vm.id} className="p-3 bg-slate-50 dark:bg-slate-700/50 rounded-md border border-slate-200 dark:border-slate-600 hover:shadow-sm transition-shadow">
                    <Link to={`/vm/${vm.id}`} className="block group">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center">
                          <Server className="h-5 w-5 mr-2 text-primary-500 group-hover:text-primary-600" />
                          <span className="font-medium text-slate-800 dark:text-slate-100 group-hover:text-primary-600 dark:group-hover:text-primary-400">{vm.name}</span>
                        </div>
                        <span className={`px-2 py-0.5 text-xs rounded-full ${vm.status === 'running' ? 'bg-success-100 text-success-700 dark:bg-success-800 dark:text-success-200' : 'bg-slate-100 text-slate-600 dark:bg-slate-600 dark:text-slate-200'}`}>
                          {vm.status}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        <span>Hypervisor: {vm.hypervisorType}</span> | <span>Creada: {new Date(vm.createdAt).toLocaleDateString()}</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
              {/* Pagination for Client VMs */}
              {clientVmsPagination && clientVmsPagination.totalPages > 1 && (
                <div className="mt-6 flex justify-center items-center space-x-2">
                  <button
                    onClick={() => fetchClientVms(selectedClientId, clientVmsPagination.currentPage - 1)}
                    disabled={clientVmsPagination.currentPage === 1 || isFetchingClientVms}
                    className="btn btn-sm btn-outline p-1.5"
                  ><ChevronLeft className="h-4 w-4" /></button>
                  <span className="text-sm text-slate-600 dark:text-slate-300">Página {clientVmsPagination.currentPage} de {clientVmsPagination.totalPages}</span>
                  <button
                    onClick={() => fetchClientVms(selectedClientId, clientVmsPagination.currentPage + 1)}
                    disabled={clientVmsPagination.currentPage === clientVmsPagination.totalPages || isFetchingClientVms}
                    className="btn btn-sm btn-outline p-1.5"
                  ><ChevronRight className="h-4 w-4" /></button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
