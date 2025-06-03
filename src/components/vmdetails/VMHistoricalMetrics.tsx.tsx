import React, { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { toast } from 'react-hot-toast';
import { formatBytes } from '../../utils/formatters'; // Assuming you have this utility
import { Activity, RefreshCw } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

interface HistoricalDataPoint {
  time: number; // Milliseconds timestamp
  cpuUsagePercent?: number;
  memoryUsagePercent?: number;
  memoryUsageBytes?: number;
  diskReadBps?: number;
  diskWriteBps?: number;
  netInBps?: number;
  netOutBps?: number;
}

interface VMHistoricalMetricsProps {
  vmId: string;
  nodeName: string; // Required for Proxmox
  hypervisorType: 'proxmox' | 'vsphere'; // To potentially extend later
  authToken: string | null;
}

const timeframes = [
  { value: 'hour', label: 'Última Hora' },
  { value: 'day', label: 'Últimas 24 Horas' },
  { value: 'week', label: 'Últimos 7 Días' },
  { value: 'month', label: 'Últimos 30 Días' },
  // { value: 'year', label: 'Last Year' }, // Year can be very data-intensive
];

const VMHistoricalMetrics: React.FC<VMHistoricalMetricsProps> = ({ vmId, nodeName, hypervisorType, authToken }) => {
  const [metricsData, setMetricsData] = useState<HistoricalDataPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTimeframe, setSelectedTimeframe] = useState('hour');

  const fetchHistoricalMetrics = useCallback(async () => {
    if (!authToken || !vmId || (hypervisorType === 'proxmox' && !nodeName)) {
      // Don't fetch if essential props are missing, though parent should ensure they are passed
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/vms/${vmId}/historical-metrics?timeframe=${selectedTimeframe}&node=${nodeName}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Error desconocido del servidor' }));
        throw new Error(errorData.message || `Error HTTP: ${response.status}`);
      }
      const data: HistoricalDataPoint[] = await response.json();
      setMetricsData(data);
    } catch (error: any) {
      console.error('Error fetching historical metrics:', error);
      toast.error(`No se pudieron cargar las métricas históricas: ${error.message}`);
      setMetricsData([]); // Clear data on error
    } finally {
      setLoading(false);
    }
  }, [vmId, nodeName, hypervisorType, authToken, selectedTimeframe]);

  useEffect(() => {
    if (hypervisorType === 'proxmox') { // Initially, only fetch for Proxmox
      fetchHistoricalMetrics();
    } else {
      setMetricsData([]); // Clear data for unsupported types for now
    }
  }, [fetchHistoricalMetrics, hypervisorType]);

  const formatXAxis = (tickItem: number) => {
    const date = new Date(tickItem);
    if (selectedTimeframe === 'hour') return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (selectedTimeframe === 'day') return date.toLocaleTimeString([], { day: 'numeric', month:'short', hour: '2-digit', minute: '2-digit' });
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  if (hypervisorType !== 'proxmox') {
    return (
      <div className="p-4 text-sm text-slate-500 dark:text-slate-400">
        Las métricas históricas aún no están implementadas para {hypervisorType}.
      </div>
    );
  }

  return (
    <div className="border-t border-slate-200 dark:border-slate-700 p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex items-center">
          <Activity className="w-6 h-6 mr-2 text-primary-600" />
          Métricas Históricas
        </h3>
        <div className="flex items-center space-x-2">
          <select
            value={selectedTimeframe}
            onChange={(e) => setSelectedTimeframe(e.target.value)}
            className="form-select form-select-sm"
            disabled={loading}
          >
            {timeframes.map(tf => (
              <option key={tf.value} value={tf.value}>{tf.label}</option>
            ))}
          </select>
          <button onClick={fetchHistoricalMetrics} className="btn btn-sm btn-secondary" disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {loading && <div className="text-center py-8">Cargando datos históricos...</div>}
      {!loading && metricsData.length === 0 && <div className="text-center py-8 text-slate-500 dark:text-slate-400">No hay datos históricos disponibles para el período seleccionado.</div>}
      
      {!loading && metricsData.length > 0 && (
        <div className="space-y-8">
          {/* Memory Usage Chart */}
          <div>
            <h4 className="text-md font-medium text-slate-700 dark:text-slate-200 mb-2">Uso de Memoria (%)</h4>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={metricsData} margin={{ top: 5, right: 20, left: -15, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                <XAxis dataKey="time" tickFormatter={formatXAxis} tick={{ fontSize: 10 }} />
                <YAxis unit="%" domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Tooltip
                  formatter={(value: number) => [`${value.toFixed(1)}%`, "Memoria"]}
                  labelFormatter={(label: number) => new Date(label).toLocaleString()}
                  contentStyle={{ backgroundColor: 'rgba(30, 41, 59, 0.8)', borderColor: 'rgba(71, 85, 105, 0.8)', borderRadius: '0.375rem' }}
                  itemStyle={{ color: '#cbd5e1' }}
                  labelStyle={{ color: '#f1f5f9', fontWeight: 'bold' }}
                />
                <Legend wrapperStyle={{fontSize: "12px"}}/>
                <Line type="monotone" dataKey="memoryUsagePercent" name="Uso Memoria" stroke="#8884d8" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* CPU Usage Chart (Example - add more charts similarly) */}
          <div>
            <h4 className="text-md font-medium text-slate-700 dark:text-slate-200 mb-2">Uso de CPU (%)</h4>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={metricsData} margin={{ top: 5, right: 20, left: -15, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                <XAxis dataKey="time" tickFormatter={formatXAxis} tick={{ fontSize: 10 }} />
                <YAxis unit="%" domain={[0, 'auto']} tick={{ fontSize: 10 }} />
                <Tooltip
                  formatter={(value: number) => [`${value.toFixed(1)}%`, "CPU"]}
                  labelFormatter={(label: number) => new Date(label).toLocaleString()}
                  contentStyle={{ backgroundColor: 'rgba(30, 41, 59, 0.8)', borderColor: 'rgba(71, 85, 105, 0.8)', borderRadius: '0.375rem' }}
                  itemStyle={{ color: '#cbd5e1' }}
                  labelStyle={{ color: '#f1f5f9', fontWeight: 'bold' }}
                />
                <Legend wrapperStyle={{fontSize: "12px"}}/>
                <Line type="monotone" dataKey="cpuUsagePercent" name="Uso CPU" stroke="#82ca9d" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* TODO: Add charts for Disk I/O and Network I/O similarly */}

        </div>
      )}
    </div>
  );
};

export default VMHistoricalMetrics;