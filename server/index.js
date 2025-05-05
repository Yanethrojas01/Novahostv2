import express from 'express';
import cors from 'cors';
import pg from 'pg';
import https from 'https'; // Needed for custom agent
import dotenv from 'dotenv';
import Proxmox, { proxmoxApi } from 'proxmox-api'; // Import the proxmox library
import bcrypt from 'bcrypt'; // For password hashing
import jwt from 'jsonwebtoken'; // For JWT generation/verification

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


// --- Authentication Middleware ---
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1]; // Expecting "Bearer TOKEN"

  if (token == null) {
    console.log('Auth middleware: No token provided');
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      console.log('Auth middleware: Invalid token', err.message);
      // Differentiate between expired and invalid tokens if needed
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Unauthorized: Token expired' });
      }
      return res.status(403).json({ error: 'Forbidden: Invalid token' }); // Use 403 for invalid token
    }
    // Token is valid, attach user info to the request object
    req.user = user;
    console.log('Auth middleware: Token verified for user:', user.userId, 'Role:', user.role); // Log user ID and role
    next(); // Proceed to the next middleware or route handler
  });
};

// --- Role-Based Access Control Middleware (Example) ---
const requireAdmin = (req, res, next) => {
  // Assumes 'authenticate' middleware runs first and sets req.user
  if (!req.user || req.user.role !== 'admin') {
    console.log('RequireAdmin: Access denied for user:', req.user?.userId, 'Role:', req.user?.role);
    return res.status(403).json({ error: 'Forbidden: Admin privileges required' });
  }
  next();
};

// --- Authentication Routes ---
app.post('/api/auth/login', async (req, res) => {
  console.log('--- HIT /api/auth/login ---'); // <-- Add this log
  const { email, password } = req.body;
  console.log(`Login attempt for email: ${email}`);

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    // Find user by email, join with roles table to get role name
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
      return res.status(401).json({ error: 'Invalid email or password' }); // Generic error
    }

    if (!user.is_active) {
      console.log(`Login failed: User ${email} is inactive`);
      return res.status(403).json({ error: 'Account is inactive' });
    }

    // Compare provided password with the stored hash
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      console.log(`Login failed: Incorrect password for email ${email}`);
      return res.status(401).json({ error: 'Invalid email or password' }); // Generic error
    }

    // Generate JWT
    const payload = {
      userId: user.id,
      username: user.username, // <-- Añadir username aquí
      email: user.email,
      role: user.role_name
      // Puedes añadir 'name' si lo tienes en la DB y lo quieres en el token
    };
    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });

    console.log(`Login successful for ${email}. Role: ${user.role_name}`);
    res.json({ accessToken, user: { id: user.id, username: user.username, email: user.email, role: user.role_name } }); // Send token and basic user info (incl. username)

  } catch (error) {
    console.error('Login process error:', error);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

// --- User Management Routes (Admin Only) ---

// POST /api/users - Create a new user
app.post('/api/users', authenticate, requireAdmin, async (req, res) => {
  const { username, email, password, role_name = 'user', is_active = true } = req.body; // Default role to 'user'
  console.log(`--- POST /api/users --- Creating user: ${email}, Role: ${role_name}`);

  // Validation
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email, and password are required' });
  }
  if (!['admin', 'user', 'viewer'].includes(role_name)) {
    return res.status(400).json({ error: 'Invalid role specified. Must be admin, user, or viewer.' });
  }

  try {
    // Check if role exists
    const roleResult = await pool.query('SELECT id FROM roles WHERE name = $1', [role_name]);
    if (roleResult.rows.length === 0) {
      return res.status(400).json({ error: `Role '${role_name}' not found in database.` });
    }
    const roleId = roleResult.rows[0].id;

    // Hash the password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Insert the user
    const insertResult = await pool.query(
      `INSERT INTO users (username, email, password_hash, role_id, is_active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, email, role_id, is_active, created_at, updated_at`,
      [username, email, passwordHash, roleId, is_active]
    );

    const newUser = insertResult.rows[0];
    // Add role name back for the response
    newUser.role_name = role_name;
    delete newUser.role_id; // Don't need role_id in response

    console.log('Successfully created user:', newUser);
    res.status(201).json(newUser);

  } catch (error) {
    console.error('Error creating user:', error);
    // Handle potential unique constraint violation (e.g., email already exists)
    if (error.code === '23505') { // PostgreSQL unique violation code
      return res.status(409).json({ error: 'Email or username already exists.' });
    }
    res.status(500).json({ error: 'Failed to create user.' });
  }
});

