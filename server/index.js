import express from 'express';
import cors from 'cors';
import pg from 'pg';
import https from 'https'; // Needed for custom agent for direct vSphere calls (fallback)
import dotenv from 'dotenv';
import Proxmox, { proxmoxApi } from 'proxmox-api';
import bcrypt from 'bcrypt';
import { constants as cryptoConstants } from 'crypto';
import jwt from 'jsonwebtoken';
// import fetch from 'node-fetch'; // Asegúrate de tener node-fetch si usas Node < 18 o si fetch no está global

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;
const { Pool } = pg;
const pool = new Pool({
  connectionString: `postgres://${process.env.VITE_POSTGRES_USER}:${process.env.VITE_POSTGRES_PASSWORD}@${process.env.VITE_POSTGRES_HOST}:${process.env.VITE_POSTGRES_PORT}/${process.env.VITE_POSTGRES_DB}`,
});

app.use(cors());
app.use(express.json());

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // Para fallback a vSphere REST API directa

// --- URL del Microservicio Python ---
const PYVMOMI_MICROSERVICE_URL = process.env.PYVMOMI_MICROSERVICE_URL || 'http://localhost:5000';

// --- Helper para llamar al microservicio PyVmomi ---
async function callPyvmomiService(method, path, hypervisor, body = null) {
  const { host: vsphereHost, username: vsphereUser, api_token: vspherePassword } = hypervisor; // api_token es la contraseña para vSphere

  if (!vsphereHost || !vsphereUser || !vspherePassword) {
    throw new Error('Missing vSphere connection credentials for PyVmomi microservice call.');
  }

  const options = {
    method,
    headers: {},
  };

  let url = `${PYVMOMI_MICROSERVICE_URL}${path}`;

  if (method === 'GET') {
    const queryParams = new URLSearchParams({
      host: vsphereHost.split(':')[0], // Enviar solo el hostname
      user: vsphereUser,
      password: vspherePassword,
    });
    url += `?${queryParams.toString()}`;
  } else if (body || method === 'POST') { // Asegurar que POST siempre tenga Content-Type
    options.headers['Content-Type'] = 'application/json';
    // Para POST, las credenciales van en el body según app.py
    const requestBody = {
      ...body, // Incluir el cuerpo original de la solicitud
      host: vsphereHost.split(':')[0],
      user: vsphereUser,
      password: vspherePassword,
    };
    options.body = JSON.stringify(requestBody);
  }
  console.log(`Calling PyVmomi microservice: ${method} ${url}`);
  if (options.body) console.log(`PyVmomi microservice body: ${options.body.substring(0,200)}...`);


  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      let errorText = '';
      let errorJson = null;
      try {
        // Try to read the error response body as text
        errorText = await response.text();
        if (errorText) {
          // If there's text, try to parse it as JSON
          try {
            errorJson = JSON.parse(errorText);
          } catch (parseError) {
            // Not JSON or malformed JSON. errorText will be used.
            console.warn(`PyVmomi error response (status ${response.status}) was not valid JSON:`, errorText.substring(0, 200));
          }
        }
      } catch (readError) {
        // Failed to read the error response body at all
        console.error(`Failed to read error response body from PyVmomi (status ${response.status}):`, readError);
        errorText = response.statusText; // Fallback to status text
      }

      // Determine the most relevant error message
      const errorMessage = errorJson?.error || errorJson?.message || errorText || response.statusText;
      console.error(`PyVmomi microservice error: ${response.status}`, errorMessage);
      const err = new Error(`PyVmomi microservice request failed with status ${response.status}: ${errorMessage}`);
      err.status = response.status;
      err.details = errorJson || { error: errorText || "Failed to retrieve error details" };
      throw err;
    }

    // Handle 204 No Content for successful responses
    if (response.status === 204) {
        return null; // No body to parse
    }

    // For other successful responses (2xx), read body as text then parse as JSON
    const successText = await response.text();
    if (!successText && response.status !== 204) { // Handle empty successful response if that's possible and not 204
        console.warn(`PyVmomi successful response (status ${response.status}) had an empty body.`);
        return {}; // Or null, or an empty array, depending on expected successful empty body
    }
    return JSON.parse(successText); // Parse the text as JSON
  } catch (error) {
    console.error('Error calling PyVmomi microservice:', error.message);
    if (!error.status) error.status = 503; // Service Unavailable si no se pudo conectar
    if (!error.details) error.details = { error: error.message };
    throw error; // Re-throw para que la ruta lo maneje
  }
}


// --- Authentication Middleware ---
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      console.log('Auth middleware: Invalid token', err.message);
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Unauthorized: Token expired' });
      }
      return res.status(403).json({ error: 'Forbidden: Invalid token' });
    }
    req.user = user;
    next();
  });
};

// --- Role-Based Access Control Middleware ---
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    console.log('RequireAdmin: Access denied for user:', req.user?.userId, 'Role:', req.user?.role);
    return res.status(403).json({ error: 'Forbidden: Admin privileges required' });
  }
  next();
};

// --- Authentication Routes ---
app.post('/api/auth/login', async (req, res) => {
  console.log('--- HIT /api/auth/login ---');
  const { email, password } = req.body;
  console.log(`Login attempt for email: ${email}`);

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const userResult = await pool.query(
      `SELECT u.id, u.username, u.email, u.password_hash, u.is_active, r.name as role_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.email = $1`,
      [email]
    );

    const user = userResult.rows[0];

    if (!user) {
      console.log(`Login failed: User not found for email ${email}`);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!user.is_active) {
      console.log(`Login failed: User ${email} is inactive`);
      return res.status(403).json({ error: 'Account is inactive' });
    }

    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      console.log(`Login failed: Incorrect password for email ${email}`);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const payload = {
      userId: user.id,
      username: user.username,
      email: user.email,
      role: user.role_name
    };
    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });

    console.log(`Login successful for ${email}. Role: ${user.role_name}`);
    res.json({ accessToken, user: { id: user.id, username: user.username, email: user.email, role: user.role_name } });

  } catch (error) {
    console.error('Login process error:', error);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

// --- User Management Routes (Admin Only) ---
app.post('/api/users', authenticate, requireAdmin, async (req, res) => {
  const { username, email, password, role_name = 'user', is_active = true } = req.body;
  console.log(`--- POST /api/users --- Creating user: ${email}, Role: ${role_name}`);

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email, and password are required' });
  }
  if (!['admin', 'user', 'viewer'].includes(role_name)) {
    return res.status(400).json({ error: 'Invalid role specified. Must be admin, user, or viewer.' });
  }

  try {
    const roleResult = await pool.query('SELECT id FROM roles WHERE name = $1', [role_name]);
    if (roleResult.rows.length === 0) {
      return res.status(400).json({ error: `Role '${role_name}' not found in database.` });
    }
    const roleId = roleResult.rows[0].id;

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const insertResult = await pool.query(
      `INSERT INTO users (username, email, password_hash, role_id, is_active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, email, role_id, is_active, created_at, updated_at`,
      [username, email, passwordHash, roleId, is_active]
    );

    const newUser = insertResult.rows[0];
    newUser.role_name = role_name;
    delete newUser.role_id;

    console.log('Successfully created user:', newUser);
    res.status(201).json(newUser);

  } catch (error) {
    console.error('Error creating user:', error);
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Email or username already exists.' });
    }
    res.status(500).json({ error: 'Failed to create user.' });
  }
});

app.put('/api/users/:id', authenticate, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { username, email, role_name, is_active } = req.body;

  console.log(`--- PUT /api/users/${id} --- Updating user: ${email}, Role: ${role_name}, Active: ${is_active}`);

  if (!username || !email) {
    return res.status(400).json({ error: 'Username and email are required' });
  }
  if (role_name && !['admin', 'user', 'viewer'].includes(role_name)) {
    return res.status(400).json({ error: 'Invalid role specified. Must be admin, user, or viewer.' });
  }
  if (typeof is_active !== 'boolean') {
    return res.status(400).json({ error: 'is_active must be a boolean value.' });
  }

  try {
    let roleId = null;
    if (role_name) {
      const roleResult = await pool.query('SELECT id FROM roles WHERE name = $1', [role_name]);
      if (roleResult.rows.length === 0) {
        return res.status(400).json({ error: `Role '${role_name}' not found.` });
      }
      roleId = roleResult.rows[0].id;
    }

    const updates = [];
    const values = [];
    let valueIndex = 1;

    updates.push(`username = $${valueIndex++}`); values.push(username);
    updates.push(`email = $${valueIndex++}`); values.push(email);
    if (roleId) { updates.push(`role_id = $${valueIndex++}`); values.push(roleId); }
    updates.push(`is_active = $${valueIndex++}`); values.push(is_active);
    updates.push(`updated_at = now()`);

    values.push(id);

    const updateQuery = `UPDATE users SET ${updates.join(', ')} WHERE id = $${valueIndex} RETURNING id, username, email, role_id, is_active, created_at, updated_at`;

    const result = await pool.query(updateQuery, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updatedUser = result.rows[0];
    updatedUser.role_name = role_name || (await pool.query('SELECT name FROM roles WHERE id = $1', [updatedUser.role_id])).rows[0]?.name;
    delete updatedUser.role_id;

    console.log('Successfully updated user:', updatedUser);
    res.json(updatedUser);

  } catch (error) {
    console.error(`Error updating user ${id}:`, error);
    if (error.code === '23505') return res.status(409).json({ error: 'Email or username already exists.' });
    res.status(500).json({ error: 'Failed to update user.' });
  }
});

