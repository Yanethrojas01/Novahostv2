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

export interface VM {
  id: string;
  name: string;
  description?: string;
  hypervisorId: string;
  hypervisorType: HypervisorType;
  nodeName?: string;
  status: VMStatus;
  specs: VMSpecs;
  createdAt: Date;
  lastStatusChange?: Date;
  tags?: string[];
  ipAddresses?: string[];
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
  tags?: string[];
  planId?: string;
}

export interface VMPlan {
  id: string;
  name: string;
  description: string;
  specs: VMSpecs;
  icon?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}