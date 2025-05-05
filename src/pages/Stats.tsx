import { useState, useEffect, useCallback } from 'react';
import { BarChart, Calendar } from 'lucide-react';
import { toast } from 'react-hot-toast';

const API_BASE_URL = 'http://localhost:3001/api'; // Asegúrate que sea la URL correcta de tu API

// Define una interfaz para la respuesta esperada de la API
interface VMCreationStats {
  count: number;
  startDate: string;
  endDate: string;
  // Podrías añadir más detalles si la API los devuelve, como datos por día para un gráfico
  // dailyCounts?: { date: string; count: number }[];
}

export default function StatsPage() {
  const today = new Date().toISOString().split('T')[0]; // Formato YYYY-MM-DD
  const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const [startDate, setStartDate] = useState<string>(oneMonthAgo);
  const [endDate, setEndDate] = useState<string>(today);
  const [stats, setStats] = useState<VMCreationStats | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setStats(null); // Limpia estadísticas anteriores
    const token = localStorage.getItem('authToken');

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
          ...(token && { 'Authorization': `Bearer ${token}` }),
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
  }, [startDate, endDate]); // Depende de las fechas seleccionadas

  // Opcional: Cargar estadísticas iniciales al montar el componente
  // useEffect(() => {
  //   fetchStats();
  // }, [fetchStats]); // fetchStats está envuelto en useCallback

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
          {/* Aquí podrías añadir un gráfico si la API devuelve datos diarios */}
          {/* Ejemplo: <BarChart data={stats.dailyCounts} /> */}
        </div>
      )}
       {!stats && !isLoading && !error && (
         <div className="text-center p-4 text-slate-500 dark:text-slate-400">
           Selecciona un rango de fechas y haz clic en 'Consultar' para ver las estadísticas.
         </div>
       )}
    </div>
  );
}