app.get('/api/users', authenticate, requireAdmin, async (req, res) => {
  console.log('--- GET /api/users ---');
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.email, u.is_active, r.name as role_name, u.created_at, u.updated_at
       FROM users u
       JOIN roles r ON u.role_id = r.id
       ORDER BY u.created_at DESC`
    );
    console.log(`Found ${result.rows.length} users`);
    const users = result.rows.map(dbUser => ({
      id: dbUser.id,
      username: dbUser.username,
      email: dbUser.email,
      role: dbUser.role_name,
      is_active: dbUser.is_active,
    }));
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to retrieve users' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// vSphere API routes (Placeholder, to be potentially replaced by PyVmomi calls)
app.get('/api/vsphere/datacenters', authenticate, (req, res) => {
  // TODO: PYVMOMI: Implement with PyVmomi microservice if needed, or remove if not used.
  console.warn("Placeholder endpoint /api/vsphere/datacenters hit. Consider PyVmomi or removal.");
  res.json([
    { id: 'datacenter-1', name: 'Main Datacenter (Placeholder)' }
  ]);
});


// POST /api/vms - Create a new VM
app.post('/api/vms', authenticate, async (req, res) => {
  const params = req.body;
  console.log('--- Received POST /api/vms --- Params:', params);

  if (!params.name || !params.hypervisorId || !params.specs?.cpu || !params.specs?.memory || !params.specs?.disk || !params.templateId) {
    return res.status(400).json({ error: 'Missing required VM parameters (name, hypervisorId, specs, templateId).' });
  }

  try {
    const { rows: [hypervisor] } = await pool.query(
      `SELECT id, type, host, username, api_token, token_name, status, name as hypervisor_name, vsphere_subtype
       FROM hypervisors WHERE id = $1`,
      [params.hypervisorId]
    );

    if (!hypervisor) {
      return res.status(404).json({ error: 'Target hypervisor not found' });
    }
    if (hypervisor.status !== 'connected') {
      return res.status(409).json({ error: 'Target hypervisor is not connected' });
    }

    let creationResult = null;
    let newVmId = null; // This will be Proxmox VMID or vSphere UUID/MOID
    let targetNode = null;

    if (hypervisor.type === 'proxmox') {
      // ... (Proxmox VM Creation Logic - Mantenida como estaba)
      const [dbHost, dbPortStr] = hypervisor.host.split(':');
      const port = dbPortStr ? parseInt(dbPortStr, 10) : 8006;
      const cleanHost = dbHost;
      const isIso = params.templateId.includes(':iso/');

      const proxmoxConfig = {
        host: cleanHost, port: port, username: hypervisor.username,
        tokenID: `${hypervisor.username}!${hypervisor.token_name}`,
        tokenSecret: hypervisor.api_token, timeout: 30000, rejectUnauthorized: false
      };
      const proxmox = proxmoxApi(proxmoxConfig);

      targetNode = params.nodeName;
      if (!targetNode) {
        const nodes = await proxmox.nodes.$get();
        if (!nodes || nodes.length === 0) throw new Error('No nodes found on hypervisor');
        targetNode = nodes[0].node;
        console.log(`No node specified, defaulting to first node: ${targetNode}`);
      }

      const nextIdResult = await proxmox.cluster.nextid.$get();
      newVmId = nextIdResult.toString();

      if (isIso) {
        const sanitizedName = params.name.replace(/\s+/g, '-');
        const createParams = {
          vmid: newVmId, node: targetNode, name: sanitizedName,
          cores: params.specs.cpu, memory: params.specs.memory,
          description: params.description || '', tags: params.tags?.join(';') || '',
          scsi0: `local-lvm:${params.specs.disk}`,
          ide2: `${params.templateId},media=cdrom`, boot: 'order=ide2;scsi0',
          net0: 'virtio,bridge=vmbr0', scsihw: 'virtio-scsi-pci', ostype: 'l26',
        };
        console.log(`Attempting to create Proxmox VM ${newVmId} from ISO on node ${targetNode} with params:`, createParams);
        creationResult = await proxmox.nodes.$(targetNode).qemu.$post(createParams);
      } else {
        const templateVmIdToClone = params.templateId;
        const sanitizedName = params.name.replace(/\s+/g, '-');
        const cloneParams = {
          newid: newVmId, name: sanitizedName, full: 1,
          cores: params.specs.cpu, memory: params.specs.memory,
          description: params.description || '', tags: params.tags?.join(';') || '',
        };
        console.log(`Attempting to clone Proxmox template VM ${templateVmIdToClone} to new VM ${newVmId} on node ${targetNode} with params:`, cloneParams);
        creationResult = await proxmox.nodes.$(targetNode).qemu.$(templateVmIdToClone).clone.$post(cloneParams);
      }

      if (params.start && creationResult) {
        console.log(`Starting Proxmox VM ${newVmId}...`);
        await proxmox.nodes.$(targetNode).qemu.$(newVmId).status.start.$post();
      }
    } else if (hypervisor.type === 'vsphere') {
      console.log(`Attempting to create VM on vSphere via PyVmomi microservice: ${params.name}`);
      // TODO: PYVMOMI: Implement '/vms/create' (or similar) endpoint in app.py
      // This endpoint would need to handle cloning from template or creating from ISO,
      // placement (datastore, host, resource pool), hardware customization, power on.
      try {
        const pyVmomiCreateParams = {
            name: params.name,
            template_id: params.templateId, // Could be template UUID or ISO path (e.g., "[datastoreName] ISOs/image.iso")
            specs: params.specs, // cpu, memory, disk
            description: params.description,
            tags: params.tags,
            start_vm: params.start || false,
            // Potentially add placement details if known:
            // datastore_name: params.datastoreName,
            // host_name: params.nodeName, // if nodeName is ESXi host for vCenter
            // resource_pool_name: params.resourcePoolName,
        };
        // Asumimos que el microservicio devuelve el UUID de la nueva VM o un ID de tarea
        const responseFromPyvmomi = await callPyvmomiService('POST', '/vms/create', hypervisor, pyVmomiCreateParams);
        newVmId = responseFromPyvmomi.vm_uuid || responseFromPyvmomi.task_id || responseFromPyvmomi.id; // Adapt based on actual microservice response
        creationResult = responseFromPyvmomi.task_id || newVmId; // Task ID or new VM ID
        console.log(`vSphere VM creation initiated via PyVmomi, response:`, responseFromPyvmomi);

      } catch (pyVmomiError) {
        console.error('PyVmomi microservice VM creation error:', pyVmomiError);
        return res.status(pyVmomiError.status || 500).json({
          error: 'Failed to create VM on vSphere via PyVmomi microservice.',
          details: pyVmomiError.details || pyVmomiError.message,
        });
      }
    }

    if (newVmId && creationResult) {
      console.log(`Inserting VM record into database for VMID: ${newVmId}`);
      console.log('User ID for DB insert:', req.user?.userId);
      try {
        const insertQuery = `INSERT INTO virtual_machines (name, description, hypervisor_id, hypervisor_vm_id, status, cpu_cores, memory_mb, disk_gb, ticket, final_client_id, created_by_user_id, os)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING id`;
        const insertParams = [
            params.name, params.description || null, params.hypervisorId,
            newVmId, 'creating', params.specs.cpu, params.specs.memory, params.specs.disk,
            params.ticket || null, params.finalClientId || null, req.user.userId,
            params.specs.os || null,
        ];
        const insertResult = await pool.query(insertQuery, insertParams);
        console.log(`Successfully inserted VM record with DB ID: ${insertResult.rows[0].id}`);
      } catch (dbError) {
        console.error('Error inserting VM record into database after creation:', dbError);
      }
    }

    res.status(202).json({
      id: newVmId, status: 'creating',
      message: `VM creation initiated for ${params.name} (ID: ${newVmId}). Task ID: ${creationResult}`,
      taskId: creationResult
    });

  } catch (error) {
    console.error('Error creating VM:', error);
    const errorDetails = getProxmoxError(error); // getProxmoxError might need adjustment for generic errors
    res.status(errorDetails.code || 500).json({
      error: 'Failed to create VM.',
      details: errorDetails.message,
      suggestion: errorDetails.suggestion
    });
  }
});


// POST /api/vms/:id/action - Implement real actions
app.post('/api/vms/:id/action', authenticate, async (req, res) => {
  const { id: vmExternalId } = req.params; // This is Proxmox vmid or vSphere UUID
  const { action } = req.body;

  console.log(`--- Received POST /api/vms/${vmExternalId}/action --- Action: ${action}`);

  if (!['start', 'stop', 'restart'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action specified.' });
  }

  let targetHypervisor = null;
  let targetNode = null; // For Proxmox
  let proxmoxClientInstance = null;
  // No vsphereClientInstance needed here, PyVmomi microservice handles its own client

  try {
    // --- Step 1: Find the VM's Hypervisor (from DB, assuming vmExternalId is hypervisor_vm_id) ---
    // This logic assumes vmExternalId is unique enough across hypervisors or we fetch the VM from DB first
    // For simplicity, we'll iterate through connected hypervisors and try to find the VM.
    // A more robust way would be to query `virtual_machines` table by `hypervisor_vm_id`.
    const { rows: connectedHypervisors } = await pool.query(
      `SELECT id, type, host, username, api_token, token_name, name as hypervisor_name, vsphere_subtype
       FROM hypervisors WHERE status = 'connected'`
    );

    let vmFoundOnHypervisor = false;

    for (const hypervisor of connectedHypervisors) {
      if (hypervisor.type === 'proxmox') {
        // ... (Proxmox VM finding logic - Mantenida como estaba)
        const [dbHost, dbPortStr] = hypervisor.host.split(':');
        const port = dbPortStr ? parseInt(dbPortStr, 10) : 8006;
        const cleanHost = dbHost;
        const proxmoxConfig = {
          host: cleanHost, port: port, username: hypervisor.username,
          tokenID: `${hypervisor.username}!${hypervisor.token_name}`,
          tokenSecret: hypervisor.api_token, timeout: 10000, rejectUnauthorized: false
        };
        proxmoxClientInstance = proxmoxApi(proxmoxConfig);
        try {
          const vmResources = await proxmoxClientInstance.cluster.resources.$get({ type: 'vm' });
          const foundVm = vmResources.find(vm => vm.vmid.toString() === vmExternalId);
          if (foundVm) {
            targetHypervisor = hypervisor;
            targetNode = foundVm.node;
            vmFoundOnHypervisor = true;
            console.log(`Found Proxmox VM ${vmExternalId} on node ${targetNode} of hypervisor ${hypervisor.id} for action`);
            break;
          }
        } catch (findError) {
          console.warn(`Could not check Proxmox hypervisor ${hypervisor.id} for VM ${vmExternalId} action:`, findError.message);
        }
      } else if (hypervisor.type === 'vsphere') {
        // For vSphere, we assume vmExternalId is the UUID.
        // The PyVmomi microservice will confirm if the VM exists.
        // We just need to identify that this is the target hypervisor.
        // A better approach: query DB for the VM by hypervisor_vm_id to get its hypervisor_id directly.
        // For now, if we *think* it's vSphere, we'll try.
        // This part is tricky without a DB lookup for the VM first.
        // Let's assume for now the frontend somehow knows which hypervisor the vSphere VM belongs to,
        // or we modify this to first query the DB for the VM.
        // For this example, we'll assume if a vSphere hypervisor is iterated, we try with it.
        // This needs refinement for a multi-hypervisor vSphere setup.
        // A simple check: if vmExternalId looks like a UUID (common for vSphere VMs from PyVmomi)
        if (vmExternalId.length === 36 && vmExternalId.includes('-')) { // Basic UUID check
            console.log(`Attempting vSphere action for VM UUID ${vmExternalId} on hypervisor ${hypervisor.id}`);
            targetHypervisor = hypervisor;
            vmFoundOnHypervisor = true; // Assume we'll try with this hypervisor
            break;
        }
      }
    }

    if (!vmFoundOnHypervisor || !targetHypervisor) {
      return res.status(404).json({ error: `VM ${vmExternalId} not found on any suitable connected hypervisor.` });
    }

    // --- Step 2: Perform the action ---
    let resultMessage = `Action '${action}' initiated for VM ${vmExternalId}.`;
    let taskId = null;

    if (targetHypervisor.type === 'proxmox') {
      // ... (Proxmox action logic - Mantenida como estaba)
      const vmPath = proxmoxClientInstance.nodes.$(targetNode).qemu.$(vmExternalId).status;
      console.log(`Performing Proxmox action '${action}' on VM ${vmExternalId} at ${targetNode}...`);
      let proxmoxResult;
      switch (action) {
        case 'start': proxmoxResult = await vmPath.start.$post(); break;
        case 'stop': proxmoxResult = await vmPath.stop.$post(); break;
        case 'restart': proxmoxResult = await vmPath.reboot.$post(); break;
        default: throw new Error('Invalid action');
      }
      taskId = proxmoxResult;
      resultMessage = `Proxmox action '${action}' initiated for VM ${vmExternalId}. Task ID: ${taskId}`;
      console.log(`Proxmox action '${action}' result for VM ${vmExternalId}:`, taskId);
    } else if (targetHypervisor.type === 'vsphere') {
      console.log(`Performing vSphere action '${action}' on VM ${vmExternalId} via PyVmomi microservice...`);
      let pyvmomiAction = '';
      if (action === 'start') pyvmomiAction = 'on';
      else if (action === 'stop') pyvmomiAction = 'off';
      else if (action === 'restart') {
        // PyVmomi microservice app.py doesn't have 'restart'.
        // We can simulate it by calling 'off' then 'on', or add 'restart' to app.py
        // For now, let's just map to 'reset' if app.py supports it, or error.
        // Current app.py only has 'on'/'off'.
        // TODO: PYVMOMI: Add 'restart' or 'reset' to app.py power endpoint.
        // For now, we'll send 'off' then 'on' if action is 'restart'
         if (action === 'restart') {
            console.log(`Simulating restart for vSphere VM ${vmExternalId}: power off then power on.`);
            await callPyvmomiService('POST', `/vm/${vmExternalId}/power`, targetHypervisor, { action: 'off' });
            // Add a small delay before powering on if necessary
            // await new Promise(resolve => setTimeout(resolve, 2000)); 
            await callPyvmomiService('POST', `/vm/${vmExternalId}/power`, targetHypervisor, { action: 'on' });
            resultMessage = `vSphere VM ${vmExternalId} restart (off/on) action initiated via PyVmomi.`;
        } else {
            // This will be 'on' or 'off'
            await callPyvmomiService('POST', `/vm/${vmExternalId}/power`, targetHypervisor, { action: pyvmomiAction });
            resultMessage = `vSphere VM ${vmExternalId} ${action} action initiated via PyVmomi.`;
        }
        // PyVmomi microservice currently returns {status: 'success'} or error, not a task ID.
        console.log(`vSphere action '${action}' for VM ${vmExternalId} completed via PyVmomi.`);
      }
    }

    res.json({
      id: vmExternalId, status: 'pending',
      message: resultMessage, taskId: taskId
    });

  } catch (error) {
    console.error(`Error performing action '${action}' on VM ${vmExternalId}:`, error);
    let errorDetails;
    if (targetHypervisor?.type === 'proxmox') {
        errorDetails = getProxmoxError(error);
    } else if (targetHypervisor?.type === 'vsphere') {
        errorDetails = { 
            code: error.status || 500, 
            message: error.details?.error || error.message || `Failed to perform vSphere action '${action}' on VM ${vmExternalId} via PyVmomi.`
        };
    } else {
        errorDetails = { code: 500, message: error.message || `Failed to perform action '${action}' on VM ${vmExternalId}` };
    }
    res.status(errorDetails.code || 500).json({
      error: `Failed to perform action '${action}' on VM ${vmExternalId}.`,
      details: errorDetails.message,
      suggestion: errorDetails.suggestion
    });
  }
});


// GET /api/vms - List VMs from all connected hypervisors
app.get('/api/vms', authenticate, async (req, res) => {
  console.log('--- Received GET /api/vms ---');
  let allVms = [];

  try {
    const { rows: connectedHypervisors } = await pool.query(
      `SELECT id, type, host, username, api_token, token_name, name as hypervisor_name, vsphere_subtype
       FROM hypervisors WHERE status = 'connected'`
    );
    console.log(`Found ${connectedHypervisors.length} connected hypervisors.`);

    for (const hypervisor of connectedHypervisors) {
      console.log(`Fetching VMs from ${hypervisor.type} hypervisor: ${hypervisor.host} (ID: ${hypervisor.id})`);
      try {
        if (hypervisor.type === 'proxmox') {
          // ... (Proxmox VM listing logic - Mantenida como estaba)
          const [dbHost, dbPortStr] = hypervisor.host.split(':');
          const port = dbPortStr ? parseInt(dbPortStr, 10) : 8006;
          const cleanHost = dbHost;
          const proxmoxConfig = {
            host: cleanHost, port: port, username: hypervisor.username,
            tokenID: `${hypervisor.username}!${hypervisor.token_name}`,
            tokenSecret: hypervisor.api_token, timeout: 10000, rejectUnauthorized: false
          };
          const proxmox = proxmoxApi(proxmoxConfig);
          const vmResources = await proxmox.cluster.resources.$get({ type: 'vm' });
          const proxmoxVms = vmResources.map((vm) => ({
            id: vm.vmid.toString(), name: vm.name, status: vm.status, nodeName: vm.node,
            specs: {
              cpu: vm.maxcpu, memory: Math.round(vm.maxmem / (1024 * 1024)),
              disk: Math.round(vm.maxdisk / (1024 * 1024 * 1024)),
            },
            hypervisorType: 'proxmox', hypervisorId: hypervisor.id, createdAt: new Date(),
          }));
          allVms = allVms.concat(proxmoxVms);
        } else if (hypervisor.type === 'vsphere') {
          console.log(`Fetching VMs from vSphere hypervisor ${hypervisor.id} via PyVmomi microservice`);
          try {
            const pyvmomiVmsRaw = await callPyvmomiService('GET', '/vms', hypervisor);
            if (Array.isArray(pyvmomiVmsRaw)) {
              const vsphereVms = pyvmomiVmsRaw.map(vm => ({
                id: vm.uuid, // Use UUID from PyVmomi as the primary ID
                name: vm.name,
                status: vm.power_state === 'poweredOn' ? 'running' : (vm.power_state === 'poweredOff' ? 'stopped' : vm.power_state.toLowerCase()),
                nodeName: hypervisor.hypervisor_name, // Simplified, actual ESXi host per VM needs more detail from PyVmomi
                specs: {
                  cpu: vm.cpu_count || 0,
                  memory: vm.memory_mb || 0,
                  disk: vm.disk_gb || 0,
                  os: vm.guest_os,
                },
                hypervisorType: 'vsphere',
                hypervisorId: hypervisor.id,
                createdAt: new Date(), // Placeholder, PyVmomi might provide creation date
                // Nuevos campos para vSphere
                hostname: vm.hostname,
                vmware_tools_status: vm.vmware_tools_status,
                ipAddress: vm.ip_address, // Asegurarse que el listado también lo devuelva si es necesario para la card
              }));
              allVms = allVms.concat(vsphereVms);
              console.log(`Fetched ${vsphereVms.length} VMs from vSphere ${hypervisor.host} via PyVmomi`);
            } else {
              console.warn(`Unexpected response for vSphere VMs from PyVmomi microservice for ${hypervisor.host}:`, pyvmomiVmsRaw);
            }
          } catch (pyVmomiError) {
            console.error(`Error fetching VMs from vSphere ${hypervisor.id} via PyVmomi:`, pyVmomiError.details?.error || pyVmomiError.message);
          }
        }
      } catch (hypervisorError) {
        console.error(`Error fetching VMs from hypervisor ${hypervisor.id} (${hypervisor.host}):`, hypervisorError.message);
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
  const { id: vmExternalId } = req.params; // Proxmox vmid or vSphere UUID
  console.log(`--- Received GET /api/vms/${vmExternalId} ---`);

  let targetHypervisor = null;
  let targetNode = null; // For Proxmox
  let proxmoxClientInstance = null;

  try {
    // --- Step 1: Find the VM's Hypervisor (Iterate or DB lookup) ---
    // Similar to POST /action, this needs a robust way to find the VM's hypervisor.
    // For now, iterate and attempt.
    const { rows: connectedHypervisors } = await pool.query(
      `SELECT id, type, host, username, api_token, token_name, name as hypervisor_name, vsphere_subtype
       FROM hypervisors WHERE status = 'connected'`
    );

    let vmFoundOnHypervisor = false;
    for (const hypervisor of connectedHypervisors) {
      if (hypervisor.type === 'proxmox') {
        // ... (Proxmox VM finding logic - Mantenida como estaba)
        const [dbHost, dbPortStr] = hypervisor.host.split(':');
        const port = dbPortStr ? parseInt(dbPortStr, 10) : 8006;
        const cleanHost = dbHost;
        const proxmoxConfig = {
          host: cleanHost, port: port, username: hypervisor.username,
          tokenID: `${hypervisor.username}!${hypervisor.token_name}`,
          tokenSecret: hypervisor.api_token, timeout: 10000, rejectUnauthorized: false
        };
        proxmoxClientInstance = proxmoxApi(proxmoxConfig);
        try {
          const vmResources = await proxmoxClientInstance.cluster.resources.$get({ type: 'vm' });
          const foundVm = vmResources.find(vm => vm.vmid.toString() === vmExternalId);
          if (foundVm) {
            targetHypervisor = hypervisor;
            targetNode = foundVm.node;
            vmFoundOnHypervisor = true;
            console.log(`Found Proxmox VM ${vmExternalId} on node ${targetNode} of hypervisor ${hypervisor.id}`);
            break;
          }
        } catch (findError) { /* ignore */ }
      } else if (hypervisor.type === 'vsphere') {
        // Assume vmExternalId is UUID for vSphere
        if (vmExternalId.length === 36 && vmExternalId.includes('-')) {
            targetHypervisor = hypervisor;
            vmFoundOnHypervisor = true;
            console.log(`Attempting to get details for vSphere VM UUID ${vmExternalId} on hypervisor ${hypervisor.id}`);
            break;
        }
      }
    }

    if (!vmFoundOnHypervisor || !targetHypervisor) {
      return res.status(404).json({ error: `VM ${vmExternalId} not found on any suitable connected hypervisor.` });
    }

    // --- Step 2: Get VM Config and Current Status ---
    let vmDetails;

    if (targetHypervisor.type === 'proxmox') {
      // ... (Proxmox VM details logic - Mantenida como estaba)
      const vmConfig = await proxmoxClientInstance.nodes.$(targetNode).qemu.$(vmExternalId).config.$get();
      const vmStatus = await proxmoxClientInstance.nodes.$(targetNode).qemu.$(vmExternalId).status.current.$get();
      vmDetails = {
        id: vmExternalId, name: vmConfig.name, description: vmConfig.description || '',
        hypervisorId: targetHypervisor.id, hypervisorType: 'proxmox', nodeName: targetNode,
        status: vmStatus.status,
        specs: {
          cpu: vmConfig.cores * (vmConfig.sockets || 1),
          memory: Math.round(vmConfig.memory / (1024 * 1024)), // MB
          disk: Math.round((await proxmoxClientInstance.nodes.$(targetNode).qemu.$(vmExternalId).config.$get()).maxdisk / (1024 * 1024 * 1024)), // GB, re-fetch for maxdisk
          os: vmConfig.ostype,
        },
        createdAt: new Date(vmStatus.uptime ? Date.now() - (vmStatus.uptime * 1000) : Date.now()),
        tags: vmConfig.tags ? vmConfig.tags.split(';') : [],
      };
    } else if (targetHypervisor.type === 'vsphere') {
      console.log(`Fetching details for vSphere VM ${vmExternalId} via PyVmomi microservice`);
      // TODO: PYVMOMI: Implement '/vm/<vm_uuid>/details' endpoint in app.py
      // This endpoint should return comprehensive details: name, power_state, guest_os, ip, uuid,
      // cpu_count, memory_mb, disk details (capacity, datastore), network details, host, etc.
      try {
        const pyvmomiVmDetails = await callPyvmomiService('GET', `/vm/${vmExternalId}/details`, targetHypervisor);
        // Map pyvmomiVmDetails to the structure expected by the frontend
        vmDetails = {
          id: pyvmomiVmDetails.uuid,
          name: pyvmomiVmDetails.name,
          description: pyvmomiVmDetails.annotation || '',
          hypervisorId: targetHypervisor.id,
          hypervisorType: 'vsphere',
          nodeName: pyvmomiVmDetails.host_name || targetHypervisor.hypervisor_name,
          status: pyvmomiVmDetails.power_state === 'poweredOn' ? 'running' : (pyvmomiVmDetails.power_state === 'poweredOff' ? 'stopped' : pyvmomiVmDetails.power_state.toLowerCase()),
          specs: {
            cpu: pyvmomiVmDetails.cpu_count || 0,
            memory: pyvmomiVmDetails.memory_mb || 0,
            disk: pyvmomiVmDetails.disks ? pyvmomiVmDetails.disks.reduce((sum, d) => sum + (d.capacity_gb || 0), 0) : 0,
            os: pyvmomiVmDetails.guest_os || 'Unknown',
          },
          createdAt: pyvmomiVmDetails.boot_time ? new Date(pyvmomiVmDetails.boot_time) : new Date(), // Placeholder
          tags: [], // TODO: PYVMOMI: Add tags if available
          // You might want to add more fields like ip_address, vmware_tools_status, nics, etc.
        };
      } catch (pyVmomiError) {
        console.error(`Error fetching vSphere VM details for ${vmExternalId} via PyVmomi:`, pyVmomiError.details?.error || pyVmomiError.message);
        return res.status(pyVmomiError.status || 500).json({
            error: `Failed to retrieve vSphere VM details for ${vmExternalId} via PyVmomi.`,
            details: pyVmomiError.details?.error || pyVmomiError.message
        });
      }
    } else {
      return res.status(500).json({ error: 'Inconsistent state: VM found but hypervisor type unknown.' });
    }
    res.json(vmDetails);
  } catch (error) {
    console.error(`Error fetching details for VM ${vmExternalId}:`, error);
    let errorDetails;
    if (targetHypervisor?.type === 'proxmox') {
        errorDetails = getProxmoxError(error);
    } else if (targetHypervisor?.type === 'vsphere') {
        errorDetails = { code: error.status || 500, message: error.details?.error || error.message || `Failed to retrieve vSphere VM details for ${vmExternalId}` };
    } else {
        errorDetails = { code: 500, message: error.message || `Failed to retrieve VM details for ${vmExternalId}` };
    }
    res.status(errorDetails.code || 500).json({
      error: `Failed to retrieve details for VM ${vmExternalId}.`,
      details: errorDetails.message,
      suggestion: errorDetails.suggestion
    });
  }
});

// GET /api/vms/:id/metrics - Get current performance metrics for a single VM
app.get('/api/vms/:id/metrics', authenticate, async (req, res) => {
  const { id: vmExternalId } = req.params; // Proxmox vmid or vSphere UUID
  console.log(`--- Received GET /api/vms/${vmExternalId}/metrics ---`);

  let targetHypervisor = null;
  let targetNode = null; // For Proxmox
  let proxmoxClientInstance = null;

  try {
    // --- Step 1: Find the VM's Hypervisor (Iterate or DB lookup) ---
    const { rows: connectedHypervisors } = await pool.query(
      `SELECT id, type, host, username, api_token, token_name, name as hypervisor_name, vsphere_subtype
       FROM hypervisors WHERE status = 'connected'`
    );
    let vmFoundOnHypervisor = false;
    for (const hypervisor of connectedHypervisors) {
      if (hypervisor.type === 'proxmox') {
        // ... (Proxmox VM finding logic)
        const [dbHost, dbPortStr] = hypervisor.host.split(':');
        const port = dbPortStr ? parseInt(dbPortStr, 10) : 8006;
        const cleanHost = dbHost;
        const proxmoxConfig = {
          host: cleanHost, port: port, username: hypervisor.username,
          tokenID: `${hypervisor.username}!${hypervisor.token_name}`,
          tokenSecret: hypervisor.api_token, timeout: 5000, rejectUnauthorized: false
        };
        proxmoxClientInstance = proxmoxApi(proxmoxConfig);
        try {
          const vmResources = await proxmoxClientInstance.cluster.resources.$get({ type: 'vm' });
          const foundVm = vmResources.find(vm => vm.vmid.toString() === vmExternalId);
          if (foundVm) {
            targetHypervisor = hypervisor;
            targetNode = foundVm.node;
            vmFoundOnHypervisor = true;
            break;
          }
        } catch (findError) { /* ignore */ }
      } else if (hypervisor.type === 'vsphere') {
        if (vmExternalId.length === 36 && vmExternalId.includes('-')) { // Basic UUID check
            targetHypervisor = hypervisor;
            vmFoundOnHypervisor = true;
            break;
        }
      }
    }

    if (!vmFoundOnHypervisor || !targetHypervisor) {
      return res.status(404).json({ error: `VM ${vmExternalId} not found for metrics.` });
    }

    // --- Step 2: Get VM Metrics ---
    let metrics;
    if (targetHypervisor.type === 'proxmox') {
      // ... (Proxmox metrics logic - Mantenida como estaba)
      const vmStatus = await proxmoxClientInstance.nodes.$(targetNode).qemu.$(vmExternalId).status.current.$get();
      metrics = {
        cpu: (vmStatus.cpu || 0) * 100,
        memory: vmStatus.maxmem > 0 ? (vmStatus.mem / vmStatus.maxmem) * 100 : 0,
        disk: 0, // Placeholder
        network: { in: vmStatus.netin || 0, out: vmStatus.netout || 0, },
        uptime: vmStatus.uptime || 0,
        raw: { /* ... */ }
      };
    } else if (targetHypervisor.type === 'vsphere') {
      console.log(`Fetching metrics for vSphere VM ${vmExternalId} via PyVmomi microservice`);
      // TODO: PYVMOMI: Implement '/vm/<vm_uuid>/metrics' endpoint in app.py
      // This endpoint should use pyVmomi's PerformanceManager to get CPU, memory, disk, network usage.
      try {
        const pyvmomiMetrics = await callPyvmomiService('GET', `/vm/${vmExternalId}/metrics`, targetHypervisor);
        // Map pyvmomiMetrics to the structure expected by the frontend
        metrics = {
          cpu: pyvmomiMetrics.cpu_usage_percent || 0,
          memory: pyvmomiMetrics.memory_usage_percent || 0,
          disk: pyvmomiMetrics.disk_usage_percent || 0, // Placeholder if not available
          network: {
            in: pyvmomiMetrics.network_rx_bytes || 0, // Or rate if available
            out: pyvmomiMetrics.network_tx_bytes || 0, // Or rate if available
          },
          uptime: pyvmomiMetrics.uptime_seconds || 0,
          raw: pyvmomiMetrics.raw_stats || {}, // Pass through any raw stats
        };
      } catch (pyVmomiError) {
        console.error(`Error fetching vSphere VM metrics for ${vmExternalId} via PyVmomi:`, pyVmomiError.details?.error || pyVmomiError.message);
        // Return placeholder metrics on error or re-throw
        metrics = { cpu: 0, memory: 0, disk: 0, network: { in: 0, out: 0 }, uptime: 0, error: "Failed to load metrics via PyVmomi" };
      }
    } else {
      return res.status(500).json({ error: 'Inconsistent state for metrics.' });
    }
    res.json(metrics);
  } catch (error) {
    console.error(`Error fetching metrics for VM ${vmExternalId}:`, error);
    // Generic error handling
    res.status(500).json({ error: `Failed to retrieve metrics for VM ${vmExternalId}.`, details: error.message });
  }
});


// Helper function to get authenticated proxmox client (kept for Proxmox logic)
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
  try {
    const { rows: [hypervisorInfo] } = await pool.query(
      'SELECT id, type, name, status, host, username, api_token, token_name, vsphere_subtype FROM hypervisors WHERE id = $1',
      [id]
    );

    if (!hypervisorInfo) return res.status(404).json({ error: 'Hypervisor not found.' });
    if (hypervisorInfo.status !== 'connected') return res.status(409).json({ error: `Hypervisor ${hypervisorInfo.name} not connected.` });

    let formattedNodes = [];

    if (hypervisorInfo.type === 'proxmox') {
      // ... (Proxmox nodes logic - Mantenida como estaba)
      const proxmox = await getProxmoxClient(id);
      const nodes = await proxmox.nodes.$get();
      formattedNodes = await Promise.all(nodes.map(async (node) => {
        const nodeStatus = await proxmox.nodes.$(node.node).status.$get();
        const totalLogicalCpus = (nodeStatus.cpuinfo?.cores || 0) * (nodeStatus.cpuinfo?.sockets || 1);
        return {
          id: node.node, name: node.node, status: node.status,
          cpu: { cores: totalLogicalCpus, usage: nodeStatus.cpu || 0 },
          memory: { total: nodeStatus.memory?.total || 0, used: nodeStatus.memory?.used || 0, free: nodeStatus.memory?.free || 0, },
          rootfs: nodeStatus.rootfs ? { total: nodeStatus.rootfs.total || 0, used: nodeStatus.rootfs.used || 0, } : undefined,
        };
      }));
    } else if (hypervisorInfo.type === 'vsphere') {
      console.log(`Fetching vSphere nodes for hypervisor ${id} via PyVmomi microservice`);
      // TODO: PYVMOMI: Implement '/hosts' endpoint in app.py
      // This endpoint should list ESXi hosts (if vCenter) or the single ESXi host.
      // It should return details like name, status, CPU (cores, usage), memory (total, used).
      try {
        const pyvmomiHosts = await callPyvmomiService('GET', '/hosts', hypervisorInfo);
        if (Array.isArray(pyvmomiHosts)) {
          formattedNodes = pyvmomiHosts.map(host => ({
            id: host.moid || host.name, // Use MOID if available, else name
            name: host.name,
            status: host.overall_status === 'green' ? 'online' : (host.connection_state === 'connected' ? 'online' : 'offline'), // Example mapping
            cpu: {
              cores: host.cpu_cores || 0,
              usage: host.cpu_usage_percent || 0, // Percentage
            },
            memory: {
              total: host.memory_total_bytes || 0,
              used: host.memory_used_bytes || 0,
              free: (host.memory_total_bytes || 0) - (host.memory_used_bytes || 0),
            },
            // storage: PyVmomi microservice would need to aggregate datastore info per host if desired here
          }));
        } else {
          console.warn("PyVmomi /hosts did not return an array:", pyvmomiHosts);
        }
      } catch (pyVmomiError) {
        console.error(`Error fetching vSphere nodes via PyVmomi for ${id}:`, pyVmomiError.details?.error || pyVmomiError.message);
        // Fallback or error response
        return res.status(pyVmomiError.status || 500).json({ error: 'Failed to retrieve vSphere nodes via PyVmomi', details: pyVmomiError.details?.error || pyVmomiError.message });
      }
    } else {
      return res.status(400).json({ error: `Unsupported hypervisor type: ${hypervisorInfo.type}` });
    }
    res.json(formattedNodes);
  } catch (error) {
    console.error(`Error fetching nodes for hypervisor ${id}:`, error.message);
    res.status(500).json({ error: 'Failed to retrieve nodes', details: error.message });
  }
});

//Get the hypervisor info from the request body
app.get('/api/hypervisors/:id/storage', authenticate, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows: [hypervisorInfo] } = await pool.query(
      'SELECT id, name, type, status, host, username, api_token, token_name, vsphere_subtype FROM hypervisors WHERE id = $1',
      [id]
    );

    if (!hypervisorInfo) return res.status(404).json({ error: 'Hypervisor not found.' });
    if (hypervisorInfo.status !== 'connected') return res.status(409).json({ error: `Hypervisor ${hypervisorInfo.name} not connected.` });

    let formattedStorage = [];

    if (hypervisorInfo.type === 'proxmox') {
      // ... (Proxmox storage logic - Mantenida como estaba)
      const proxmox = await getProxmoxClient(id);
      const storageResources = await proxmox.storage.$get();
      formattedStorage = storageResources.map(storage => ({
        id: storage.storage, name: storage.storage, type: storage.type,
        size: storage.total || 0, used: storage.used || 0, available: storage.avail || 0,
        path: storage.path,
      }));
    } else if (hypervisorInfo.type === 'vsphere') {
      console.log(`Fetching vSphere storage (datastores) for ${id} via PyVmomi microservice`);
      // TODO: PYVMOMI: Implement '/datastores' endpoint in app.py
      // This endpoint should list all datastores with name, type, capacity, free_space.
      try {
        const pyvmomiDatastores = await callPyvmomiService('GET', '/datastores', hypervisorInfo);
        if (Array.isArray(pyvmomiDatastores)) {
          formattedStorage = pyvmomiDatastores.map(ds => ({
            id: ds.moid || ds.name, // Use MOID if available
            name: ds.name,
            type: ds.type, // e.g., "VMFS", "NFS"
            size: ds.capacity_bytes || 0,
            used: (ds.capacity_bytes || 0) - (ds.free_space_bytes || 0),
            available: ds.free_space_bytes || 0,
            path: null, // Not typically relevant for vSphere datastores
          }));
        } else {
            console.warn("PyVmomi /datastores did not return an array:", pyvmomiDatastores);
        }
      } catch (pyVmomiError) {
        console.error(`Error fetching vSphere datastores via PyVmomi for ${id}:`, pyVmomiError.details?.error || pyVmomiError.message);
        return res.status(pyVmomiError.status || 500).json({ error: 'Failed to retrieve vSphere datastores via PyVmomi', details: pyVmomiError.details?.error || pyVmomiError.message });
      }
    } else {
      return res.status(400).json({ error: `Unsupported hypervisor type: ${hypervisorInfo.type}` });
    }
    res.json(formattedStorage);
  } catch (error) {
    console.error(`Error fetching storage for hypervisor ${id}:`, error);
    res.status(500).json({ error: 'Failed to retrieve storage', details: error.message });
  }
});

// Helper function to fetch VM Templates from vSphere (now via PyVmomi)
async function fetchVSphereVMTemplates(hypervisor) { // Pass full hypervisor object
  console.log(`vSphere Templates: Fetching VM templates for ${hypervisor.id} via PyVmomi`);
  // TODO: PYVMOMI: Implement '/templates' endpoint in app.py
  // This endpoint should list VMs marked as templates, returning name, uuid, disk size, etc.
  try {
    const pyvmomiTemplates = await callPyvmomiService('GET', '/templates', hypervisor);
    if (Array.isArray(pyvmomiTemplates)) {
      return pyvmomiTemplates.map(tmpl => ({
        id: tmpl.uuid, // PyVmomi should return UUID
        name: tmpl.name,
        description: `vSphere VM Template: ${tmpl.name}`,
        size: tmpl.disk_capacity_bytes || 0, // Example, adapt to actual PyVmomi response
        path: tmpl.uuid, // Use UUID as path identifier
        type: 'template',
        storage: tmpl.datastore_name || 'vSphere Managed',
      }));
    }
    console.warn("PyVmomi /templates did not return an array:", pyvmomiTemplates);
    return [];
  } catch (error) {
    console.error(`vSphere Templates: Error fetching VM templates via PyVmomi for ${hypervisor.id}:`, error.details?.error || error.message);
    return [];
  }
}

// Helper function to fetch ISO files from vSphere datastores (now via PyVmomi)
async function fetchVSphereIsoFiles(hypervisor) { // Pass full hypervisor object
  console.log(`vSphere ISOs: Fetching ISO files for ${hypervisor.id} via PyVmomi`);
  // TODO: PYVMOMI: Implement '/isos' endpoint in app.py
  // This endpoint should browse datastores for .iso files, returning name, path, size, datastore.
  try {
    const pyvmomiIsos = await callPyvmomiService('GET', '/isos', hypervisor);
    if (Array.isArray(pyvmomiIsos)) {
      return pyvmomiIsos.map(iso => ({
        id: `${iso.datastore_moid || iso.datastore_name}:${iso.path}`, // Unique ID
        name: iso.name,
        description: `ISO file from datastore ${iso.datastore_name}`,
        size: iso.size_bytes,
        path: iso.path,
        type: 'iso',
        storage: iso.datastore_name,
      }));
    }
    console.warn("PyVmomi /isos did not return an array:", pyvmomiIsos);
    return [];
  } catch (error) {
    console.error(`vSphere ISOs: Error fetching ISOs via PyVmomi for ${hypervisor.id}:`, error.details?.error || error.message);
    return [];
  }
}

// GET /api/hypervisors/:id/templates
app.get('/api/hypervisors/:id/templates', authenticate, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows: [hypervisorInfo] } = await pool.query(
      'SELECT id, name, type, status, host, username, api_token, token_name, vsphere_subtype FROM hypervisors WHERE id = $1',
      [id]
    );

    if (!hypervisorInfo) return res.status(404).json({ error: 'Hypervisor not found.' });
    if (hypervisorInfo.status !== 'connected') return res.status(409).json({ error: `Hypervisor ${hypervisorInfo.name} not connected.` });

    let allTemplates = [];

    if (hypervisorInfo.type === 'proxmox') {
      // ... (Proxmox templates logic - Mantenida como estaba)
      const proxmox = await getProxmoxClient(id);
      allTemplates = await fetchProxmoxTemplates(proxmox); // Uses original Proxmox helper
    } else if (hypervisorInfo.type === 'vsphere') {
      console.log(`Fetching vSphere templates and ISOs for ${id} via PyVmomi microservice`);
      const vmTemplates = await fetchVSphereVMTemplates(hypervisorInfo); // Pass full hypervisor object
      const isoFiles = await fetchVSphereIsoFiles(hypervisorInfo); // Pass full hypervisor object
      allTemplates = vmTemplates.concat(isoFiles);
      console.log(`Fetched ${allTemplates.length} vSphere templates/ISOs for ${id} via PyVmomi`);
    } else {
      return res.status(400).json({ error: `Unsupported hypervisor type: ${hypervisorInfo.type}` });
    }
    res.json(allTemplates);
  } catch (error) {
    console.error(`Error fetching templates for hypervisor ${id}:`, error);
    res.status(500).json({ error: 'Failed to retrieve templates', details: error.message });
  }
});


// GET /api/hypervisors - List all hypervisors
app.get('/api/hypervisors', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, type, host, username, status, last_sync, vsphere_subtype, created_at, updated_at FROM hypervisors ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching hypervisors from DB:', err);
    res.status(500).json({ error: 'Failed to retrieve hypervisors' });
  }
});

// POST /api/hypervisors - Create new hypervisor
app.post('/api/hypervisors', authenticate, requireAdmin, async (req, res) => {
  const { host, username, password, apiToken, tokenName, type, vsphere_subtype: clientVsphereSubtype } = req.body; // clientVsphereSubtype for explicit setting

  const validationErrors = [];
  if (!type) validationErrors.push('Type is required');
  if (!host) validationErrors.push('Host is required');
  if (!username) validationErrors.push('Username is required');

  if (type === 'proxmox') {
      const hasToken = apiToken && tokenName;
      const hasPassword = !!password;
      if (!hasToken && !hasPassword) validationErrors.push('Proxmox requires either password or API token + token name');
      if (apiToken && !tokenName) validationErrors.push('Token name is required when using API token');
      if (tokenName && !apiToken) validationErrors.push('API token secret is required when using token name');
      if (!/^https?:\/\/[\w.-]+(:\d+)?$/.test(host)) validationErrors.push('Invalid Proxmox host format. Use http(s)://hostname[:port]');
  } else if (type === 'vsphere') {
      if (!password) validationErrors.push('Password is required for vSphere connection');
      if (!/^[\w.-]+(:\d+)?$/.test(host) && !/^https?:\/\/[\w.-]+(:\d+)?$/.test(host)) {
          validationErrors.push('Invalid vSphere host format. Use hostname or https://hostname[:port]');
      }
  }

  if (validationErrors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: validationErrors });
  }

  let status = 'disconnected';
  let lastSync = null;
  let cleanHost = host;
  const name = host.replace(/^https?:\/\//, '').split(/[/:]/)[0].replace(/[^\w-]/g, '-').substring(0, 50);
  let determinedVsphereSubtype = clientVsphereSubtype || null; // Use provided subtype or determine later

  try {
    if (type === 'proxmox') {
      // ... (Proxmox connection logic - Mantenida como estaba)
      const urlParts = new URL(host.includes('://') ? host : `https://${host}`);
      cleanHost = urlParts.hostname;
      const port = urlParts.port || 8006;
      const proxmoxConfig = {
          host: cleanHost, port: port, username: username,
          timeout: 15000, rejectUnauthorized: false,
      };
      if (apiToken && tokenName) {
          proxmoxConfig.tokenID = `${username}!${tokenName}`;
          proxmoxConfig.tokenSecret = apiToken;
      } else {
          proxmoxConfig.password = password;
      }
      const proxmox = proxmoxApi(proxmoxConfig);
      const nodesResponse = await proxmox.nodes.$get();
      if (!nodesResponse?.length) throw new Error('No nodes found in Proxmox cluster');
      const nodeName = nodesResponse[0].node;
      const versionResponse = await proxmox.nodes.$(nodeName).version.$get();
      if (!versionResponse?.version) throw new Error('Invalid Proxmox version response');
      status = 'connected';
      lastSync = new Date();
      console.log(`Connected to Proxmox ${versionResponse.version} at ${cleanHost}:${port}`);
    } else if (type === 'vsphere') {
      console.log(`Attempting vSphere connection to: ${host} with user: ${username} via PyVmomi microservice`);
      // For vSphere, we now use the PyVmomi microservice to test connection.
      // The microservice's /connect endpoint should attempt SmartConnect.
      // It should also try to determine if it's vCenter or ESXi if possible.
      const hypervisorDataForPyvmomi = { host, username, api_token: password, type, vsphere_subtype: clientVsphereSubtype };
      
      // TODO: PYVMOMI: Implement '/connect' endpoint in app.py
      // This endpoint should take host, user, password.
      // It should try to connect using pyVim.connect.SmartConnect.
      // Optionally, it could return basic info like API version, and if it's vCenter/ESXi.
      try {
        const connectResponse = await callPyvmomiService('POST', '/connect', hypervisorDataForPyvmomi, {
            // Pass any specific parameters needed by the /connect endpoint if any, besides credentials
        });
        
        status = 'connected'; // If callPyvmomiService doesn't throw, connection is successful
        lastSync = new Date();
        determinedVsphereSubtype = connectResponse.vsphere_subtype || clientVsphereSubtype || 'esxi'; // Prefer subtype from microservice
        console.log(`Successfully connected to vSphere via PyVmomi. Response:`, connectResponse);
        cleanHost = host.split(':')[0]; // Store clean host
      } catch (pyVmomiConnectError) {
        console.error(`vSphere connection via PyVmomi failed for ${host}:`, pyVmomiConnectError.details?.error || pyVmomiConnectError.message);
        status = 'error';
        // Re-throw to be caught by the main error handler for this route
        throw new Error(`vSphere connection via PyVmomi microservice failed: ${pyVmomiConnectError.details?.error || pyVmomiConnectError.message}`);
      }
    }

    const dbResult = await pool.query(
        `INSERT INTO hypervisors (name, type, host, username, api_token, token_name, vsphere_subtype, status, last_sync)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, name, type, host, username, vsphere_subtype, status, last_sync, created_at`,
        [
            name, type,
            type === 'proxmox' ? `${cleanHost}:${(new URL(host.includes('://') ? host : `https://${host}`)).port || 8006}` : cleanHost, // Store Proxmox with port
            username,
            (type === 'vsphere' ? password : (apiToken || null)),
            (type === 'proxmox' ? (tokenName || null) : null),
            determinedVsphereSubtype,
            status, lastSync
        ]
    );
    const responseData = dbResult.rows[0];
    // delete responseData.api_token; // api_token is not returned by RETURNING
    // delete responseData.token_name; // token_name is not returned by RETURNING
    res.status(201).json(responseData);

  } catch (error) {
    console.error('Error creating hypervisor:', error);
    const errorInfo = { code: 500, message: error.message || 'Hypervisor connection error', suggestion: 'Check connection details and credentials' };
    if (error.status) errorInfo.code = error.status; // Use status from PyVmomi error if available
    if (type === 'proxmox' && error.response) { /* Proxmox specific error handling */ }
    
    res.status(errorInfo.code).json(errorInfo);
  }
});