// PUT /api/users/:id - Update a user (Admin Only)
app.put('/api/users/:id', authenticate, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { username, email, role_name, is_active } = req.body;
  // Note: Password changes should likely be a separate endpoint/process for security.
  // We are NOT allowing password updates via this endpoint for now.

  console.log(`--- PUT /api/users/${id} --- Updating user: ${email}, Role: ${role_name}, Active: ${is_active}`);

  // Validation
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
    // Find the role ID if role_name is provided
    let roleId = null;
    if (role_name) {
      const roleResult = await pool.query('SELECT id FROM roles WHERE name = $1', [role_name]);
      if (roleResult.rows.length === 0) {
        return res.status(400).json({ error: `Role '${role_name}' not found.` });
      }
      roleId = roleResult.rows[0].id;
    }

    // Build the update query dynamically based on provided fields
    const updates = [];
    const values = [];
    let valueIndex = 1;

    updates.push(`username = $${valueIndex++}`); values.push(username);
    updates.push(`email = $${valueIndex++}`); values.push(email);
    if (roleId) { updates.push(`role_id = $${valueIndex++}`); values.push(roleId); }
    updates.push(`is_active = $${valueIndex++}`); values.push(is_active);
    updates.push(`updated_at = now()`);

    values.push(id); // Add the user ID for the WHERE clause

    const updateQuery = `UPDATE users SET ${updates.join(', ')} WHERE id = $${valueIndex} RETURNING id, username, email, role_id, is_active, created_at, updated_at`;

    const result = await pool.query(updateQuery, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updatedUser = result.rows[0];
    // Add role name back for consistency
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

// GET /api/users - List all users (Admin Only)
app.get('/api/users', authenticate, requireAdmin, async (req, res) => {
  console.log('--- GET /api/users ---');
  try {
    // Select user details and join with roles to get the role name
    const result = await pool.query(
      `SELECT u.id, u.username, u.email, u.is_active, r.name as role_name, u.created_at, u.updated_at
       FROM users u
       JOIN roles r ON u.role_id = r.id
       ORDER BY u.created_at DESC`
    );
    console.log(`Found ${result.rows.length} users`);
    // Map role_name to role for consistency with frontend User type
    const users = result.rows.map(dbUser => ({
      id: dbUser.id,
      username: dbUser.username,
      email: dbUser.email,
      role: dbUser.role_name, // Map role_name to role
      is_active: dbUser.is_active,
      // Include other fields if needed by the frontend, like created_at
    }));
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to retrieve users' });
  }
});





// Routes
// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
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
    let targetNode = null; // Define targetNode here to use it later for DB insert

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
      targetNode = params.nodeName; // Assign to the outer scope variable
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

// GET /api/vms/:id/metrics - Get current performance metrics for a single VM
app.get('/api/vms/:id/metrics', authenticate, async (req, res) => {
  const { id: vmId } = req.params;
  console.log(`--- Received GET /api/vms/${vmId}/metrics ---`);

  try {
    // --- Step 1: Find the VM's Hypervisor and Node (Reusing logic from GET /api/vms/:id) ---
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
          tokenSecret: hypervisor.api_token, timeout: 5000, rejectUnauthorized: false // Shorter timeout for metrics
        };
        const proxmox = proxmoxApi(proxmoxConfig);

        try {
          const vmResources = await proxmox.cluster.resources.$get({ type: 'vm' });
          const foundVm = vmResources.find(vm => vm.vmid.toString() === vmId);

          if (foundVm) {
            targetHypervisor = hypervisor;
            targetNode = foundVm.node;
            proxmoxClient = proxmox;
            console.log(`Found VM ${vmId} on node ${targetNode} of hypervisor ${hypervisor.id} for metrics`);
            break;
          }
        } catch (findError) {
          console.warn(`Could not check hypervisor ${hypervisor.id} for VM ${vmId} metrics:`, findError.message);
        }
      }
      // TODO: Add vSphere logic here if needed
    }

    if (!targetHypervisor || !targetNode || !proxmoxClient) {
      return res.status(404).json({ error: `VM ${vmId} not found on any connected Proxmox hypervisor.` });
    }

    // --- Step 2: Get VM Current Status ---
    const vmStatus = await proxmoxClient.nodes.$(targetNode).qemu.$(vmId).status.current.$get();

    // --- Step 3: Map data to our VMMetrics type ---
    const metrics = {
      cpu: (vmStatus.cpu || 0) * 100, // Proxmox CPU is 0-1 fraction, convert to percentage
      memory: vmStatus.maxmem > 0 ? (vmStatus.mem / vmStatus.maxmem) * 100 : 0, // Calculate memory percentage
      disk: 0, // Disk usage % is not directly available here. Maybe show I/O rates later?
      network: {
        in: vmStatus.netin || 0, // These are total bytes, not rate. Rate calculation needs state.
        out: vmStatus.netout || 0,
      },
      uptime: vmStatus.uptime || 0, // Seconds
    };

    res.json(metrics);

  } catch (error) {
    console.error(`Error fetching metrics for VM ${vmId}:`, error);
    const errorDetails = getProxmoxError(error);
    res.status(errorDetails.code || 500).json({
      error: `Failed to retrieve metrics for VM ${vmId}.`,
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
// --- Hypervisor CRUD API Routes ---
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
app.post('/api/hypervisors', authenticate, requireAdmin, async (req, res) => {
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
      }
      
      if (apiToken && !tokenName) {
          validationErrors.push('Token name is required when using API token');
      }
      
      if (tokenName && !apiToken) {
          validationErrors.push('API token secret is required when using token name');
      }
      
      if (!/^https?:\/\/[\w.-]+(:\d+)?$/.test(host)) {
          validationErrors.push('Invalid host format. Use http(s)://hostname[:port]');
      }
  }
  // Validaciones específicas para vSphere (ESXi/vCenter)
  else if (type === 'vsphere') {
      if (!password) {
          validationErrors.push('Password is required for vSphere connection');
      }
      
      // Formato más flexible para vSphere (acepta tanto hostname como URL)
      if (!/^[\w.-]+(:\d+)?$/.test(host) && !/^https?:\/\/[\w.-]+(:\d+)?$/.test(host)) {
          validationErrors.push('Invalid host format for vSphere. Use hostname or https://hostname[:port]');
      }
  }

  if (validationErrors.length > 0) {
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
  let vsphereSubtype = null; // Para vSphere

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
          };

          // Configurar autenticación
          if (apiToken && tokenName) {
              proxmoxConfig.tokenID = `${username}!${tokenName}`;  // Formato user@realm!tokenname
              proxmoxConfig.tokenSecret = apiToken;
          } else {
              proxmoxConfig.password = password;
          }

          // Crear cliente Proxmox
          const proxmox = proxmoxApi(proxmoxConfig);

          // Verificar nodos usando endpoint /nodes
          try {
            const nodesResponse = await proxmox.nodes.$get();
            
            if (!nodesResponse?.length) {
                throw new Error('No nodes found in cluster');
            }
    
            // Obtener la versión desde el primer nodo
            const nodeName = nodesResponse[0].node;
            const versionResponse = await proxmox.nodes.$(nodeName).version.$get();
            
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
          // --- Lógica de Conexión a vSphere (REST API) ---
          console.log(`Attempting vSphere connection to: ${host} with user: ${username}`);
          
          // Normalizar la URL para ESXi/vCenter
          let vsphereApiUrl;
          if (host.startsWith('http')) {
              vsphereApiUrl = host.replace(/^http:/, 'https:');
          } else {
              // Si no tiene protocolo, añadir https:// y asegurarse de que no tiene puerto
              const hostParts = host.split(':');
              vsphereApiUrl = `https://${hostParts[0]}`;
              // Si tiene puerto especificado, agregarlo
              if (hostParts.length > 1 && hostParts[1]) {
                  vsphereApiUrl += `:${hostParts[1]}`;
              }
          }
          
          // Extraer el hostname limpio para la base de datos
          cleanHost = new URL(vsphereApiUrl).hostname;
          
          // Configurar agente para manejar certificados auto-firmados
          const agent = new https.Agent({
            rejectUnauthorized: false // Para entornos de prueba/desarrollo
          });

          let sessionId = null;
          vsphereSubtype = 'unknown'; // Valor inicial

          try {
              // 1. Intentar autenticación para ESXi 6.7+ y vCenter - usando el endpoint de REST API moderno
              console.log(`Authenticating to ${vsphereApiUrl}/rest/com/vmware/cis/session`);
              const authResponse = await fetch(`${vsphereApiUrl}/rest/com/vmware/cis/session`, {
                  method: 'POST',
                  headers: {
                      'Authorization': `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
                      'Accept': 'application/json'
                  },
                  agent: agent
              });
              
              // Para ESXi 6.7 y vCenter 6.7+, esto debería funcionar
              if (authResponse.ok) {
                  const sessionData = await authResponse.json();
                  sessionId = sessionData.value;
                  
                  if (!sessionId) {
                      throw new Error('Session ID not received from vSphere');
                  }
                  
                  console.log(`vSphere session obtained: ${sessionId.substring(0, 10)}...`);
                  
                  // 2. Detectar si es ESXi o vCenter
                  try {
                      // Primero, intentar con un endpoint específico de vCenter
                      const vcenterCheck = await fetch(`${vsphereApiUrl}/rest/vcenter/deployment/install/initial-data`, {
                          method: 'GET',
                          headers: { 'vmware-api-session-id': sessionId, 'Accept': 'application/json' },
                          agent: agent
                      });
                      
                      if (vcenterCheck.ok || vcenterCheck.status === 403) { // 403 también indica que existe el endpoint
                          vsphereSubtype = 'vcenter';
                          console.log(`Determined ${cleanHost} is vCenter`);
                      } else {
                          // Si no es vCenter, verificar que sea ESXi
                          const hostListResponse = await fetch(`${vsphereApiUrl}/rest/vcenter/host`, {
                              method: 'GET',
                              headers: { 'vmware-api-session-id': sessionId, 'Accept': 'application/json' },
                              agent: agent
                          });
                          
                          if (hostListResponse.ok) {
                              const hostListData = await hostListResponse.json();
                              
                              // En ESXi standalone normalmente esto devuelve una lista vacía o un solo host
                              if (Array.isArray(hostListData.value)) {
                                  vsphereSubtype = 'esxi';
                                  console.log(`Determined ${cleanHost} is ESXi`);
                              }
                          }
                      }
                      
                      // Si aún no pudimos determinar, intentar otro enfoque para ESXi
                      if (vsphereSubtype === 'unknown') {
                          // Intentar acceder a un recurso solo de ESXi
                          const esxiCheck = await fetch(`${vsphereApiUrl}/rest/host/status`, {
                              method: 'GET',
                              headers: { 'vmware-api-session-id': sessionId, 'Accept': 'application/json' },
                              agent: agent
                          });
                          
                          if (esxiCheck.ok) {
                              vsphereSubtype = 'esxi';
                              console.log(`Confirmed ${cleanHost} is ESXi through /rest/host/status endpoint`);
                          }
                      }
                      
                      // Si todo lo anterior falló pero tenemos conexión, asumir ESXi
                      if (vsphereSubtype === 'unknown') {
                          vsphereSubtype = 'esxi';
                          console.log(`Assuming ${cleanHost} is ESXi (could not determine definitively)`);
                      }
                      
                      status = 'connected';
                      lastSync = new Date();
                      console.log(`Successfully connected to ${vsphereSubtype} at ${vsphereApiUrl}`);
                      
                  } catch (typeDetectionError) {
                      console.warn(`Could not determine vSphere type, assuming ESXi:`, typeDetectionError.message);
                      vsphereSubtype = 'esxi'; // Valor predeterminado si no podemos determinar
                      status = 'connected'; // Aún así, la conexión fue exitosa
                  }
              } else {
                  // Si falla la autenticación moderna, intentar con endpoints específicos de ESXi 6.5 o anterior
                  console.log(`Modern auth failed (${authResponse.status}), trying legacy ESXi auth...`);
                  
                  // Para ESXi más antiguos que pueden no tener la API REST completa
                  const legacyAuthResponse = await fetch(`${vsphereApiUrl}/ui/login`, {
                      method: 'POST',
                      headers: {
                          'Content-Type': 'application/x-www-form-urlencoded',
                      },
                      body: `userName=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
                      agent: agent,
                      redirect: 'manual' // No seguir redirecciones
                  });
                  
                  // Verificar cookies de sesión
                  const cookies = legacyAuthResponse.headers.get('set-cookie');
                  if (legacyAuthResponse.status === 302 && cookies) {
                      console.log(`Legacy ESXi session obtained via cookies`);
                      vsphereSubtype = 'esxi-legacy';
                      status = 'connected';
                      lastSync = new Date();
                  } else {
                      throw new Error(`Authentication failed for both modern and legacy ESXi interfaces`);
                  }
              }
          } catch (vsphereError) {
              console.error(`vSphere connection failed for ${vsphereApiUrl}:`, vsphereError.message);
              status = 'error';
              throw new Error(`vSphere connection failed: ${vsphereError.message}`);
          } finally {
              // Cerrar sesión si existe
              if (sessionId) {
                  try {
                      console.log(`Logging out vSphere session ${sessionId.substring(0, 10)}...`);
                      await fetch(`${vsphereApiUrl}/rest/com/vmware/cis/session`, {
                          method: 'DELETE',
                          headers: { 'vmware-api-session-id': sessionId },
                          agent: agent
                      });
                  } catch (logoutError) {
                      console.warn(`Failed to logout vSphere session:`, logoutError.message);
                  }
              }
          }
      }

      // Insertar en base de datos
      const dbResult = await pool.query(
          `INSERT INTO hypervisors (
              name, type, host, username,
              api_token, token_name, vsphere_subtype, status, last_sync
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id, name, type, host, username, vsphere_subtype, status, last_sync, created_at`,
          [
              name,
              type,
              // Guardar host según el tipo
              type === 'proxmox' ? `${cleanHost}:8006` : cleanHost,
              username,
              apiToken || null,
              tokenName || null,
              vsphereSubtype, // Guardar el subtipo detectado para vSphere
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
          message: `${type.charAt(0).toUpperCase() + type.slice(1)} connection error`,
          suggestion: 'Check connection details and credentials'
      };

      // Manejar errores específicos según el tipo
      if (type === 'proxmox' && error.response) {
          errorInfo.code = error.response.status;
          errorInfo.message = error.response.data?.errors?.join(', ') || error.message;
          
          // Errores comunes de Proxmox
          if (errorInfo.code === 401) {
              errorInfo.suggestion = 'Verify token/user permissions in Proxmox';
          } else if (errorInfo.code === 403) {
              errorInfo.suggestion = 'Check user role privileges';
          } else if (errorInfo.code === 595) {
              errorInfo.suggestion = 'SSL certificate verification failed';
          }
      }
      // Errores específicos de vSphere
      else if (type === 'vsphere') {
          // Mapear errores comunes de vSphere/ESXi
          if (error.message.includes('ECONNREFUSED')) {
              errorInfo.code = 503;
              errorInfo.message = 'Connection refused';
              errorInfo.suggestion = 'Check if the ESXi/vCenter host is reachable and the port is correct';
          } else if (error.message.includes('Authentication failed')) {
              errorInfo.code = 401;
              errorInfo.message = 'Authentication failed';
              errorInfo.suggestion = 'Verify username and password for vSphere';
          } else if (error.message.includes('certificate')) {
              errorInfo.code = 495;
              errorInfo.message = 'SSL certificate error';
              errorInfo.suggestion = 'The server uses an invalid SSL certificate';
          }
      }
      // Errores de conexión generales
      else if (error.code === 'ECONNREFUSED') {
          errorInfo.code = 503;
          errorInfo.message = 'Connection refused';
          errorInfo.suggestion = `Check ${type} service and firewall rules`;
      } else {
          // Otros errores
          errorInfo.message = error.message || 'An unknown error occurred';
      }

      console.error(`Hypervisor creation failed: ${errorInfo.message}`, {
          type,
          host: cleanHost,
          username,
          authMethod: type === 'proxmox' && apiToken ? 'token' : 'password',
          error: error.stack
      });

      res.status(errorInfo.code).json(errorInfo);
  }
});

// GET /api/hypervisors/:id - Get a single hypervisor by ID
app.get('/api/hypervisors/:id', authenticate, async (req, res) => { // Removed requireAdmin for now, adjust if needed
  const { id } = req.params;
  console.log(`GET /api/hypervisors/${id} called`);
  try {
    const result = await pool.query(
      'SELECT id, name, type, host, username, token_name, api_token, status, last_sync, created_at, updated_at FROM hypervisors WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Hypervisor not found' });
      return;
    }

    const hypervisor = result.rows[0];

    // If connected, try to fetch details
    if (hypervisor.status === 'connected' && hypervisor.type === 'proxmox') {
      console.log(`Hypervisor ${id} is connected, fetching details...`);
      try {
        // Use the existing helper function or replicate logic
        const [dbHost, dbPortStr] = hypervisor.host.split(':');
        const port = dbPortStr ? parseInt(dbPortStr, 10) : 8006;
        const cleanHost = dbHost;
        const proxmoxConfig = {
          host: cleanHost, port: port, username: hypervisor.username,
          tokenID: `${hypervisor.username}!${hypervisor.token_name}`,
          tokenSecret: hypervisor.api_token, timeout: 15000, rejectUnauthorized: false
        };
        const proxmox = proxmoxApi(proxmoxConfig);

        // Fetch nodes, storage, templates in parallel
        const [nodesData, storageData, templatesData] = await Promise.all([
          proxmox.nodes.$get().catch(e => { console.error(`Error fetching nodes for ${id}:`, e.message); return []; }), // Fetch nodes
          proxmox.storage.$get().catch(e => { console.error(`Error fetching storage for ${id}:`, e.message); return []; }), // Fetch storage
          fetchProxmoxTemplates(proxmox).catch(e => { console.error(`Error fetching templates for ${id}:`, e.message); return []; }) // Use helper for templates
        ]);

        // Add details to the hypervisor object
        hypervisor.nodes = nodesData; // Assuming API returns structure matching NodeResource
        hypervisor.storage = storageData; // Assuming API returns structure matching StorageResource
        hypervisor.templates = templatesData; // Assuming helper returns structure matching VMTemplate/NodeTemplate
        hypervisor.planCapacityEstimates = []; // Initialize capacity estimates array

        console.log(`Fetched details for ${id}: ${nodesData.length} nodes, ${storageData.length} storage, ${templatesData.length} templates`);

        // --- Calculate Aggregated Resources for Display ---
        let aggTotalCpuCores = 0;
        let aggUsedCpuCores = 0; // Based on usage fraction * cores
        let aggTotalMemoryBytes = 0;
        let aggUsedMemoryBytes = 0;
        let aggTotalDiskBytes = 0;
        let aggUsedDiskBytes = 0;

        if (nodesData.length > 0) {
            nodesData.forEach(node => {
                const nodeTotalCores = node.cpu?.cores || 0;
                aggTotalCpuCores += nodeTotalCores;
                // Use node.cpu usage (fraction 0-1) * cores for used estimate
                aggUsedCpuCores += (node.cpu?.usage || 0) * nodeTotalCores;
                aggTotalMemoryBytes += node.memory?.total || 0;
                aggUsedMemoryBytes += node.memory?.used || 0;
            });
        }

        if (storageData.length > 0) {
            storageData.forEach(storage => {
                // Ensure 'size' and 'used' are numbers before adding
                aggTotalDiskBytes += Number(storage.total) || 0; // Use 'total' from proxmox storage response
                aggUsedDiskBytes += Number(storage.used) || 0;
            });
        }

        const aggAvgCpuUsagePercent = aggTotalCpuCores > 0 ? (aggUsedCpuCores / aggTotalCpuCores) * 100 : 0;
        // --- End Aggregated Resources Calculation ---

        // --- Calculate Available Resources and Plan Capacity ---
        if (nodesData.length > 0 && storageData.length > 0) {
          // 1. Aggregate Available Resources
          let totalCpuCores = 0;
          let usedCpuCores = 0; // Approximation based on usage percentage
          let totalMemoryBytes = 0;
          let usedMemoryBytes = 0;
          let totalDiskBytes = 0;
          let usedDiskBytes = 0;

          // Use the already calculated aggregates
          totalCpuCores = aggTotalCpuCores;
          usedCpuCores = aggUsedCpuCores; // This is the estimated used cores, not percentage
          totalMemoryBytes = aggTotalMemoryBytes;
          usedMemoryBytes = aggUsedMemoryBytes;
          totalDiskBytes = aggTotalDiskBytes;
          usedDiskBytes = aggUsedDiskBytes;

          const availableCpuCores = Math.max(0, totalCpuCores - usedCpuCores);
          const availableMemoryBytes = Math.max(0, totalMemoryBytes - usedMemoryBytes);
          const availableDiskBytes = Math.max(0, totalDiskBytes - usedDiskBytes);

          console.log(`Aggregated Available Resources for ${id}: CPU Cores=${availableCpuCores.toFixed(2)}, Memory=${(availableMemoryBytes / (1024**3)).toFixed(2)} GB, Disk=${(availableDiskBytes / (1024**3)).toFixed(2)} GB`);

          // 2. Fetch Active VM Plans
          const { rows: activePlans } = await pool.query(
            'SELECT id, name, specs FROM vm_plans WHERE is_active = true ORDER BY name'
          );

          // 3. Calculate Estimates per Plan
          hypervisor.planCapacityEstimates = activePlans.map(plan => {
            const planCpu = plan.specs?.cpu || 0;
            const planMemoryMB = plan.specs?.memory || 0;
            const planDiskGB = plan.specs?.disk || 0;

            // Convert plan specs to comparable units (Bytes for memory/disk)
            const planMemoryBytes = planMemoryMB * 1024 * 1024;
            const planDiskBytes = planDiskGB * 1024 * 1024 * 1024;

            // Calculate max possible based on each resource (handle division by zero)
            const maxByCpu = planCpu > 0 ? Math.floor(availableCpuCores / planCpu) : Infinity;
            const maxByMemory = planMemoryBytes > 0 ? Math.floor(availableMemoryBytes / planMemoryBytes) : Infinity;
            const maxByDisk = planDiskBytes > 0 ? Math.floor(availableDiskBytes / planDiskBytes) : Infinity;

            // The estimate is the minimum of the three constraints
            const estimatedCount = Math.min(maxByCpu, maxByMemory, maxByDisk);

            // Handle Infinity case if all plan specs are 0 (unlikely)
            const finalCount = estimatedCount === Infinity ? 0 : estimatedCount;

            return {
              planId: plan.id,
              planName: plan.name,
              estimatedCount: finalCount,
              specs: plan.specs // Include specs for reference if needed on frontend
            };
          });
          console.log(`Calculated capacity estimates for ${hypervisor.planCapacityEstimates.length} active plans.`);
        }
        // --- End Calculation ---

        // Add aggregated stats to the hypervisor object for frontend display
        hypervisor.aggregatedStats = {
            totalCores: aggTotalCpuCores,
            avgCpuUsagePercent: aggAvgCpuUsagePercent,
            totalMemoryBytes: aggTotalMemoryBytes,
            usedMemoryBytes: aggUsedMemoryBytes,
            totalDiskBytes: aggTotalDiskBytes,
            usedDiskBytes: aggUsedDiskBytes,
            storagePoolCount: storageData.length
        };
        console.log(`Added aggregated stats for ${id}:`, hypervisor.aggregatedStats);
      } catch (detailError) {
        console.error(`Failed to fetch details for connected hypervisor ${id}:`, detailError);
        // Optionally add an error flag to the response or just return basic info
        hypervisor.detailsError = detailError.message || 'Failed to load details';
      }
    } // Add else if for vSphere details fetching here

    // Remove sensitive info before sending
    delete hypervisor.api_token;
    // delete hypervisor.password; // If password was selected

    res.json(hypervisor);

  } catch (err) {
    console.error(`Error fetching hypervisor ${id}:`, err);
    res.status(500).json({ error: 'Failed to retrieve hypervisor' });
 
  }
});

