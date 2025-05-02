import express from 'express';
import cors from 'cors';
import pg from 'pg';
import dotenv from 'dotenv';
import Proxmox, { proxmoxApi } from 'proxmox-api'; // Import the proxmox library

// Load environment variables from .env file
dotenv.config();

const app = express();
const port = process.env.PORT || 3001;
// --- Database Setup ---
const { Pool } = pg;
const pool = new Pool({
  connectionString: `postgres://${process.env.VITE_POSTGRES_USER}:${process.env.VITE_POSTGRES_PASSWORD}@${process.env.VITE_POSTGRES_HOST}:${process.env.VITE_POSTGRES_PORT}/${process.env.VITE_POSTGRES_DB}`,
});
// Middleware
app.use(cors());
app.use(express.json());

//bypass del certificado ssl
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';


// Mock authentication middleware - would be replaced with real auth in production
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // In a real implementation, validate the token here
  next();
};

// Routes
// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});


app.get('/api/proxmox/vms', authenticate, (req, res) => {
  // This would make a request to the Proxmox API
  res.json([
    {
      id: '100',
      name: 'web-server-1',
      status: 'running',
      node: 'pve-node1',
      cpu: 2,
      memory: 2048,
      disk: 32,
    },
    {
      id: '101',
      name: 'db-server',
      status: 'running',
      node: 'pve-node1',
      cpu: 4,
      memory: 8192,
      disk: 100,
    },
    {
      id: '102',
      name: 'test-server',
      status: 'stopped',
      node: 'pve-node2',
      cpu: 1,
      memory: 1024,
      disk: 20,
    },
  ]);
});

// vSphere API routes
app.get('/api/vsphere/datacenters', authenticate, (req, res) => {
  // This would make a request to the vSphere API
  res.json([
    { id: 'datacenter-1', name: 'Main Datacenter' }
  ]);
});

app.get('/api/vsphere/vms', authenticate, (req, res) => {
  // This would make a request to the vSphere API
  res.json([
    {
      id: 'vm-101',
      name: 'windows-server',
      status: 'poweredOn',
      datacenter: 'datacenter-1',
      cpu: 2,
      memory: 4096,
      disk: 80,
    },
    {
      id: 'vm-102',
      name: 'monitoring',
      status: 'poweredOn',
      datacenter: 'datacenter-1',
      cpu: 2,
      memory: 4096,
      disk: 60,
    },
  ]);
});

// POST /api/vms - Create a new VM
app.post('/api/vms', authenticate, async (req, res) => {
  // Cast the body to the expected type (ensure VMCreateParams is imported or defined if needed)
  const params = req.body; // as VMCreateParams; 
  console.log('--- Received POST /api/vms --- Params:', params);

  // Basic Validation - Check templateId instead of specs.os for template selection
  if (!params.name || !params.hypervisorId || !params.specs?.cpu || !params.specs?.memory || !params.specs?.disk || !params.templateId) {
    return res.status(400).json({ error: 'Missing required VM parameters (name, hypervisorId, specs, templateId).' });
  }

  try {
    // 1. Get Hypervisor Details
    const { rows: [hypervisor] } = await pool.query(
      `SELECT id, type, host, username, api_token, token_name, status 
       FROM hypervisors WHERE id = $1`,
      [params.hypervisorId]
    );
console.log(hypervisor)
    if (!hypervisor) {
      return res.status(404).json({ error: 'Target hypervisor not found' });
    }
    if (hypervisor.status !== 'connected') {
      return res.status(409).json({ error: 'Target hypervisor is not connected' });
    }

    let creationResult = null;
    let newVmId = null;

    // --- Proxmox VM Creation Logic ---
    if (hypervisor.type === 'proxmox') {
      // Connect to Proxmox
      const [dbHost, dbPortStr] = hypervisor.host.split(':');
      const port = dbPortStr ? parseInt(dbPortStr, 10) : 8006;
      const cleanHost = dbHost;
      const isIso = params.templateId.includes(':iso/'); // Simple check if it's an ISO

      const proxmoxConfig = {
        host: cleanHost, port: port, username: hypervisor.username,
        tokenID: `${hypervisor.username}!${hypervisor.token_name}`,
        tokenSecret: hypervisor.api_token, timeout: 30000, rejectUnauthorized: false // Longer timeout for creation
      };
      const proxmox = proxmoxApi(proxmoxConfig);

      // Determine target node (needs to be provided or chosen)
      // For now, let's assume the frontend sends nodeName or we pick the first available node
      let targetNode = params.nodeName;
      if (!targetNode) {
        const nodes = await proxmox.nodes.$get();
        if (!nodes || nodes.length === 0) throw new Error('No nodes found on hypervisor');
        targetNode = nodes[0].node; // Default to first node
        console.log(`No node specified, defaulting to first node: ${targetNode}`);
      }

      // Get next available VMID
      const nextIdResult = await proxmox.cluster.nextid.$get();
      newVmId = nextIdResult.toString(); // Ensure it's a string

      // Prepare Proxmox VM creation parameters (Simplified Example)
      if (isIso) {
        // --- Create VM from ISO ---
        const sanitizedName = params.name.replace(/\s+/g, '-'); // Replace spaces with hyphens
        const createParams = {
          vmid: newVmId,
          node: targetNode, // Specify the node
          name: sanitizedName,
          cores: params.specs.cpu,
          memory: params.specs.memory,
          description: params.description || '',
          tags: params.tags?.join(';') || '',
          // Define storage for the main disk (example: using 'local-lvm' storage)
          // You might need to make storage selection dynamic
          scsi0: `local-lvm:${params.specs.disk}`, // Disk on local-lvm storage (Removed format=qcow2 for LVM-Thin)
          // Attach the ISO image
          ide2: `${params.templateId},media=cdrom`,
          // Set boot order to boot from CD-ROM first
          boot: 'order=ide2;scsi0',
          // Define network (example: using vmbr0 bridge)
          // You might need to make network selection dynamic
          net0: 'virtio,bridge=vmbr0',
          // Other common settings
          scsihw: 'virtio-scsi-pci', // Recommended SCSI controller
          ostype: 'l26', // Example: Linux 2.6 - 6.x Kernel (adjust as needed)
        };
        console.log(`Attempting to create VM ${newVmId} ('${sanitizedName}') from ISO on node ${targetNode} with params:`, createParams);
        creationResult = await proxmox.nodes.$(targetNode).qemu.$post(createParams);

      } else {
        // --- Clone VM from Template ---
        // IMPORTANT: Assumes params.templateId is the *numeric VMID* of the template.
        // This requires the frontend/template fetching to provide the correct numeric ID.
        const templateVmIdToClone = params.templateId;
        const sanitizedName = params.name.replace(/\s+/g, '-'); // Replace spaces with hyphens
        const cloneParams = {
          newid: newVmId, // ID for the new VM
          name: sanitizedName,
          full: 1, // Full clone is generally recommended
          // Optional overrides (Proxmox might ignore some if cloning a full template)
          cores: params.specs.cpu,
          memory: params.specs.memory,
          description: params.description || '',
          tags: params.tags?.join(';') || '',
        };
        console.log(`Attempting to clone template VM ${templateVmIdToClone} to new VM ${newVmId} ('${sanitizedName}') on node ${targetNode} with params:`, cloneParams);
        creationResult = await proxmox.nodes.$(targetNode).qemu.$(templateVmIdToClone).clone.$post(cloneParams);
      }

      // Optionally start the VM if requested and clone was successful
      if (params.start && creationResult) {
        console.log(`Starting VM ${newVmId}...`);
        await proxmox.nodes.$(targetNode).qemu.$(newVmId).status.start.$post();
      }
    } // Add else if for vSphere later
    // --- End Proxmox Logic ---
    // Respond with success (including the new VM ID and task ID)
    res.status(202).json({ // 202 Accepted
      id: newVmId,
      status: 'creating',
      message: `VM creation initiated for ${params.name} (ID: ${newVmId}). Task ID: ${creationResult}`,
      taskId: creationResult
    });

  } catch (error) {
    console.error('Error creating VM:', error);
    const errorDetails = getProxmoxError(error);
    res.status(errorDetails.code || 500).json({
      error: 'Failed to create VM.',
      details: errorDetails.message,
      suggestion: errorDetails.suggestion
    });
  }
});