// GET /api/hypervisors/:id - Get a single hypervisor by ID
app.get('/api/hypervisors/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  console.log(`GET /api/hypervisors/${id} called`);
  try {
    const { rows: [hypervisor] } = await pool.query(
      'SELECT id, name, type, host, username, token_name, api_token, status, last_sync, vsphere_subtype, created_at, updated_at FROM hypervisors WHERE id = $1',
      [id]
    );

    if (!hypervisor) return res.status(404).json({ error: 'Hypervisor not found' });

    if (hypervisor.status === 'connected') {
      if (hypervisor.type === 'proxmox') {
        // ... (Proxmox details fetching - Mantenida como estaba)
        console.log(`Hypervisor ${id} (Proxmox) is connected, fetching details...`);
        try {
            const proxmox = await getProxmoxClient(hypervisor.id);
            const [basicNodesData, storageData, templatesData] = await Promise.all([
                proxmox.nodes.$get().catch(e => { console.error(`Error fetching Proxmox node list for ${id}:`, e.message); return []; }),
                proxmox.storage.$get().catch(e => { console.error(`Error fetching Proxmox storage for ${id}:`, e.message); return []; }),
                fetchProxmoxTemplates(proxmox).catch(e => { console.error(`Error fetching Proxmox templates for ${id}:`, e.message); return []; })
            ]);
            // ... (resto de la lógica de agregación y capacidad de Proxmox) ...
            // (Esta parte es larga y se mantiene igual, solo se omite aquí por brevedad)
            hypervisor.nodes = basicNodesData; // Simplificado para el ejemplo
            hypervisor.storage = storageData;
            hypervisor.templates = templatesData;
            // Calcular aggregatedStats y planCapacityEstimates como antes...
        } catch (detailError) {
            console.error(`Failed to fetch Proxmox details for connected hypervisor ${id}:`, detailError);
            hypervisor.detailsError = detailError.message || 'Failed to load Proxmox details';
        }
      } else if (hypervisor.type === 'vsphere') {
        console.log(`Hypervisor ${id} (vSphere) is connected, fetching details via PyVmomi...`);
        try {
          // TODO: PYVMOMI: Consider a single '/hypervisor-details' endpoint in app.py
          // that returns nodes, storage, templates, and aggregated stats in one call.
          // For now, making separate calls as per previous structure.

          // Fetch Nodes (ESXi Hosts) via PyVmomi
          const pyvmomiNodes = await callPyvmomiService('GET', '/hosts', hypervisor).catch(e => { console.error(`PyVmomi /hosts error: ${e.message}`); return []; });
          hypervisor.nodes = Array.isArray(pyvmomiNodes) ? pyvmomiNodes.map(h => ({ /* map to frontend structure */ id: h.moid || h.name, name: h.name, status: 'online', cpu: {}, memory: {} })) : [];
          
          // Fetch Storage (Datastores) via PyVmomi
          const pyvmomiStorage = await callPyvmomiService('GET', '/datastores', hypervisor).catch(e => { console.error(`PyVmomi /datastores error: ${e.message}`); return []; });
          hypervisor.storage = Array.isArray(pyvmomiStorage) ? pyvmomiStorage.map(s => ({ /* map to frontend structure */ id: s.moid || s.name, name: s.name, size: s.capacity_bytes, used: s.capacity_bytes - s.free_space_bytes })) : [];

          // Fetch Templates & ISOs via PyVmomi
          const vmTemplates = await fetchVSphereVMTemplates(hypervisor).catch(e => { console.error(`PyVmomi /templates error: ${e.message}`); return []; });
          const isoFiles = await fetchVSphereIsoFiles(hypervisor).catch(e => { console.error(`PyVmomi /isos error: ${e.message}`); return []; });
          hypervisor.templates = vmTemplates.concat(isoFiles);

          console.log(`Fetched vSphere details for ${id} via PyVmomi: ${hypervisor.nodes.length} nodes, ${hypervisor.storage.length} storage, ${hypervisor.templates.length} templates/ISOs`);
          // Calcular aggregatedStats y planCapacityEstimates para vSphere como antes, usando los datos de PyVmomi...
        } catch (detailError) {
          console.error(`Failed to fetch vSphere details via PyVmomi for ${id}:`, detailError);
          hypervisor.detailsError = detailError.message || 'Failed to load vSphere details via PyVmomi';
        }
      }
    }

    delete hypervisor.api_token;
    res.json(hypervisor);

  } catch (err) {
    console.error(`Error fetching hypervisor ${id}:`, err);
    res.status(500).json({ error: 'Failed to retrieve hypervisor' });
  }
});

