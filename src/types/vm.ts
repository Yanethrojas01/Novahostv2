import { HypervisorType } from './hypervisor';

export type VMStatus = 
  | 'running'
  | 'stopped'
  | 'suspended'
  | 'creating'
  | 'provisioning'
  | 'error'
  | 'unknown';

export interface VMSpecs {
  cpu: number;
  memory: number; // In MB
  disk: number;   // In GB
  template?: string;
  os?: string;
  network?: VMNetworkConfig[];
}

export interface VMNetworkConfig {
  id: string;
  type: 'bridge' | 'nat' | 'custom';
  name: string;
  macAddress?: string;
  ipAddress?: string;
  vlan?: number;
}

export interface VMDiskDetail {
  label: string;
  capacity_gb: number;
  datastore: string;
  thin_provisioned?: boolean | null;
  file_name: string;
  disk_mode?: string;
}

export interface VMNicDetail extends VMNetworkConfig { // Extiende VMNetworkConfig
  // mac_address ya está en VMNetworkConfig
  // type ya está en VMNetworkConfig
  connected?: boolean;
  // network_name (podría ser el portgroup o switch virtual) ya está en VMNetworkConfig como 'name'
}

export interface VM {
  id: string; // This should be the hypervisor's operational VM ID (e.g., Proxmox VMID)
  databaseId?: string; // The UUID from the virtual_machines table in your database
  name: string;
  description?: string;
  hypervisorId: string;
  hypervisorType: HypervisorType;
  nodeName?: string;
  status: VMStatus;
  specs: VMSpecs;
  createdAt: Date | string; // Permitir string para flexibilidad inicial, convertir a Date en el frontend
  lastStatusChange?: Date;
  tags?: string[];
  ipAddress?: string; // Campo principal para la IP, si hay múltiples, ipAddresses
  ipAddresses?: string[]; // Para múltiples IPs si es necesario
  ticket?: string; // Added from schema.sql
  finalClientId?: string; // Added from schema.sql
  finalClientName?: string; // Optional: If backend provides the name via JOIN
  // Campos adicionales de vSphere
  moid?: string; // Managed Object ID de vSphere
  hostname?: string; // Guest OS hostname
  vmwareToolsStatus?: string; // Estado de VMware Tools
  detailedDisks?: VMDiskDetail[]; // Para mostrar detalles de discos individuales
  detailedNics?: VMNicDetail[];   // Para mostrar detalles de NICs individuales
}

export interface VMMetrics {
  cpu: number;       // percentage
  memory: number;    // percentage
  disk: number;      // percentage
  network: {
    in: number;      // bytes per second
    out: number;     // bytes per second
  };
  uptime: number;    // seconds
}

export interface VMTemplate {
  id: string;
  name: string;
  description?: string;
  hypervisorType: HypervisorType;
  os: string;
  size: number; // In GB
  osVersion?: string;
  specs: VMSpecs;
}

export interface VMCreateParams {
  name: string;
  description?: string;
  hypervisorId: string;
  nodeName?: string;
  specs: VMSpecs;
  start?: boolean;
  templateId?: string;
  tags?: string[];
  ticket?: string; // Added ticket field
  finalClientId?: string; // Added final client ID field
  planId?: string; // If creating from a plan

  // vSphere specific (optional, backend might use defaults or template's settings)
  datastoreName?: string;
  resourcePoolName?: string; // Less common for simple UI, but possible
  folderName?: string; // VM folder in vCenter
}

export interface VMPlan {
  id: string;
  name: string;
  description: string;
  specs: VMSpecs;
  icon?: string;
  is_active: boolean;
  createdAt: Date;
  updatedAt: Date;
}