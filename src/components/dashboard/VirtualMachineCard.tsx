import { ChevronRight, HardDrive, Monitor, Power, SquareSlash, Zap } from 'lucide-react';
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
            <h3 className="font-medium text-lg text-slate-900 dark:text-white">{vm.name}</h3>
          </div>
          <div className="text-xs bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded">
            {vm.hypervisorType === 'proxmox' ? 'Proxmox' : 'vSphere'}
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-4 mb-4">
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
          <div className="flex items-center space-x-2">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Created: {format(new Date(vm.createdAt), 'MMM d, yyyy')}
            </div>
          </div>
        </div>
        
        {vm.ipAddresses && vm.ipAddresses.length > 0 && (
          <div className="mb-3">
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">IP Addresses</p>
            <div className="flex flex-wrap gap-1">
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
            Details <ChevronRight className="h-4 w-4 ml-1" />
          </Link>
        </div>
      </div>
    </motion.div>
  );
}