// Helper function to fetch Proxmox templates (Mantenida como estaba)
async function fetchProxmoxTemplates(proxmox) {
  let allTemplatesMap = new Map();
  const nodes = await proxmox.nodes.$get();
  for (const node of nodes) {
    try {
      const storageList = await proxmox.nodes.$(node.node).storage.$get();
      for (const storage of storageList) {
        if (storage.content.includes('iso') || storage.content.includes('vztmpl') || storage.content.includes('template')) {
          const content = await proxmox.nodes.$(node.node).storage.$(storage.storage).content.$get();
          content
            .filter(item => item.content === 'iso' || item.content === 'vztmpl' || item.template === 1)
            .forEach(item => {
              const templateId = item.volid;
              if (!allTemplatesMap.has(templateId)) {
                allTemplatesMap.set(templateId, {
                  id: templateId, name: item.volid.split('/')[1] || item.volid,
                  description: item.volid, size: item.size, path: item.volid,
                  type: item.content === 'iso' ? 'iso' : (item.template === 1 ? 'template' : 'vztmpl'),
                  version: item.format, storage: storage.storage,
                });
              }
            });
        }
      }
    } catch (nodeError) {
        console.error(`Error fetching storage/content for Proxmox node ${node.node}: ${nodeError.message}`);
    }
  }
  return Array.from(allTemplatesMap.values());
}

