import { ChevronRight, HardDrive, Monitor, Power, SquareSlash, Zap, Ticket, User, Calendar, ShieldCheck, ShieldAlert, Server, Network } from 'lucide-react'; // Added Network for IP
import { VM } from '../../types/vm';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { format } from 'date-fns';

interface VirtualMachineCardProps {
  vm: VM;
  onAction: (action: 'start' | 'stop' | 'restart', vmId: string) => void;
}

export default function VirtualMachineCard({ vm, onAction }: VirtualMachineCardProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running':
        return 'bg-success-500';
      case 'stopped':
        return 'bg-slate-500';
      case 'suspended':
        return 'bg-warning-500';
      case 'creating':
      case 'provisioning':
        return 'bg-primary-500 animate-pulse';
      case 'error':
        return 'bg-danger-500';
      default:
        return 'bg-slate-300';
    }
  };


  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="card"
    >
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <div className={`h-3 w-3 rounded-full ${getStatusColor(vm.status)}`}></div>
            <h3 className="font-medium text-lg text-slate-900 dark:text-white truncate" title={vm.name}>{vm.name}</h3>
          </div>
          <div className="text-xs bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded">
            {vm.hypervisorType === 'proxmox' ? 'Proxmox' : 'vSphere'}
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 mb-4 text-sm">
          <div className="flex items-center space-x-2">
            <Monitor className="h-4 w-4 text-slate-400" />
            <span className="text-sm text-slate-600 dark:text-slate-300">
              {vm.specs.cpu} CPU{vm.specs.cpu > 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex items-center space-x-2">
            <Zap className="h-4 w-4 text-slate-400" />
            <span className="text-sm text-slate-600 dark:text-slate-300">
              {vm.specs.memory >= 1024 
                ? `${(vm.specs.memory / 1024).toFixed(1)} GB` 
                : `${vm.specs.memory} MB`}
            </span>
          </div>
          <div className="flex items-center space-x-2">
            <HardDrive className="h-4 w-4 text-slate-400" />
            <span className="text-sm text-slate-600 dark:text-slate-300">
              {vm.specs.disk} GB
            </span>
            </div>
          {/* Hostname (vSphere) */}
          {vm.hypervisorType === 'vsphere' && vm.hostname && (
            <div className="flex items-center space-x-2">
              <Server className="h-4 w-4 text-slate-400" /> {/* Usando Server como icono para hostname */}
              <span className="text-sm text-slate-600 dark:text-slate-300 truncate" title={vm.hostname}>
                {vm.hostname}
              </span>
            </div>
          )}
          {/* VMware Tools (vSphere) - se muestra en la misma línea si hay espacio o debajo */}
          {vm.hypervisorType === 'vsphere' && vm.vmwareToolsStatus && (
            <div className={`flex items-center space-x-1 ${!vm.hostname ? 'col-span-2' : ''}`} title={`VMware Tools: ${vm.vmwareToolsStatus}`}>
              {vm.vmwareToolsStatus === 'toolsOk' || vm.vmwareToolsStatus === 'toolsRunning' ? <ShieldCheck className="h-4 w-4 text-success-500" /> : <ShieldAlert className="h-4 w-4 text-warning-500" />}
              <span className="text-xs text-slate-500 dark:text-slate-400">{vm.vmwareToolsStatus.replace('tools', '')}</span>
            </div>
          )}
          {/* IP Address (Primary) */}
          {vm.ipAddress && (
            <div className="flex items-center space-x-2">
              <Network className="h-4 w-4 text-slate-400" />
              <span className="text-sm text-slate-600 dark:text-slate-300 truncate" title={vm.ipAddress}>
                {vm.ipAddress}
              </span>
            </div>
          )}
          {/* Moved Created Date here */}
          <div className="flex items-center space-x-2">
            <Calendar className="h-4 w-4 text-slate-400" />
            <span className="text-slate-500 dark:text-slate-400">
              {format(new Date(vm.createdAt), 'MMM d, yyyy')}
            </span>
          </div>
        </div>

        {/* Additional Info: Ticket & Client */}
        {(vm.ticket || vm.finalClientId) && (
          <div className="border-t border-slate-200 dark:border-slate-600 pt-2 mt-2 mb-4 space-y-1 text-sm">
            {vm.ticket && (
              <div className="flex items-center space-x-2">
                <Ticket className="h-4 w-4 text-slate-400" />
                <span className="text-slate-600 dark:text-slate-300 truncate" title={vm.ticket}>Ticket: {vm.ticket}</span>
              </div>
            )}
            {/* Display Client Name if available, otherwise fallback or nothing */}
            {vm.finalClientName && ( // Prefer showing name if backend provides it
              <div className="flex items-center space-x-2">
                <User className="h-4 w-4 text-slate-400" />
                <span className="text-slate-600 dark:text-slate-300 truncate" title={vm.finalClientName}>Cliente: {vm.finalClientName}</span>
              </div>
            )}
            {/* Optional: Show Client ID if name is not available */}
            {!vm.finalClientName && vm.finalClientId && (
              <div className="flex items-center space-x-2">
                <User className="h-4 w-4 text-slate-400" />
                <span className="text-xs text-slate-500 dark:text-slate-400">Client ID: {vm.finalClientId.substring(0, 8)}...</span>
              </div>
            )}
          </div>
        )}
        
        {vm.ipAddresses && vm.ipAddresses.length > 1 && ( // Show this section only if there are multiple IPs beyond the primary one
          <div className="mb-3">
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Otras IPs:</p>
            <div className="flex flex-wrap gap-1 text-xs">
              {vm.ipAddresses.map((ip, i) => (
                <span key={i} className="inline-block bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded px-2 py-1 text-xs">
                  {ip}
                </span>
              ))}
            </div>
          </div>
        )}
        
        <div className="border-t border-slate-200 dark:border-slate-700 pt-3 flex items-center justify-between">
          <div className="flex space-x-2">
            {vm.status !== 'running' && (
              <button 
                className="p-1.5 rounded bg-slate-100 dark:bg-slate-700 text-success-600 dark:text-success-400 hover:bg-success-100 dark:hover:bg-success-900/30"
                onClick={() => onAction('start', vm.id)}
                disabled={['creating', 'provisioning'].includes(vm.status)}
              >
                <Power className="h-4 w-4" />
              </button>
            )}
            {vm.status === 'running' && (
              <button 
                className="p-1.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600"
                onClick={() => onAction('stop', vm.id)}
              >
                <SquareSlash className="h-4 w-4" />
              </button>
            )}
          </div>
          
          <Link 
            to={`/vm/${vm.id}`}
            className="flex items-center text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
          >
            Detalles <ChevronRight className="h-4 w-4 ml-1" />
          </Link>
        </div>
      </div>
    </motion.div>
  );
}
