import { VM } from '../types/vm';
import { Hypervisor } from '../types/hypervisor';

export const mockVMs: VM[] = [
  {
    id: '1',
    name: 'web-server-1',
    description: 'Production web server',
    hypervisorId: '1',
    hypervisorType: 'proxmox',
    nodeName: 'pve-node1',
    status: 'running',
    specs: {
      cpu: 2,
      memory: 4096,
      disk: 40,
      os: 'Ubuntu Server 22.04',
    },
    createdAt: new Date('2023-06-10'),
    ipAddresses: ['192.168.1.101', '10.0.0.5'],
    tags: ['production', 'web']
  },
  {
    id: '2',
    name: 'db-server',
    description: 'PostgreSQL database server',
    hypervisorId: '1',
    hypervisorType: 'proxmox',
    nodeName: 'pve-node1',
    status: 'running',
    specs: {
      cpu: 4,
      memory: 8192,
      disk: 100,
      os: 'Rocky Linux 9',
    },
    createdAt: new Date('2023-07-15'),
    ipAddresses: ['192.168.1.102'],
    tags: ['production', 'database']
  },
  {
    id: '3',
    name: 'test-windows',
    description: 'Windows test server',
    hypervisorId: '2',
    hypervisorType: 'vsphere',
    nodeName: 'esxi-01',
    status: 'stopped',
    specs: {
      cpu: 2,
      memory: 4096,
      disk: 80,
      os: 'Windows Server 2022',
    },
    createdAt: new Date('2023-08-20'),
    ipAddresses: ['192.168.1.150'],
    tags: ['test', 'windows']
  },
  {
    id: '4',
    name: 'dev-server',
    description: 'Development environment',
    hypervisorId: '1',
    hypervisorType: 'proxmox',
    nodeName: 'pve-node2',
    status: 'running',
    specs: {
      cpu: 2,
      memory: 2048,
      disk: 40,
      os: 'Debian 11',
    },
    createdAt: new Date('2023-09-05'),
    ipAddresses: ['192.168.1.120'],
    tags: ['development']
  },
  {
    id: '5',
    name: 'monitoring',
    description: 'Grafana and Prometheus server',
    hypervisorId: '2',
    hypervisorType: 'vsphere',
    nodeName: 'esxi-02',
    status: 'running',
    specs: {
      cpu: 2,
      memory: 4096,
      disk: 60,
      os: 'Ubuntu Server 22.04',
    },
    createdAt: new Date('2023-10-10'),
    ipAddresses: ['192.168.1.130'],
    tags: ['monitoring', 'production']
  },
  {
    id: '6',
    name: 'backup-server',
    description: 'Backup solution',
    hypervisorId: '2',
    hypervisorType: 'vsphere',
    nodeName: 'esxi-01',
    status: 'stopped',
    specs: {
      cpu: 2,
      memory: 4096,
      disk: 500,
      os: 'Rocky Linux 9',
    },
    createdAt: new Date('2023-11-15'),
    ipAddresses: ['192.168.1.140'],
    tags: ['backup']
  }
];

export const mockHypervisors: Hypervisor[] = [
  {
    id: '1',
    name: 'Proxmox Cluster',
    type: 'proxmox',
    host: 'proxmox.example.com',
    username: 'root',
    status: 'connected',
    lastSync: new Date('2024-03-01T08:30:00'),
    nodeCount: 3,
    totalVMs: 15
  },
  {
    id: '2',
    name: 'vSphere Datacenter',
    type: 'vsphere',
    host: 'vcenter.example.com',
    username: 'administrator@vsphere.local',
    status: 'connected',
    lastSync: new Date('2024-03-01T09:15:00'),
    nodeCount: 2,
    totalVMs: 8
  },
  {
    id: '3',
    name: 'Dev Proxmox',
    type: 'proxmox',
    host: 'dev-proxmox.example.com',
    username: 'root',
    status: 'error',
    lastSync: new Date('2024-02-28T18:45:00'),
    nodeCount: 1,
    totalVMs: 5
  }
];