// Función de manejo de errores de Proxmox (Mantenida como estaba)
function getProxmoxError(error) {
  const response = { message: 'Proxmox API Error', code: 500, suggestion: 'Check network connection and credentials' };
  if (error.response) {
      response.code = error.response.status;
      if (error.response.data?.errors) response.message = error.response.data.errors.map(err => err.message || err).join(', ');
      if (response.code === 401) { response.message = 'Authentication failed'; response.suggestion = 'Verify credentials/token permissions'; }
      if (response.code === 403) { response.message = 'Permission denied'; response.suggestion = 'Check user role privileges'; }
      if (response.code === 595) { response.message = 'SSL certificate verification failed'; response.suggestion = process.env.NODE_ENV === 'production' ? 'Use valid SSL certificate' : 'Set NODE_ENV=development to allow self-signed certs'; }
  } else if (error.code === 'ECONNREFUSED') {
      response.message = 'Connection refused'; response.code = 503; response.suggestion = 'Check if Proxmox is running and port is accessible';
  } else if (error.message) {
      response.message = error.message;
  }
  return response;
}

// PUT /api/hypervisors/:id - Update an existing hypervisor
app.put('/api/hypervisors/:id', authenticate, requireAdmin, async (req, res) => {
  const { id } = req.params;
  console.log(`PUT /api/hypervisors/${id} called with body:`, req.body);
  const { name, host, username, apiToken } = req.body;

  if (!name || !host || !username) {
      return res.status(400).json({ error: 'Missing required fields: name, host, username' });
  }
  try {
      const result = await pool.query(
          'UPDATE hypervisors SET name = $1, host = $2, username = $3, api_token = $4, updated_at = now() WHERE id = $5 RETURNING id, name, type, host, username, status, last_sync, created_at, updated_at',
          [name, host, username, apiToken || null, id]
      );
      if (result.rows.length > 0) res.json(result.rows[0]);
      else res.status(404).json({ error: 'Hypervisor not found' });
  } catch (err) {
      console.error(`Error updating hypervisor ${id} in DB:`, err);
      res.status(500).json({ error: 'Failed to update hypervisor' });
  }
});

