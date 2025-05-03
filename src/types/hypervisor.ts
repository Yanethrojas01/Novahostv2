
// Import detail types if they are defined elsewhere, otherwise define inline
import { VMTemplate } from './vm'; // Assuming VMTemplate is defined here or imported

export type HypervisorType = 'proxmox' | 'vsphere'; // <-- Define the type here

export interface Hypervisor {
  id: string;
  name: string;
  type: HypervisorType;
  host: string;
  username?: string; // Username might not always be returned depending on permissions/API design
  status: 'connected' | 'disconnected' | 'error'; // Status from the database
  lastSync: Date | null; // Last sync timestamp from the database
  createdAt?: Date; // Added from DB
  updatedAt?: Date; // Added from DB
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
  type: string;
  size: number;
  used: number;
  available: number;
  path?: string;
}

export interface NodeResource {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'maintenance';
  cpu: {
    cores: number;
    usage: number;
  };
  memory: {
    total: number;
    used: number;
    free: number;
  };
  storage: StorageResource[];
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