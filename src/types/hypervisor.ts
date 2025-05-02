

export type HypervisorType = 'proxmox' | 'vsphere';

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

export interface OSTemplate {
  id: string;
  name: string;
  description?: string;
  size: number;
  path: string;
  type: 'iso' | 'template';
  version?: string;
  storage: string;
}