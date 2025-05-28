import React, { useState } from 'react';
import type { VM, PowerAction } from '../../types/vm'; // Ajustado el path y el tipo
import { PlayCircle, StopCircle, RefreshCw, Power, PauseCircle } from 'lucide-react';

interface VMControlsProps {
  vm: VM; // Cambiado a VM
  onAction: (action: PowerAction) => Promise<void>;
}

const VMControls: React.FC<VMControlsProps> = ({ vm, onAction }) => {
  const [loading, setLoading] = useState<PowerAction | null>(null);

  const performAction = async (action: PowerAction) => {
    setLoading(action);
    try {
      await onAction(action);
    } catch (error) {
      console.error(`Failed to ${action} VM:`, error);
      // El manejo de errores (por ejemplo, toasts) se realiza en handleVMAction en VMDetails o podría añadirse aquí.
    } finally {
      setLoading(null);
    }
  };

  // Normalizar el estado para las condiciones (ej. 'suspended' de vSphere vs 'paused' de Proxmox)
  // Tu tipo VMStatus ya incluye 'suspended', así que esta normalización es útil.
  const normalizedStatus = vm.status === 'suspended' ? 'paused' : vm.status;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-4 mt-6">
      <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-4">Acciones de Encendido</h3>
      
      <div className="flex flex-wrap gap-3">
        {/* Botón Start: disponible si no está 'running' ni 'paused' (o 'suspended') */}
        {normalizedStatus !== 'running' && normalizedStatus !== 'paused' && (
          <PowerButton
            label="Start"
            icon={<PlayCircle size={18} />}
            action="start"
            color="green"
            loading={loading === 'start'}
            onClick={() => performAction('start')}
          />
        )}
        
        {/* Botones para estado 'running' */}
        {normalizedStatus === 'running' && (
          <>
            <PowerButton
              label="Stop"
              icon={<StopCircle size={18} />}
              action="stop" // Mapea a shutdown_guest (vSphere) o shutdown (Proxmox) - apagado suave
              color="red"
              loading={loading === 'stop'}
              onClick={() => performAction('stop')}
            />
            
            <PowerButton
              label="Restart"
              icon={<RefreshCw size={18} />}
              action="restart" // Mapea a reboot_guest (vSphere) o reboot (Proxmox) - reinicio suave
              color="amber"
              loading={loading === 'restart'}
              onClick={() => performAction('restart')}
            />
            
            <PowerButton
              label="Suspend"
              icon={<PauseCircle size={18} />}
              action="suspend"
              color="blue"
              loading={loading === 'suspend'}
              onClick={() => performAction('suspend')}
            />
          </>
        )}
        
        {/* Botón Resume: disponible si está 'paused' (o 'suspended') */}
        {normalizedStatus === 'paused' && ( 
          <PowerButton
            label="Resume"
            icon={<PlayCircle size={18} />}
            action="resume" // Mapea a 'on' (vSphere) o 'resume' (Proxmox)
            color="green"
            loading={loading === 'resume'}
            onClick={() => performAction('resume')}
          />
        )}
        
        {/* Botón Force Off: disponible si está 'running' o 'paused' */}
        {(normalizedStatus === 'running' || normalizedStatus === 'paused') && (
             <PowerButton
                label="Force Off"
                icon={<Power size={18} />}
                action="shutdown" // Mapea a 'off' (vSphere) o 'stop' (Proxmox) - apagado forzado
                color="gray"
                loading={loading === 'shutdown'}
                onClick={() => performAction('shutdown')}
             />
        )}
      </div>
    </div>
  );
};

interface PowerButtonProps {
  label: string;
  icon: React.ReactNode;
  action: PowerAction; // El tipo PowerAction ya está definido en vm.ts
  color: 'red' | 'green' | 'blue' | 'amber' | 'gray';
  loading: boolean;
  onClick: () => void;
}

const PowerButton: React.FC<PowerButtonProps> = ({ 
  label, icon, color, loading, onClick 
}) => {
  const colorClasses = {
    red: 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-700/30 dark:text-red-400 dark:hover:bg-red-700/50 focus-visible:ring-red-500',
    green: 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-700/30 dark:text-green-400 dark:hover:bg-green-700/50 focus-visible:ring-green-500',
    blue: 'bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-700/30 dark:text-blue-400 dark:hover:bg-blue-700/50 focus-visible:ring-blue-500',
    amber: 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-700/30 dark:text-amber-400 dark:hover:bg-amber-700/50 focus-visible:ring-amber-500',
    gray: 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600 focus-visible:ring-slate-500'
  };
  
  return (
    <button
      disabled={loading}
      onClick={onClick}
      className={`inline-flex items-center justify-center px-4 py-2 rounded-lg text-sm font-semibold shadow-sm transition-all duration-150 ease-in-out
                 disabled:opacity-60 disabled:cursor-not-allowed
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900
                 ${colorClasses[color]}`}
    >
      <span className={`transition-transform duration-300 ${loading ? 'animate-spin' : ''} mr-2`}>
        {icon}
      </span>
      {label}
    </button>
  );
};

export default VMControls;