// Helper function to fetch templates (similar to the one in GET /api/hypervisors/:id/templates)
async function fetchProxmoxTemplates(proxmox) {
  let allTemplates = [];
  const nodes = await proxmox.nodes.$get();
  for (const node of nodes) {
    const storageList = await proxmox.nodes.$(node.node).storage.$get();
    for (const storage of storageList) {
      if (storage.content.includes('iso') || storage.content.includes('vztmpl') || storage.content.includes('template')) { // Added 'template' for VM templates
        const content = await proxmox.nodes.$(node.node).storage.$(storage.storage).content.$get();
        const templates = content
          .filter(item => item.content === 'iso' || item.content === 'vztmpl' || item.template === 1) // Check 'template' flag for VM templates
          .map(item => ({
            id: item.volid, // e.g., local:iso/ubuntu.iso or local:100/vm-100-disk-0.qcow2 for templates
            name: item.volid.split('/')[1] || item.volid, // Basic name extraction
            description: item.volid,
            size: item.size,
            path: item.volid,
            // Determine type more accurately
            type: item.content === 'iso' ? 'iso' : (item.template === 1 ? 'template' : 'vztmpl'),
            version: item.format,
            storage: storage.storage,
          }));
        allTemplates = allTemplates.concat(templates);
      }
    }
  }
  return allTemplates;
}

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
app.put('/api/hypervisors/:id', authenticate, requireAdmin, async (req, res) => { // Added requireAdmin
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
app.delete('/api/hypervisors/:id', authenticate, requireAdmin, async (req, res) => { // Added requireAdmin
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
app.post('/api/hypervisors/:id/connect', authenticate, requireAdmin, async (req, res) => { // Added requireAdmin
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
app.post('/api/vm-plans', authenticate, requireAdmin, async (req, res) => { // Added requireAdmin
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
app.put('/api/vm-plans/:id', authenticate, requireAdmin, async (req, res) => { // Added requireAdmin
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
app.delete('/api/vm-plans/:id', authenticate, requireAdmin, async (req, res) => { // Added requireAdmin
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
// --- Final Client CRUD API Routes ---

// GET /api/final-clients - List final clients with pagination and search
app.get('/api/final-clients', authenticate, async (req, res) => {
  const page = parseInt(req.query.page || '1', 10);
  const limit = parseInt(req.query.limit || '10', 10);
  const search = req.query.search || '';
  const offset = (page - 1) * limit;

  console.log(`--- GET /api/final-clients --- Page: ${page}, Limit: ${limit}, Search: '${search}'`);

  try {
    let query = 'SELECT * FROM final_clients';
    let countQuery = 'SELECT COUNT(*) FROM final_clients';
    const queryParams = [];
    const countQueryParams = [];

    if (search) {
      const searchTerm = `%${search}%`;
      query += ' WHERE name ILIKE $1 OR rif ILIKE $1';
      countQuery += ' WHERE name ILIKE $1 OR rif ILIKE $1';
      queryParams.push(searchTerm);
      countQueryParams.push(searchTerm);
    }

    query += ` ORDER BY name ASC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
    queryParams.push(limit, offset);

    const [dataResult, countResult] = await Promise.all([
      pool.query(query, queryParams),
      pool.query(countQuery, countQueryParams)
    ]);

    const totalItems = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalItems / limit);

    res.json({
      items: dataResult.rows,
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalItems: totalItems,
        limit: limit
      }
    });

  } catch (err) {
    console.error('Error fetching final clients:', err);
    res.status(500).json({ error: 'Failed to retrieve final clients' });
  }
});

// POST /api/final-clients - Create a new final client
app.post('/api/final-clients', authenticate, requireAdmin, async (req, res) => {
  const { name, rif, contact_info, additional_info } = req.body;
  const created_by_user_id = req.user.userId; // Get user ID from authenticated request

  console.log(`--- POST /api/final-clients --- Creating client: ${name}, RIF: ${rif}`);

  if (!name || !rif) {
    return res.status(400).json({ error: 'Name and RIF are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO final_clients (name, rif, contact_info, additional_info, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, rif, contact_info || null, additional_info || null, created_by_user_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating final client:', err);
    if (err.code === '23505') { // Unique constraint violation (likely RIF)
      return res.status(409).json({ error: 'A client with this RIF already exists.' });
    }
    res.status(500).json({ error: 'Failed to create final client' });
  }
});

// PUT /api/final-clients/:id - Update a final client
app.put('/api/final-clients/:id', authenticate, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, rif, contact_info, additional_info } = req.body;

  console.log(`--- PUT /api/final-clients/${id} --- Updating client: ${name}, RIF: ${rif}`);

  if (!name || !rif) {
    return res.status(400).json({ error: 'Name and RIF are required' });
  }

  try {
    const result = await pool.query(
      `UPDATE final_clients
       SET name = $1, rif = $2, contact_info = $3, additional_info = $4, updated_at = now()
       WHERE id = $5
       RETURNING *`,
      [name, rif, contact_info || null, additional_info || null, id]
    );

    if (result.rows.length === 0) {      return res.status(404).json({ error: 'Final client not found' });
  }
  res.json(result.rows[0]);
} catch (err) {
  console.error(`Error updating final client ${id}:`, err);
  if (err.code === '23505') { // Unique constraint violation (likely RIF)
    return res.status(409).json({ error: 'Another client with this RIF already exists.' });
  }
  res.status(500).json({ error: 'Failed to update final client' });
}
});

// DELETE /api/final-clients/:id - Delete a final client
app.delete('/api/final-clients/:id', authenticate, requireAdmin, async (req, res) => {
const { id } = req.params;
console.log(`--- DELETE /api/final-clients/${id} ---`);

try {
  // Check if client is associated with any VMs before deleting? Optional.
  // const vmCheck = await pool.query('SELECT 1 FROM virtual_machines WHERE final_client_id = $1 LIMIT 1', [id]);
  // if (vmCheck.rows.length > 0) {
  //   return res.status(409).json({ error: 'Cannot delete client associated with existing VMs.' });
  // }

  const result = await pool.query('DELETE FROM final_clients WHERE id = $1 RETURNING id', [id]);

  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'Final client not found' });
  }
  res.status(204).send(); // No Content
} catch (err) {
  console.error(`Error deleting final client ${id}:`, err);
  // Handle potential foreign key constraint errors if not using ON DELETE SET NULL/CASCADE appropriately
  res.status(500).json({ error: 'Failed to delete final client' });
}
});

// --- Statistics Routes ---

// GET /api/stats/vm-creation-count - Count VMs created within a date range
app.get('/api/stats/vm-creation-count', authenticate, async (req, res) => {
  const { startDate, endDate } = req.query;
  console.log(`--- GET /api/stats/vm-creation-count --- Start: ${startDate}, End: ${endDate}`);

  // Basic Validation
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'Both startDate and endDate query parameters are required.' });
  }

  // Validate date format (simple check for YYYY-MM-DD)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
    return res.status(400).json({ error: 'Dates must be in YYYY-MM-DD format.' });
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return res.status(400).json({ error: 'Invalid date format provided.' });
  }

  if (start > end) {
    return res.status(400).json({ error: 'startDate cannot be after endDate.' });
  }

  // Adjust end date to include the entire day (e.g., '2023-11-15' becomes '2023-11-16 00:00:00')
  const endOfDay = new Date(end);
  endOfDay.setDate(endOfDay.getDate() + 1);

  try {
    const result = await pool.query(
      'SELECT COUNT(*) FROM virtual_machines WHERE created_at >= $1 AND created_at < $2',
      [start, endOfDay] // Use adjusted end date for the query
    );

    const count = parseInt(result.rows[0].count, 10);
    console.log(`Found ${count} VMs created between ${startDate} and ${endDate}`);
    res.json({ count, startDate, endDate }); // Return the original dates for consistency

  } catch (err) {
    console.error('Error fetching VM creation stats:', err);
    res.status(500).json({ error: 'Failed to retrieve VM creation statistics' });
  }
});

// --- End Final Client CRUD API Routes ---
 

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});