
// Import detail types if they are defined elsewhere, otherwise define inline
import { VMTemplate, VMSpecs } from './vm'; // Assuming VMTemplate is defined in './vm', added VMSpecs

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
  vsphere_subtype?: 'vcenter' | 'esxi'; // Added subtype
  updated_at?: string; // Added from DB (string from JSON)
  // Optional details fetched for the details page
  nodes?: NodeResource[];
  storage?: StorageResource[];
  templates?: VMTemplate[]; // Use VMTemplate if it matches OSTemplate structure
  planCapacityEstimates?: PlanCapacityEstimate[]; // Added from details page logic
  aggregatedStats?: AggregatedStats; // Added from details page logic
  detailsError?: string; // Added to hold error message if details fetch fails
}

export interface HypervisorCredentials {
  type: HypervisorType;
  host: string;
  port?: number;
  username: string;
  password?: string; // Make password optional if using token
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
  status: 'online' | 'offline' | 'unknown' | string; // Allow string for flexibility, added unknown
  cpu?: { // Make optional as details might fail
    cores: number;
    usage: number; // Fraction 0-1
  };
  memory?: { // Make optional as details might fail
    total: number; // Bytes
    used: number;
    free: number;
  };
  // Root filesystem usage for the node itself
  rootfs?: {
    total: number; // Bytes
    used: number; // Bytes
  };
}

// Renamed OSTemplate to NodeTemplate for clarity, or use VMTemplate if suitable
// This seems redundant if VMTemplate covers it. Let's keep VMTemplate from vm.ts

// Type for the capacity estimation data added to the hypervisor details
export interface PlanCapacityEstimate {
  planId: string;
  planName: string;
  estimatedCount: number;
  specs: VMSpecs; // Use VMSpecs from vm.ts
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

// The HypervisorDetailsData interface was removed as the optional fields
// were added directly to the base Hypervisor interface.