// POST /api/vms/:id/action - Implement real actions
app.post('/api/vms/:id/action', authenticate, async (req, res) => { // Make it async
  const { id: vmId } = req.params; // Rename id to vmId for clarity
  const { action } = req.body; // 'start', 'stop', 'restart'

  console.log(`--- Received POST /api/vms/${vmId}/action --- Action: ${action}`);

  if (!['start', 'stop', 'restart'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action specified.' });
  }

  try {
    // --- Step 1: Find the VM's Hypervisor and Node ---
    // This is the complex part. We need to know which hypervisor and node hosts the VM.
    // Option A: Query all connected hypervisors (inefficient but works for now)
    // Option B: Frontend sends hypervisorId/nodeName in request body (better)
    // Option C: Have a persistent mapping of vmId -> hypervisorId/nodeName (best)

    // Let's try Option A for demonstration:
    const { rows: connectedHypervisors } = await pool.query(
      `SELECT id, type, host, username, api_token, token_name 
       FROM hypervisors WHERE status = 'connected'`
    );

    let targetHypervisor = null;
    let targetNode = null;
    let proxmoxClient = null;

    for (const hypervisor of connectedHypervisors) {
      if (hypervisor.type === 'proxmox') {
        const [dbHost, dbPortStr] = hypervisor.host.split(':');
        const port = dbPortStr ? parseInt(dbPortStr, 10) : 8006;
        const cleanHost = dbHost;

        const proxmoxConfig = {
          host: cleanHost, port: port, username: hypervisor.username,
          tokenID: `${hypervisor.username}!${hypervisor.token_name}`,
          tokenSecret: hypervisor.api_token, timeout: 10000, rejectUnauthorized: false
        };
        const proxmox = proxmoxApi(proxmoxConfig);

        try {
          // Use /cluster/resources to find the VM and its node
          const vmResources = await proxmox.cluster.resources.$get({ type: 'vm' });
          const foundVm = vmResources.find(vm => vm.vmid.toString() === vmId);

          if (foundVm) {
            targetHypervisor = hypervisor;
            targetNode = foundVm.node;
            proxmoxClient = proxmox;
            console.log(`Found VM ${vmId} on node ${targetNode} of hypervisor ${hypervisor.id}`);
            break; // Stop searching once found
          }
        } catch (findError) {
          console.warn(`Could not check hypervisor ${hypervisor.id} for VM ${vmId}:`, findError.message);
          // Continue to the next hypervisor
        }
      }
      // TODO: Add vSphere logic here if needed
    }

    if (!targetHypervisor || !targetNode || !proxmoxClient) {
      return res.status(404).json({ error: `VM ${vmId} not found on any connected Proxmox hypervisor.` });
    }

    // --- Step 2: Perform the action ---
    let result;
    const vmPath = proxmoxClient.nodes.$(targetNode).qemu.$(vmId).status;

    console.log(`Performing action '${action}' on VM ${vmId} at ${targetNode}...`);

    switch (action) {
      case 'start':
        result = await vmPath.start.$post();
        break;
      case 'stop':
        result = await vmPath.stop.$post();
        break;
      case 'restart':
        // Proxmox often uses 'reboot' for restart
        result = await vmPath.reboot.$post();
        break;
      default:
        throw new Error('Invalid action'); // Should be caught earlier
    }

    console.log(`Action '${action}' result for VM ${vmId}:`, result); // result is often the task ID

    // Respond optimistically
    res.json({
      id: vmId,
      status: 'pending', // Indicate the action is initiated
      message: `Action '${action}' initiated for VM ${vmId}. Task ID: ${result}`,
      taskId: result // Send back the Proxmox task ID
    });

  } catch (error) {
    console.error(`Error performing action '${action}' on VM ${vmId}:`, error);
    const errorDetails = getProxmoxError(error); // Use existing error handler
    res.status(errorDetails.code || 500).json({
      error: `Failed to perform action '${action}' on VM ${vmId}.`,
      details: errorDetails.message,
      suggestion: errorDetails.suggestion
    });
  }
});

// --- VM Listing API ---

// GET /api/vms - List VMs from all connected hypervisors
app.get('/api/vms', authenticate, async (req, res) => {
  console.log('--- Received GET /api/vms ---');
  let allVms = [];

  try {
    // 1. Get all connected hypervisors from DB
    const { rows: connectedHypervisors } = await pool.query(
      `SELECT id, type, host, username, api_token, token_name 
       FROM hypervisors WHERE status = 'connected'`
    );
    console.log(`Found ${connectedHypervisors.length} connected hypervisors.`);

    // 2. Iterate and fetch VMs for each
    for (const hypervisor of connectedHypervisors) {
      console.log(`Fetching VMs from ${hypervisor.type} hypervisor: ${hypervisor.host} (ID: ${hypervisor.id})`);
      try {
        if (hypervisor.type === 'proxmox') {
          // Connect to Proxmox (similar logic to /connect route)
          const [dbHost, dbPortStr] = hypervisor.host.split(':');
          const port = dbPortStr ? parseInt(dbPortStr, 10) : 8006;
          const cleanHost = dbHost;

          const proxmoxConfig = {
            host: cleanHost,
            port: port,
            username: hypervisor.username,
            tokenID: `${hypervisor.username}!${hypervisor.token_name}`,
            tokenSecret: hypervisor.api_token,
            timeout: 10000, // Shorter timeout for listing might be okay
            rejectUnauthorized: false
          };
          const proxmox = proxmoxApi(proxmoxConfig);

          // Get all VM resources from the cluster
          const vmResources = await proxmox.cluster.resources.$get({ type: 'vm' });
          //console.log(`Got ${vmResources.length} VM resources from ${hypervisor.host}`);

          // Map Proxmox data to our common VM structure
          const proxmoxVms = vmResources.map((vm) => ({
            id: vm.vmid.toString(), // Ensure ID is a string
            name: vm.name,
            status: vm.status, // e.g., 'running', 'stopped'
            nodeName: vm.node, // Change 'node' to 'nodeName'
            specs: { // Nest specs
              cpu: vm.maxcpu,
              memory: Math.round(vm.maxmem / (1024 * 1024)), // Convert bytes to MB
              disk: Math.round(vm.maxdisk / (1024 * 1024 * 1024)), // Convert bytes to GB
              // template, os, network would need more specific API calls if required
            },
            hypervisorType: 'proxmox',
            hypervisorId: hypervisor.id, // Link back to the hypervisor
            createdAt: new Date(), // Add placeholder createdAt
            // Add other fields as needed, e.g., uptime, template status
          }));

          allVms = allVms.concat(proxmoxVms);

        } else if (hypervisor.type === 'vsphere') {
          // TODO: Implement vSphere VM fetching logic here
          console.log(`vSphere VM fetching not yet implemented for ${hypervisor.host}`);
        }
      } catch (hypervisorError) {
        // Log error for this specific hypervisor but continue with others
        console.error(`Error fetching VMs from hypervisor ${hypervisor.id} (${hypervisor.host}):`, getProxmoxError(hypervisorError));
        // Optionally, you could add a placeholder VM indicating an error for this source
      }
    }

    console.log(`Total VMs fetched: ${allVms.length}`);
    res.json(allVms);

  } catch (dbError) {
    console.error('Error retrieving connected hypervisors from DB:', dbError);
    res.status(500).json({ error: 'Failed to retrieve hypervisor list' });
  }
});

// GET /api/vms/:id - Get details for a single VM
app.get('/api/vms/:id', authenticate, async (req, res) => {
  const { id: vmId } = req.params;
  console.log(`--- Received GET /api/vms/${vmId} ---`);

  try {
    // --- Step 1: Find the VM's Hypervisor and Node ---
    const { rows: connectedHypervisors } = await pool.query(
      `SELECT id, type, host, username, api_token, token_name 
       FROM hypervisors WHERE status = 'connected'`
    );

    let targetHypervisor = null;
    let targetNode = null;
    let proxmoxClient = null;
    let foundVmResource = null; // Store the resource info

    for (const hypervisor of connectedHypervisors) {
      if (hypervisor.type === 'proxmox') {
        const [dbHost, dbPortStr] = hypervisor.host.split(':');
        const port = dbPortStr ? parseInt(dbPortStr, 10) : 8006;
        const cleanHost = dbHost;

        const proxmoxConfig = {
          host: cleanHost, port: port, username: hypervisor.username,
          tokenID: `${hypervisor.username}!${hypervisor.token_name}`,
          tokenSecret: hypervisor.api_token, timeout: 10000, rejectUnauthorized: false
        };
        const proxmox = proxmoxApi(proxmoxConfig);

        try {
          const vmResources = await proxmox.cluster.resources.$get({ type: 'vm' });
          const foundVm = vmResources.find(vm => vm.vmid.toString() === vmId);

          if (foundVm) {
            targetHypervisor = hypervisor;
            targetNode = foundVm.node;
            proxmoxClient = proxmox;
            foundVmResource = foundVm; // Save resource data
            console.log(`Found VM ${vmId} on node ${targetNode} of hypervisor ${hypervisor.id}`);
            break;
          }
        } catch (findError) {
          console.warn(`Could not check hypervisor ${hypervisor.id} for VM ${vmId}:`, findError.message);
        }
      }
      // TODO: Add vSphere logic here if needed
    }

    if (!targetHypervisor || !targetNode || !proxmoxClient || !foundVmResource) {
      return res.status(404).json({ error: `VM ${vmId} not found on any connected Proxmox hypervisor.` });
    }

    // --- Step 2: Get VM Config and Current Status ---
    const vmConfig = await proxmoxClient.nodes.$(targetNode).qemu.$(vmId).config.$get();
    const vmStatus = await proxmoxClient.nodes.$(targetNode).qemu.$(vmId).status.current.$get();

    // --- Step 3: Map data to our VM type ---
    const vmDetails = {
      id: vmId,
      name: vmConfig.name || foundVmResource.name, // Prefer config name, fallback to resource name
      description: vmConfig.description || '',
      hypervisorId: targetHypervisor.id,
      hypervisorType: 'proxmox',
      nodeName: targetNode,
      status: vmStatus.status, // 'running', 'stopped', etc.
      specs: {
        cpu: vmConfig.cores * (vmConfig.sockets || 1), // Calculate total cores
        memory: Math.round(vmConfig.memory || foundVmResource.maxmem / (1024 * 1024)), // Prefer config memory (MB), fallback to resource
        disk: Math.round(foundVmResource.maxdisk / (1024 * 1024 * 1024)), // Disk size usually comes from resources (GB)
        // os: vmConfig.ostype, // Map os type if needed
      },
      createdAt: new Date(vmStatus.uptime ? Date.now() - (vmStatus.uptime * 1000) : Date.now()), // Estimate create time from uptime or use now
      // tags: vmConfig.tags ? vmConfig.tags.split(';') : [], // Parse tags if needed
      // ipAddresses: [], // Getting IPs often requires the guest agent
    };

    res.json(vmDetails);

  } catch (error) {
    console.error(`Error fetching details for VM ${vmId}:`, error);
    const errorDetails = getProxmoxError(error);
    res.status(errorDetails.code || 500).json({
      error: `Failed to retrieve details for VM ${vmId}.`,
      details: errorDetails.message,
      suggestion: errorDetails.suggestion
    });
  }
});

// --- End VM Listing API ---

// Helper function to get authenticated proxmox client
async function getProxmoxClient(hypervisorId) {
  const { rows: [hypervisor] } = await pool.query(
    `SELECT id, type, host, username, api_token, token_name, status 
     FROM hypervisors WHERE id = $1`,
    [hypervisorId]
  );

  if (!hypervisor) throw new Error('Hypervisor not found');
  if (hypervisor.status !== 'connected') throw new Error('Hypervisor not connected');
  if (hypervisor.type !== 'proxmox') throw new Error('Not a Proxmox hypervisor');

  const [dbHost, dbPortStr] = hypervisor.host.split(':');
  const port = dbPortStr ? parseInt(dbPortStr, 10) : 8006;
  const cleanHost = dbHost;

  const proxmoxConfig = {
    host: cleanHost, port: port, username: hypervisor.username,
    tokenID: `${hypervisor.username}!${hypervisor.token_name}`,
    tokenSecret: hypervisor.api_token, timeout: 10000, rejectUnauthorized: false
  };
  return proxmoxApi(proxmoxConfig);
}

// GET /api/hypervisors/:id/nodes
app.get('/api/hypervisors/:id/nodes', authenticate, async (req, res) => {
  const { id } = req.params;
  console.log(`--- GET /api/hypervisors/${id}/nodes ---`);
  try {
    const proxmox = await getProxmoxClient(id);
    const nodes = await proxmox.nodes.$get(); // Fetch nodes from Proxmox

    // --- Map Proxmox node data to NodeResource[] ---
    // This requires fetching more details per node (status, cpu, mem)
    // Example structure (needs actual API calls for details):
    const formattedNodes = await Promise.all(nodes.map(async (node) => {
       // Fetch detailed status for each node (e.g., using nodes.<nodeName>.status.$get())
       // This is a simplified example; you'll need more calls for CPU/Mem usage
       const nodeStatus = await proxmox.nodes.$(node.node).status.$get();
       return {
         id: node.node,
         name: node.node,
         status: node.status, // 'online', 'offline'
         cpu: { cores: nodeStatus.cpuinfo?.cores || 0, usage: nodeStatus.cpu || 0 },
         memory: {
           total: nodeStatus.memory?.total || 0,
           used: nodeStatus.memory?.used || 0,
           free: nodeStatus.memory?.free || 0,
         },
         storage: [], // Fetching storage per node would be another call
       };
    }));
    // --- End Mapping ---

    res.json(formattedNodes);
  } catch (error) {
    console.error(`Error fetching nodes for hypervisor ${id}:`, error);
    const errorDetails = getProxmoxError(error);
    res.status(errorDetails.code || 500).json({ error: 'Failed to retrieve nodes', details: errorDetails.message });
  }
});

// GET /api/hypervisors/:id/storage
app.get('/api/hypervisors/:id/storage', authenticate, async (req, res) => {
  const { id } = req.params;
  console.log(`--- GET /api/hypervisors/${id}/storage ---`);
  try {
    const proxmox = await getProxmoxClient(id);
    // Fetch storage across the cluster or per node
    // Example: Get storage defined at the cluster level
    const storageResources = await proxmox.storage.$get();

    // --- Map Proxmox storage data to StorageResource[] ---
    const formattedStorage = storageResources.map(storage => ({
      id: storage.storage, // The storage ID/name
      name: storage.storage,
      type: storage.type, // e.g., 'lvm', 'nfs', 'dir'
      size: storage.total || 0,
      used: storage.used || 0,
      available: storage.avail || 0,
      path: storage.path, // May not always be present
    }));
    // --- End Mapping ---

    res.json(formattedStorage);
  } catch (error) {
    console.error(`Error fetching storage for hypervisor ${id}:`, error);
    const errorDetails = getProxmoxError(error);
    res.status(errorDetails.code || 500).json({ error: 'Failed to retrieve storage', details: errorDetails.message });
  }
});

// GET /api/hypervisors/:id/templates
app.get('/api/hypervisors/:id/templates', authenticate, async (req, res) => {
  const { id } = req.params;
  console.log(`--- GET /api/hypervisors/${id}/templates ---`);
  try {
    const proxmox = await getProxmoxClient(id);
    let allTemplates = [];

    // Need to iterate through nodes and their storage to find templates/isos
    const nodes = await proxmox.nodes.$get();
    for (const node of nodes) {
      const storageList = await proxmox.nodes.$(node.node).storage.$get();
      for (const storage of storageList) {
        // Only check storage types that can contain templates/ISOs
        if (storage.content.includes('iso') || storage.content.includes('vztmpl')) {
          const content = await proxmox.nodes.$(node.node).storage.$(storage.storage).content.$get();
          const templates = content
            .filter(item => item.content === 'iso' || item.content === 'vztmpl')
            .map(item => ({
              id: item.volid, // e.g., local:iso/ubuntu.iso
              name: item.volid.split('/')[1] || item.volid, // Basic name extraction
              description: item.volid, // Use volid as description for now
              size: item.size,
              path: item.volid,
              type: item.content === 'iso' ? 'iso' : 'template',
              version: item.format, // e.g., 'raw', 'qcow2' - might need better version logic
              storage: storage.storage,
            }));
          allTemplates = allTemplates.concat(templates);
        }
      }
    }

    res.json(allTemplates);
  } catch (error) {
    console.error(`Error fetching templates for hypervisor ${id}:`, error);
    const errorDetails = getProxmoxError(error);
    res.status(errorDetails.code || 500).json({ error: 'Failed to retrieve templates', details: errorDetails.message });
  }
});


// --- Hypervisor CRUD API Routes ---

// GET /api/hypervisors - List all hypervisors
app.get('/api/hypervisors', authenticate, async (req, res) => {
 // console.log('--- Received GET /api/hypervisors ---');
  try {
    // Select all relevant fields, excluding sensitive ones like password or full token details
    const result = await pool.query(
      'SELECT id, name, type, host, username, status, last_sync, created_at, updated_at FROM hypervisors ORDER BY created_at DESC'
    );
    
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching hypervisors from DB:', err);
    res.status(500).json({ error: 'Failed to retrieve hypervisors' });
  }
});
// POST /api/hypervisors - Create new hyperviso
app.post('/api/hypervisors', authenticate, async (req, res) => {
  //console.log('--- Received POST /api/hypervisors ---'); // <-- Añade esta línea
    const { type, host, username, password, apiToken, tokenName } = req.body;

  // Validación mejorada
  const validationErrors = [];
  
  // Validaciones base
  if (!type) validationErrors.push('Type is required');
  if (!host) validationErrors.push('Host is required');
  if (!username) validationErrors.push('Username is required');
  
  // Validaciones específicas para Proxmox
  if (type === 'proxmox') {
      const hasToken = apiToken && tokenName;
      const hasPassword = !!password;
      
      if (!hasToken && !hasPassword) {
          validationErrors.push('Proxmox requires either password or API token + token name');
          //console.log('Proxmox requires either password or API token + token name');
      }
      
      if (apiToken && !tokenName) {
          validationErrors.push('Token name is required when using API token');
          //console.log('Token name is required when using API token');
      }
      
      if (tokenName && !apiToken) {
          validationErrors.push('API token secret is required when using token name');
          //console.log('API token secret is required when using token name');
      }
      
      if (!/^https?:\/\/[\w.-]+(:\d+)?$/.test(host)) {
          validationErrors.push('Invalid host format. Use http(s)://hostname[:port]');
          //console.log('Invalid host format. Use http(s)://hostname[:port]');
      }
  }

  if (validationErrors.length > 0) {
    //console.log('Validation errors:', validationErrors);  
    return res.status(400).json({
          error: 'Validation failed',
          details: validationErrors
      });
      
  }

  // Variables de procesamiento
  let status = 'disconnected';
  let lastSync = null;
  let cleanHost = host;
  const name = host.replace(/^https?:\/\//, '').split(/[/:]/)[0].replace(/[^\w-]/g, '-').substring(0, 50);

  try {
      if (type === 'proxmox') {
          // Parsear host y puerto
          const urlParts = new URL(host.includes('://') ? host : `https://${host}`);
          cleanHost = urlParts.hostname;
          const port = urlParts.port || 8006;

          // Configuración según documentación oficial
          const proxmoxConfig = {
              host: cleanHost,
              port: port,
              username: username,
              timeout: 15000,
              rejectUnauthorized: false,
              //ignoreUnauthorized: true,
              //rejectUnauthorized: process.env.NODE_ENV === 'production'
          };

          // Configurar autenticación
          if (apiToken && tokenName) {
              proxmoxConfig.tokenID = `${username}!${tokenName}`;  // Formato user@realm!tokenname
              proxmoxConfig.tokenSecret = apiToken;
          } else {
              proxmoxConfig.password = password;
          }

          // Crear cliente Proxmox
         // const proxmox = new Proxmox(proxmoxConfig); 
          const proxmox = proxmoxApi(proxmoxConfig);//prueba

          // Probar conexión usando endpoint /version
          // Corrección: Usar el método request genérico para /version
          // const versionResponse = await proxmox.request('GET', '/version');
          // // Ajuste: La respuesta de la API de Proxmox suele estar en response.data.data
          // const pveVersion = versionResponse?.data?.data?.version;
          // if (!pveVersion) {
          //     throw new Error('Invalid Proxmox version response');
          // }

          // Verificar nodos usando endpoint /nodes
          try {
            const nodesResponse = await proxmox.nodes.$get(); // Ya funciona correctamente
            
            
            if (!nodesResponse?.length) {
                throw new Error('No nodes found in cluster');
            }
    
            // Obtener la versión desde el primer nodo
            //const nodeName = nodesResponse.data[0].node;

            //const nodeName = proxmox.nodesResponse.$(nodesResponse[0].node);//prueba
            const nodeName = nodesResponse[0].node;
          
            
            const versionResponse = await proxmox.nodes.$(nodeName).version.$get(); // Método específico según la biblioteca
            
    
            const pveVersion = versionResponse?.version;
            
            if (!pveVersion) {
                throw new Error('Invalid Proxmox version response');
            }
    
            status = 'connected';
            lastSync = new Date();
            console.log(`Connected to Proxmox ${pveVersion} at ${cleanHost}:${port}`);
        } catch (error) {
            // Manejo de errores específico para Proxmox
            throw error;
        }

      } else if (type === 'vsphere') {
          // Implementación para vSphere...
          status = 'unsupported';
      }

      // Insertar en base de datos
      const dbResult = await pool.query(
          `INSERT INTO hypervisors (
              name, type, host, username, 
              api_token, token_name, status, last_sync
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, name, type, host, username, status, last_sync, created_at`,
          [
              name,
              type,
              // Corrección: Guardar siempre con el puerto estándar de Proxmox (8006)
              `${cleanHost}:8006`,
              username,
              apiToken || null,
              tokenName || null,
              status,
              lastSync
          ]
      );

      // Preparar respuesta sin datos sensibles
      const response = dbResult.rows[0];
      delete response.api_token;
      delete response.token_name;

      res.status(201).json(response);

  } catch (error) {
      // Manejo detallado de errores
      console.error('Error creating hypervisor:', error);

      const errorInfo = {
          code: 500,
          message: 'Proxmox API Error',
          suggestion: 'Check connection details and credentials'
      };

      // Manejar errores de la API de Proxmox
      if (error.response) {
          errorInfo.code = error.response.status;
          errorInfo.message = error.response.data?.errors?.join(', ') || error.message;
          
          // Errores comunes
          if (errorInfo.code === 401) {
              errorInfo.suggestion = 'Verify token/user permissions in Proxmox';
          } else if (errorInfo.code === 403) {
              errorInfo.suggestion = 'Check user role privileges';
          } else if (errorInfo.code === 595) {
              errorInfo.suggestion = process.env.NODE_ENV === 'production' 
                  ? 'Install valid SSL certificate' 
                  : 'Set NODE_ENV=development to allow self-signed certs';
          }
      } 
      // Errores de conexión
      else if (error.code === 'ECONNREFUSED') {
          errorInfo.code = 503;
          errorInfo.message = 'Connection refused';
          errorInfo.suggestion = 'Check Proxmox service and firewall rules';
      }

      console.error(`Hypervisor creation failed: ${errorInfo.message}`, {
          type,
          host: cleanHost,
          username,
          authMethod: apiToken ? 'token' : 'password',
          error: error.stack
      });

      res.status(errorInfo.code).json(errorInfo);
  }
});

// GET /api/hypervisors/:id - Get a single hypervisor by ID
app.get('/api/hypervisors/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  console.log(`GET /api/hypervisors/${id} called`);
  try {
    const result = await pool.query('SELECT id, name, type, host, username, status, last_sync, created_at, updated_at FROM hypervisors WHERE id = $1', [id]);
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(404).json({ error: 'Hypervisor not found' });
    }
  } catch (err) {
    console.error(`Error fetching hypervisor ${id}:`, err);
    res.status(500).json({ error: 'Failed to retrieve hypervisor' });
 
  }
});

