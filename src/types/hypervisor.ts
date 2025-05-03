
// Import detail types if they are defined elsewhere, otherwise define inline
import { VMTemplate } from './vm'; // Assuming VMTemplate is defined in './vm'

export type HypervisorType = 'proxmox' | 'vsphere'; // <-- Define the type here

// Base Hypervisor type - reflects DB structure primarily (using snake_case from API/DB)
export interface Hypervisor {
  id: string;
  name: string;
  type: HypervisorType;
  host: string;
  username?: string; // Username might not always be returned depending on permissions/API design
  status: 'connected' | 'disconnected' | 'error' | string; // Status from the database (string for flexibility)
  last_sync: string | null; // Last sync timestamp from the database (string from JSON)
  created_at?: string; // Added from DB (string from JSON)
  updated_at?: string; // Added from DB (string from JSON)
  // Optional details fetched for the details page
  nodes?: NodeResource[];
  storage?: StorageResource[];
  templates?: VMTemplate[]; // Use VMTemplate if it matches OSTemplate structure
}

export interface HypervisorCredentials {
  type: HypervisorType;
  host: string;
  port?: number;
  username: string;
  password: string;
  apiToken?: string;
  tokenName?: string; // Added for Proxmox API Token ID (user@realm!tokenName)

}

export interface StorageResource {
  id: string;
  name: string;
  type: string; // e.g., 'lvm', 'nfs', 'dir' from Proxmox API
  size: number; // total size in bytes from Proxmox API (total)
  used: number; // used size in bytes from Proxmox API (used)
  available: number; // available size in bytes from Proxmox API (avail)
  path?: string;
}

export interface NodeResource {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'maintenance';
  cpu?: { // Make optional as details might fail
    cores: number;
    usage: number;
  };
  memory?: { // Make optional as details might fail
    total: number;
    used: number;
    free: number;
  };
  // Storage is usually cluster-wide, not per-node in this context
}

// Renamed OSTemplate to NodeTemplate for clarity, or use VMTemplate if suitable
export interface NodeTemplate {
  id: string;
  name: string;
  description?: string;
  size: number;
  path: string;
  type: 'iso' | 'template';
  version?: string;
  storage: string;
}

// Type for the capacity estimation data added to the hypervisor details
export interface PlanCapacityEstimate {
  planId: string;
  planName: string;
  estimatedCount: number;
  specs: {
    cpu: number;
    memory: number;
    disk: number;
  };
}

// Type for aggregated stats calculated by the backend for details page
export interface AggregatedStats {
  totalCores: number;
  avgCpuUsagePercent: number;
  totalMemoryBytes: number;
  usedMemoryBytes: number;
  totalDiskBytes: number;
  usedDiskBytes: number;
  storagePoolCount: number;
}

export interface HypervisorDetailsData extends Hypervisor { // Extiende Hypervisor para heredar campos base
  // No es necesario redefinir id, name, type, host, status, etc.
  // Override or add specific fields for the details view
  nodes: NodeResource[]; // Use specific type
  storage: StorageResource[]; // Use specific type
  templates: VMTemplate[]; // Use specific type (assuming VMTemplate is correct)
  planCapacityEstimates?: PlanCapacityEstimate[]; // Add the new field
  aggregatedStats?: AggregatedStats; // Add the aggregated stats field
  detailsError?: string; // Optional error message if details fail to load
}