// DELETE /api/hypervisors/:id - Delete a hypervisor
app.delete('/api/hypervisors/:id', authenticate, requireAdmin, async (req, res) => {
  const { id } = req.params;
  console.log(`DELETE /api/hypervisors/${id} called`);
  try {
    const result = await pool.query('DELETE FROM hypervisors WHERE id = $1 RETURNING id', [id]);
    if (result.rowCount > 0) res.status(204).send();
    else res.status(404).json({ error: 'Hypervisor not found' });
  } catch (err) {
    console.error(`Error deleting hypervisor ${id} from DB:`, err);
    res.status(500).json({ error: 'Failed to delete hypervisor' });
  }
});

// POST /api/hypervisors/:id/connect
app.post('/api/hypervisors/:id/connect', authenticate, requireAdmin, async (req, res) => {
  const { id } = req.params;
  console.log(`POST /api/hypervisors/${id}/connect called`);

  try {
    const { rows: [hypervisor] } = await pool.query(
      `SELECT id, type, host, username, api_token, token_name, vsphere_subtype
       FROM hypervisors WHERE id = $1`,
      [id]
    );
    if (!hypervisor) return res.status(404).json({ error: 'Hypervisor not found' });

    let newStatus = 'error';
    let lastSync = null;
    let connectionMessage = `Connection attempt for hypervisor ${id} (${hypervisor.type}).`;
    let determinedVsphereSubtype = hypervisor.vsphere_subtype; // Keep existing if not redetermined

    if (hypervisor.type === 'proxmox') {
      // ... (Proxmox connection logic - Mantenida como estaba)
      const [dbHost, dbPortStr] = hypervisor.host.split(':');
      const port = dbPortStr ? parseInt(dbPortStr, 10) : 8006;
      const cleanHost = dbHost;
      const proxmoxConfig = {
        host: cleanHost, port: port, username: hypervisor.username,
        tokenID: `${hypervisor.username}!${hypervisor.token_name}`,
        tokenSecret: hypervisor.api_token, timeout: 15000, rejectUnauthorized: false
      };
      const proxmox = proxmoxApi(proxmoxConfig);
      const versionResponse = await proxmox.version.$get();
      if (!versionResponse?.version) throw new Error('Failed to retrieve Proxmox version.');
      // const permissionsInfo = await proxmox.access.permissions.$get(); // Optional: permission check
      newStatus = 'connected';
      lastSync = new Date();
      connectionMessage = `Successfully connected to Proxmox user ${hypervisor.username} on ${cleanHost}:${port}`;
    } else if (hypervisor.type === 'vsphere') {
      console.log(`Attempting vSphere connection for hypervisor ${id} (${hypervisor.host}) via PyVmomi`);
      try {
        // Pass the full hypervisor object from DB to callPyvmomiService
        const connectResponse = await callPyvmomiService('POST', '/connect', hypervisor, {});
        newStatus = 'connected';
        lastSync = new Date();
        determinedVsphereSubtype = connectResponse.vsphere_subtype || hypervisor.vsphere_subtype || 'esxi';
        connectionMessage = `Successfully connected to vSphere via PyVmomi. Subtype: ${determinedVsphereSubtype}.`;
        console.log(connectionMessage, connectResponse);
      } catch (pyVmomiConnectError) {
        connectionMessage = `vSphere connection via PyVmomi failed: ${pyVmomiConnectError.details?.error || pyVmomiConnectError.message}`;
        console.error(connectionMessage);
        throw pyVmomiConnectError; // Re-throw
      }
    } else {
      connectionMessage = `Unsupported hypervisor type: ${hypervisor.type}`;
      console.warn(connectionMessage);
    }

    const { rows: [updatedHypervisor] } = await pool.query(
      `UPDATE hypervisors SET status = $1, last_sync = $2, vsphere_subtype = $3, updated_at = NOW()
       WHERE id = $4 RETURNING id, name, status, last_sync, vsphere_subtype`,
      [newStatus, lastSync, determinedVsphereSubtype, id]
    );
    res.json({ ...updatedHypervisor, message: connectionMessage });
    console.log(`Updated hypervisor ${id} status to ${newStatus}.`);

  } catch (err) {
    const { rows: [hypervisorAttempted] } = await pool.query('SELECT type FROM hypervisors WHERE id = $1', [id]);
    let errorDetails;
    if (hypervisorAttempted?.type === 'proxmox') errorDetails = getProxmoxError(err);
    else if (hypervisorAttempted?.type === 'vsphere') {
      errorDetails = {
        code: err.status || 500,
        message: err.details?.error || err.message || 'vSphere connection error via PyVmomi.',
        suggestion: 'Check PyVmomi microservice logs and vSphere connectivity.'
      };
    } else {
      errorDetails = { code: 500, message: err.message || 'Unknown connection error.', suggestion: 'Review server logs.' };
    }
    console.error(`Connection attempt failed for hypervisor ${id}: ${errorDetails.message}`, { stack: err.stack });
    await pool.query(
      `UPDATE hypervisors SET status = 'error', last_sync = NULL, updated_at = NOW() WHERE id = $1`, [id]
    ).catch(dbUpdateError => console.error(`Failed to update hypervisor ${id} status to 'error' in DB:`, dbUpdateError));
    res.status(errorDetails.code || 500).json(errorDetails);
  }
});