// Función mejorada de manejo de errores
function getProxmoxError(error) {
  const response = {
      message: 'Proxmox API Error',
      code: 500,
      suggestion: 'Check network connection and credentials'
  };

  if (error.response) {
      // Manejar errores de la API de Proxmox
      response.code = error.response.status;
      
      if (error.response.data?.errors) {
          response.message = error.response.data.errors
              .map(err => err.message || err)
              .join(', ');
      }
      
      // Manejar códigos comunes
      if (response.code === 401) {
          response.message = 'Authentication failed';
          response.suggestion = 'Verify credentials/token permissions';
      }
      if (response.code === 403) {
          response.message = 'Permission denied';
          response.suggestion = 'Check user role privileges';
      }
      if (response.code === 595) {
          response.message = 'SSL certificate verification failed';
          response.suggestion = process.env.NODE_ENV === 'production' 
              ? 'Use valid SSL certificate' 
              : 'Set NODE_ENV=development to allow self-signed certs';
      }
  } else if (error.code === 'ECONNREFUSED') {
      response.message = 'Connection refused';
      response.code = 503;
      response.suggestion = 'Check if Proxmox is running and port is accessible';
  } else if (error.message) {
      response.message = error.message;
  }

  return response;
}

// PUT /api/hypervisors/:id - Update an existing hypervisor (example, frontend doesn't use this yet for general edits)
// Let's update it to allow changing name, host, username, api_token
app.put('/api/hypervisors/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  console.log(`PUT /api/hypervisors/${id} called with body:`, req.body);
  const { name, host, username, apiToken } = req.body; // Only allow updating these fields for now

  // Basic validation
  if (!name || !host || !username) {
      return res.status(400).json({ error: 'Missing required fields: name, host, username' });
  }

  try {
      const result = await pool.query(
          'UPDATE hypervisors SET name = $1, host = $2, username = $3, api_token = $4, updated_at = now() WHERE id = $5 RETURNING id, name, type, host, username, status, last_sync, created_at, updated_at',
          [name, host, username, apiToken || null, id]
      );

      if (result.rows.length > 0) {
          const updatedHypervisor = result.rows[0];
          console.log('Updated hypervisor in DB:', updatedHypervisor);
          res.json(updatedHypervisor);
      } else {
          res.status(404).json({ error: 'Hypervisor not found' });
      }
  } catch (err) {
      console.error(`Error updating hypervisor ${id} in DB:`, err);
      res.status(500).json({ error: 'Failed to update hypervisor' });
 
  }
});

// DELETE /api/hypervisors/:id - Delete a hypervisor
app.delete('/api/hypervisors/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  console.log(`DELETE /api/hypervisors/${id} called`);
  try {
    const result = await pool.query('DELETE FROM hypervisors WHERE id = $1 RETURNING id', [id]);
    if (result.rowCount > 0) {
      console.log(`Deleted hypervisor with id: ${id} from DB`);
      res.status(204).send(); // No Content success status
    } else {
      res.status(404).json({ error: 'Hypervisor not found' });
    }
  } catch (err) {
    console.error(`Error deleting hypervisor ${id} from DB:`, err);
    res.status(500).json({ error: 'Failed to delete hypervisor' });
  
  }
});

// POST /api/hypervisors/:id/connect - Versión Corregida
// Connect to hypervisor
app.post('/api/hypervisors/:id/connect', authenticate, async (req, res) => {
  const { id } = req.params;
  console.log(`POST /api/hypervisors/${id}/connect called`);
  try {
    const { rows: [hypervisor] } = await pool.query(
      `SELECT id, type, host, username, api_token, token_name 
       FROM hypervisors WHERE id = $1`,
      [id]
    );

    if (!hypervisor) return res.status(404).json({ error: 'Hypervisor not found' });

    let newStatus = 'error';
    let lastSync = null;
    console.log('Hypervisor:', hypervisor);


    if (hypervisor.type === 'proxmox') {
      // Parsear host y puerto desde la base de datos (asumiendo formato hostname:port)
      const [dbHost, dbPortStr] = hypervisor.host.split(':');
      const port = dbPortStr ? parseInt(dbPortStr, 10) : 8006; // Default a 8006 si no hay puerto
      const cleanHost = dbHost;
      console.log(`Attempting Proxmox connection to: ${cleanHost}:${port} (from DB value: ${hypervisor.host})`); // Add this log

      // Configuración del cliente Proxmox (similar a la ruta de creación)
      const proxmoxConfig = {
        host: cleanHost,
        port: port,
        username: hypervisor.username, // Necesario para el tokenID
        tokenID: `${hypervisor.username}!${hypervisor.token_name}`,
        tokenSecret: hypervisor.api_token,
        timeout: 15000,
        rejectUnauthorized: false // Mantener consistencia con la ruta de creación
      };

      // Crear cliente Proxmox usando proxmoxApi
      const proxmox = proxmoxApi(proxmoxConfig);

      // Verificar versión y permisos
      const versionResponse = await proxmox.version.$get();
      const pveVersion = versionResponse?.version; // Acceso directo basado en hallazgos anteriores
      console.log('Proxmox Version Check:', pveVersion);
      if (!pveVersion) {
        throw new Error('Failed to retrieve Proxmox version during connection test.');
      }

      // Verificar permisos del token
      // URL-encode username y token name para la ruta de la API
      const encodedUsername = encodeURIComponent(hypervisor.username);
      console.log('Encoded Username:', encodedUsername);
      const encodedTokenName = encodeURIComponent(hypervisor.token_name);
      console.log('Encoded Token Name:', encodedTokenName);
      console.log('Attempting to get token info...'); // Log antes de la llamada
      
      // Corrección: Usar /access/permissions para obtener los permisos del token actual
      // Esto evita necesitar permisos específicos sobre el usuario/token y solo requiere
      // que el token sea válido para consultar sus propios permisos.
      const permissionsInfo = await proxmox.access.permissions.$get();
      console.log('Successfully got permissions info:', permissionsInfo); // Log para verificar estructura

      // Ajustar la verificación de privilegios según la estructura real de tokenInfo
      // La respuesta de /access/permissions es un objeto donde las claves son rutas
      // y los valores son arrays de privilegios. Necesitamos verificar si 'VM.Allocate'
      // existe como *clave* en alguno de los objetos de permisos asociados a las rutas.
      const hasRequiredPrivilege = Object.values(permissionsInfo || {}).some(
          // Corrección: Verificar si el objeto de permisos tiene la clave 'VM.Allocate'
          (privsObject) => typeof privsObject === 'object' && privsObject !== null && privsObject.hasOwnProperty('VM.Allocate')
      );
console.log('Has VM.Allocate privilege:', hasRequiredPrivilege); // Log para verificar privilegios
      if (!hasRequiredPrivilege) {
        console.warn('Permissions structure:', permissionsInfo); // Log si la estructura es inesperada o falta el permiso
        throw new Error('Token lacks required VM.Allocate privilege or privileges could not be verified.');
      }
      
      newStatus = 'connected';
      lastSync = new Date();
      console.log(`Successfully connected and verified permissions for ${hypervisor.username} on ${cleanHost}:${port}`);
    }

    // Actualizar estado
    const { rows: [updatedHypervisor] } = await pool.query(
      `UPDATE hypervisors 
       SET status = $1, last_sync = $2, updated_at = NOW() 
       WHERE id = $3 RETURNING *`,
      [newStatus, lastSync, id]
    );

    res.json({ status: newStatus, lastSync });
    console.log(`Updated hypervisor ${id} status to ${newStatus}`);

  } catch (err) {
    const errorDetails = getProxmoxError(err);
    console.error(`Connection attempt failed for hypervisor ${id}: ${errorDetails.message}`, { stack: err.stack });
    res.status(500).json({
      error: errorDetails.message,
      code: errorDetails.code,
      suggestion: errorDetails.suggestion
    });
  }
});