// --- VM Plan CRUD API Routes --- (Mantenidas como estaban)
app.get('/api/vm-plans', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, description, specs, icon, is_active, created_at, updated_at FROM vm_plans ORDER BY created_at ASC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Failed to retrieve VM plans' }); }
});
app.post('/api/vm-plans', authenticate, requireAdmin, async (req, res) => {
  const { name, description, specs, icon, is_active = true } = req.body;
  if (!name || !description || !specs || !specs.cpu || !specs.memory || !specs.disk) {
    return res.status(400).json({ error: 'Missing required plan fields' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO vm_plans (name, description, specs, icon, is_active) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, description, JSON.stringify(specs), icon || null, is_active]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed to create VM plan' }); }
});
app.put('/api/vm-plans/:id', authenticate, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;
  if (typeof is_active !== 'boolean') return res.status(400).json({ error: 'isActive (boolean) is required.' });
  try {
    const result = await pool.query('UPDATE vm_plans SET is_active = $1, updated_at = now() WHERE id = $2 RETURNING *', [is_active, id]);
    if (result.rows.length > 0) res.json(result.rows[0]);
    else res.status(404).json({ error: 'VM Plan not found' });
  } catch (err) { res.status(500).json({ error: 'Failed to update VM plan' }); }
});
app.delete('/api/vm-plans/:id', authenticate, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM vm_plans WHERE id = $1 RETURNING id', [id]);
    if (result.rowCount > 0) res.status(204).send();
    else res.status(404).json({ error: 'VM Plan not found' });
  } catch (err) { res.status(500).json({ error: 'Failed to delete VM plan' }); }
});