// --- VM Plan CRUD API Routes ---

// GET /api/vm-plans - List all VM plans
app.get('/api/vm-plans', authenticate, async (req, res) => {
  console.log('--- GET /api/vm-plans ---');
  try {
    const result = await pool.query(
      'SELECT id, name, description, specs, icon, is_active, created_at, updated_at FROM vm_plans ORDER BY created_at ASC'
    );
    console.log(`Found ${result.rows.length} VM plans`);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching VM plans from DB:', err);
    res.status(500).json({ error: 'Failed to retrieve VM plans' });
  }
});

// POST /api/vm-plans - Create a new VM plan
app.post('/api/vm-plans', authenticate, async (req, res) => {
  console.log('--- POST /api/vm-plans --- Body:', req.body);
  const { name, description, specs, icon, is_active = true } = req.body;

  // Basic Validation
  if (!name || !description || !specs || !specs.cpu || !specs.memory || !specs.disk) {
    return res.status(400).json({ error: 'Missing required plan fields: name, description, specs (cpu, memory, disk)' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO vm_plans (name, description, specs, icon, is_active) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, name, description, specs, icon, is_active, created_at, updated_at`,
      [name, description, JSON.stringify(specs), icon || null, is_active]
    );
    console.log('Created new VM plan:', result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating VM plan in DB:', err);
    res.status(500).json({ error: 'Failed to create VM plan' });
  }
});

// PUT /api/vm-plans/:id - Update a VM plan (specifically isActive status)
app.put('/api/vm-plans/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;
  console.log(`--- PUT /api/vm-plans/${id} --- Body:`, req.body);

  if (typeof is_active !== 'boolean') {
    return res.status(400).json({ error: 'Invalid request body: isActive (boolean) is required.' });
  }

  try {
    const result = await pool.query(
      'UPDATE vm_plans SET is_active = $1, updated_at = now() WHERE id = $2 RETURNING id, name, description, specs, icon, is_active, created_at, updated_at',
      [is_active, id]
    );

    if (result.rows.length > 0) {
      console.log('Updated VM plan:', result.rows[0]);
      res.json(result.rows[0]);
    } else {
      res.status(404).json({ error: 'VM Plan not found' });
    }
  } catch (err) {
    console.error(`Error updating VM plan ${id} in DB:`, err);
    res.status(500).json({ error: 'Failed to update VM plan' });
  }
});

// DELETE /api/vm-plans/:id - Delete a VM plan
app.delete('/api/vm-plans/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  console.log(`--- DELETE /api/vm-plans/${id} ---`);
  try {
    const result = await pool.query('DELETE FROM vm_plans WHERE id = $1 RETURNING id', [id]);
    if (result.rowCount > 0) {
      console.log(`Deleted VM plan with id: ${id} from DB`);
      res.status(204).send(); // No Content success status
    } else {
      res.status(404).json({ error: 'VM Plan not found' });
    }
  } catch (err) {
    console.error(`Error deleting VM plan ${id} from DB:`, err);
    res.status(500).json({ error: 'Failed to delete VM plan' });
  }
});


// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});