// --- Final Client CRUD API Routes --- (Mantenidas como estaban)
app.get('/api/final-clients', authenticate, async (req, res) => {
  const page = parseInt(req.query.page || '1', 10);
  const limit = parseInt(req.query.limit || '10', 10);
  const search = req.query.search || '';
  const offset = (page - 1) * limit;
  try {
    let query = 'SELECT * FROM final_clients';
    let countQuery = 'SELECT COUNT(*) FROM final_clients';
    const queryParams = [], countQueryParams = [];
    if (search) {
      const searchTerm = `%${search}%`;
      query += ' WHERE name ILIKE $1 OR rif ILIKE $1';
      countQuery += ' WHERE name ILIKE $1 OR rif ILIKE $1';
      queryParams.push(searchTerm); countQueryParams.push(searchTerm);
    }
    query += ` ORDER BY name ASC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
    queryParams.push(limit, offset);
    const [dataResult, countResult] = await Promise.all([pool.query(query, queryParams), pool.query(countQuery, countQueryParams)]);
    const totalItems = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalItems / limit);
    res.json({ items: dataResult.rows, pagination: { currentPage: page, totalPages, totalItems, limit } });
  } catch (err) { res.status(500).json({ error: 'Failed to retrieve final clients' }); }
});
app.post('/api/final-clients', authenticate, requireAdmin, async (req, res) => {
  const { name, rif, contact_info, additional_info } = req.body;
  const created_by_user_id = req.user.userId;
  if (!name || !rif) return res.status(400).json({ error: 'Name and RIF are required' });
  try {
    const result = await pool.query(
      `INSERT INTO final_clients (name, rif, contact_info, additional_info, created_by_user_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, rif, contact_info || null, additional_info || null, created_by_user_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A client with this RIF already exists.' });
    res.status(500).json({ error: 'Failed to create final client' });
  }
});
app.put('/api/final-clients/:id', authenticate, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, rif, contact_info, additional_info } = req.body;
  if (!name || !rif) return res.status(400).json({ error: 'Name and RIF are required' });
  try {
    const result = await pool.query(
      `UPDATE final_clients SET name = $1, rif = $2, contact_info = $3, additional_info = $4, updated_at = now() WHERE id = $5 RETURNING *`,
      [name, rif, contact_info || null, additional_info || null, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Final client not found' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Another client with this RIF already exists.' });
    res.status(500).json({ error: 'Failed to update final client' });
  }
});
app.delete('/api/final-clients/:id', authenticate, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM final_clients WHERE id = $1 RETURNING id', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Final client not found' });
    res.status(204).send();
  } catch (err) { res.status(500).json({ error: 'Failed to delete final client' }); }
});

// --- Statistics Routes --- (Mantenidas como estaban)
app.get('/api/stats/vm-creation-count', authenticate, async (req, res) => {
  const { startDate, endDate } = req.query;
  const MAX_DAYS_FOR_DAILY_COUNTS = 90;
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate are required.' });
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) return res.status(400).json({ error: 'Dates must be YYYY-MM-DD.' });
  const start = new Date(startDate), end = new Date(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return res.status(400).json({ error: 'Invalid date format.' });
  if (start > end) return res.status(400).json({ error: 'startDate cannot be after endDate.' });
  const endOfDay = new Date(end); endOfDay.setDate(endOfDay.getDate() + 1);
  try {
    const totalCountResult = await pool.query('SELECT COUNT(*) FROM virtual_machines WHERE created_at >= $1 AND created_at < $2', [start, endOfDay]);
    const count = parseInt(totalCountResult.rows[0].count, 10);
    let dailyCounts = null;
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    if (diffDays <= MAX_DAYS_FOR_DAILY_COUNTS) {
      const dailyResult = await pool.query(
        `SELECT DATE(created_at) as date, COUNT(*) as count FROM virtual_machines WHERE created_at >= $1 AND created_at < $2 GROUP BY DATE(created_at) ORDER BY date ASC`,
        [start, endOfDay]
      );
      dailyCounts = dailyResult.rows.map(row => ({ date: new Date(row.date).toISOString().split('T')[0], count: parseInt(row.count, 10) }));
    }
    res.json({ count, startDate, endDate, dailyCounts });
  } catch (err) { res.status(500).json({ error: 'Failed to retrieve VM creation statistics' }); }
});
app.get('/api/stats/client-vms/:clientId', authenticate, async (req, res) => {
  const { clientId } = req.params;
  const page = parseInt(req.query.page || '1', 10);
  const limit = parseInt(req.query.limit || '5', 10);
  const offset = (page - 1) * limit;
  if (!clientId) return res.status(400).json({ error: 'Client ID is required.' });
  try {
    const vmsQuery = `
      SELECT vm.id as database_id, vm.hypervisor_vm_id as id, vm.name, vm.status, vm.created_at,
             vm.cpu_cores, vm.memory_mb, vm.disk_gb, vm.os, vm.hypervisor_id, h.type as hypervisor_type
      FROM virtual_machines vm JOIN hypervisors h ON vm.hypervisor_id = h.id
      WHERE vm.final_client_id = $1 ORDER BY vm.created_at DESC LIMIT $2 OFFSET $3`;
    const vmsResult = await pool.query(vmsQuery, [clientId, limit, offset]);
    const countQuery = 'SELECT COUNT(*) FROM virtual_machines WHERE final_client_id = $1';
    const countResult = await pool.query(countQuery, [clientId]);
    const totalItems = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalItems / limit);
    const formattedVms = vmsResult.rows.map(dbVm => ({
      id: dbVm.id, databaseId: dbVm.database_id, name: dbVm.name, status: dbVm.status,
      createdAt: dbVm.created_at, hypervisorId: dbVm.hypervisor_id, hypervisorType: dbVm.hypervisor_type,
      specs: { cpu: dbVm.cpu_cores, memory: dbVm.memory_mb, disk: dbVm.disk_gb, os: dbVm.os, }
    }));
    res.json({ items: formattedVms, pagination: { currentPage: page, totalPages, totalItems, limit } });
  } catch (err) { res.status(500).json({ error: 'Failed to retrieve VMs for the client.' }); }
});



app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
