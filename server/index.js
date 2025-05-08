import express from 'express';
import cors from 'cors';
import pg from 'pg';
import https from 'https'; // Needed for custom agent
import dotenv from 'dotenv';
import Proxmox, { proxmoxApi } from 'proxmox-api'; // Import the proxmox library
import bcrypt from 'bcrypt'; // For password hashing
import { constants as cryptoConstants } from 'crypto'; // Import crypto constants
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
    //console.log('Auth middleware: No token provided');
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
    //console.log('Auth middleware: Token verified for user:', user.userId, 'Role:', user.role); // Log user ID and role
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

    // --- Insert VM record into the database ---
    if (newVmId && creationResult) { // Only insert if Proxmox part was initiated
      console.log(`Inserting VM record into database for Proxmox VMID: ${newVmId}`);
      console.log('User ID for DB insert:', req.user?.userId); // Add this log
      try {
        const insertQuery = `INSERT INTO virtual_machines (name, description, hypervisor_id, hypervisor_vm_id, status, cpu_cores, memory_mb, disk_gb, ticket, final_client_id, created_by_user_id, os)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING id`; // Return the new DB UUID
        const insertParams = [
            params.name,
            params.description || null,
            params.hypervisorId,
            newVmId, // Save the Proxmox VMID
            'creating', // Initial status
            params.specs.cpu,
            params.specs.memory,
            params.specs.disk,
            params.ticket || null,
            params.finalClientId || null,
            req.user.userId, // Get user ID from authenticated request
            params.specs.os || null, // Or derive from template if possible
        ];
        const insertResult = await pool.query(insertQuery, insertParams);
        console.log(`Successfully inserted VM record with DB ID: ${insertResult.rows[0].id}`);
      } catch (dbError) {
        console.error('Error inserting VM record into database after Proxmox creation:', dbError);
        // Decide how to handle this: maybe log it but still return success to frontend?
        // Or return a specific error indicating partial success?
        // For now, we'll log and continue, but the DB record might be missing.
      }
    }
    // --- End Database Insert ---

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
      tags: vmConfig.tags ? vmConfig.tags.split(';') : [], // Parse tags if needed
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

// Helper function to get authenticated vSphere client
async function getVSphereClient(hypervisorId) {
  console.log(`Creating vSphere client for hypervisor ${hypervisorId}`);
  
  // 1. Get hypervisor connection details from database
  const { rows: [hypervisor] } = await pool.query(
    'SELECT id, name, host, username, api_token, vsphere_subtype FROM hypervisors WHERE id = $1 AND type = $2',
    [hypervisorId, 'vsphere']
  );
  
  if (!hypervisor) {
    console.error(`vSphere hypervisor ${hypervisorId} not found or not of type vSphere`);
    throw new Error('vSphere hypervisor not found');
  }
  
  // 2. Extract connection details
 // Use api_token for vSphere password, as it's stored in that column
 let { host, username, api_token: password, vsphere_subtype } = hypervisor; 
  // Trim whitespace from credentials to prevent auth issues
  username = username ? username.trim() : null;
  password = password ? password.trim() : null;
  
  if (!['vcenter', 'esxi'].includes(vsphere_subtype)) {
    throw new Error(`Invalid vSphere subtype: ${vsphere_subtype}`);
  }
  
  // Normalize the URL
  let vsphereUrl;
  if (host.startsWith('http')) {
    vsphereUrl = host.replace(/^http:/, 'https:');
  } else {
    // If no protocol, add https://
    const hostParts = host.split(':');
    vsphereUrl = `https://${hostParts[0]}`;
    // Add port if specified
    if (hostParts.length > 1 && hostParts[1]) {
      vsphereUrl += `:${hostParts[1]}`;
    } else {
      vsphereUrl += ':443'; // Default HTTPS port
    }
  }
  
  // 3. Configure HTTPS agent for self-signed certificates
  const agent = new https.Agent({
    rejectUnauthorized: false, // Accept self-signed certs
    secureOptions: cryptoConstants.SSL_OP_NO_SSLv3 | cryptoConstants.SSL_OP_NO_TLSv1,
    ciphers: 'ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES256-GCM-SHA384',
    minVersion: 'TLSv1.2'
  });
  
  // 4. Authenticate and create session
  console.log(`[getVSphereClient] Attempting to authenticate to vSphere.`);
  console.log(`[getVSphereClient] URL: ${vsphereUrl}`);
  console.log(`[getVSphereClient] Username (trimmed): '${username}'`); 
  // Cuidado al loguear contraseñas, incluso en desarrollo. Considera loguear solo su longitud o un hash si es necesario en producción.
  // Para depuración local, loguear el valor puede ser útil temporalmente.
  console.log(`[getVSphereClient] Password (api_token) (trimmed): '${password ? "********" : "NOT FOUND"}'`); 
  
  
  // Try to authenticate with the REST API
  const authResponse = await fetch(`${vsphereUrl}/rest/com/vmware/cis/session`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'vmware-use-header-authn': 'true' // Asegurar autenticación por cabecera
    },
    body: JSON.stringify({}), // Empty body for POST
    agent: agent,
    timeout: 15000
  });
  console.log(`Getvsclient REST API auth response status: ${authResponse.status}`);

  if (!authResponse.ok) {
    let errorBody = 'Could not read error body.'; // Mensaje por defecto
    try {
      const textBody = await authResponse.text(); // Intenta leer el cuerpo como texto
      // Intenta parsear como JSON si es posible, si no, usa el texto.
      try {
        const jsonBody = JSON.parse(textBody);
        errorBody = JSON.stringify(jsonBody, null, 2); // Formatea el JSON para mejor lectura
      } catch (parseError) {
        errorBody = textBody; // Si no es JSON, usa el texto tal cual
      }
    } catch (readError) {
      console.warn('Failed to read error response body:', readError.message);
    }
    console.error(`vSphere authentication failed: ${authResponse.status} ${authResponse.statusText}. Response body: ${errorBody}`);
    throw new Error(`vSphere authentication failed: ${authResponse.status} ${authResponse.statusText}. Details: ${errorBody}`);
 
  }
  
  const sessionData = await authResponse.json();
  const sessionId = sessionData.value;
  
  if (!sessionId) {
    throw new Error('Failed to obtain vSphere session ID');
  }
  
  console.log(`Successfully authenticated to vSphere as ${username}`);
  
  // 5. Create and return client object with helper methods
  return {
    vsphereSubtype: vsphere_subtype || 'esxi', // Default to ESXi if not specified
    sessionId,
    baseUrl: vsphereUrl,
   
    // Helper method for GET requests
    async get(path, options = {}) {
      const url = `${this.baseUrl}${path}`;
      console.log(`GET ${url}`);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'vmware-api-session-id': this.sessionId,
          'Accept': 'application/json',
          ...options.headers
        },
        agent,
        timeout: options.timeout || 30000
      });
      
      if (!response.ok) {
        throw new Error(`vSphere API GET failed: ${response.status} ${response.statusText} for ${url}`);
      }
      
      return response.json();
    },
    
    // Helper method for POST requests
    async post(path, options = {}) {
      const url = `${this.baseUrl}${path}`;
      console.log(`POST ${url}`);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'vmware-api-session-id': this.sessionId,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...options.headers
        },
        body: options.body || JSON.stringify({}),
        agent,
        timeout: options.timeout || 30000
      });
      
      if (!response.ok) {
        throw new Error(`vSphere API POST failed: ${response.status} ${response.statusText} for ${url}`);
      }
      
      return response.json();
    },
    
    // Helper method for DELETE requests
    async delete(path, options = {}) {
      const url = `${this.baseUrl}${path}`;
      console.log(`DELETE ${url}`);
      
      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          'vmware-api-session-id': this.sessionId,
          ...options.headers
        },
        agent,
        timeout: options.timeout || 15000
      });
      
      if (!response.ok) {
        throw new Error(`vSphere API DELETE failed: ${response.status} ${response.statusText} for ${url}`);
      }
      
      return true;
    },
    
    // Logout method to clean up session
    async logout() {
      try {
        console.log(`Logging out vSphere session for ${username}`);
        await this.delete('/rest/com/vmware/cis/session');
        //console.log('vSphere logout successful');
        return true;
      } catch (error) {
        console.warn(`Error during vSphere logout: ${error.message}`);
        return false;
      }
    }
  };
}
// GET /api/hypervisors/:id/nodes
app.get('/api/hypervisors/:id/nodes', authenticate, async (req, res) => {
  const { id } = req.params;
  console.log(`--- GET /api/hypervisors/${id}/nodes ---`);
  try {
    // 1. Get Hypervisor info from DB
    const { rows: [hypervisorInfo] } = await pool.query(
      'SELECT id, type, name, status FROM hypervisors WHERE id = $1',
      [id]
    );

    if (!hypervisorInfo) {
      return res.status(404).json({ error: 'Hypervisor not found.' });
    }

    if (hypervisorInfo.status !== 'connected') {
      return res.status(409).json({ error: `Hypervisor ${hypervisorInfo.name} (${id}) is not connected. Cannot fetch nodes.` });
    }

    let formattedNodes = [];

    if (hypervisorInfo.type === 'proxmox') {
      console.log(`Fetching Proxmox nodes for hypervisor ${id}`);
      try {
        const proxmox = await getProxmoxClient(id); // This helper already checks type and status
        const nodes = await proxmox.nodes.$get();

        formattedNodes = await Promise.all(nodes.map(async (node) => {
          const nodeStatus = await proxmox.nodes.$(node.node).status.$get();
          const totalLogicalCpus = (nodeStatus.cpuinfo?.cores || 0) * (nodeStatus.cpuinfo?.sockets || 1);
          return {
            id: node.node,
            name: node.node,
            status: node.status,
            cpu: { cores: totalLogicalCpus, usage: nodeStatus.cpu || 0 },
            memory: {
              total: nodeStatus.memory?.total || 0,
              used: nodeStatus.memory?.used || 0,
              free: nodeStatus.memory?.free || 0,
            },
            rootfs: nodeStatus.rootfs ? {
              total: nodeStatus.rootfs.total || 0,
              used: nodeStatus.rootfs.used || 0,
            } : undefined,
            // storage: [], // Fetching storage per node would be another call if needed here
          };
        }));
        console.log(`Fetched ${formattedNodes.length} Proxmox nodes for hypervisor ${id}`);
      } catch (proxmoxError) {
        console.error(`Error fetching Proxmox nodes for hypervisor ${id}:`, proxmoxError.message);
        const errorDetails = getProxmoxError(proxmoxError);
        return res.status(errorDetails.code).json({ error: 'Failed to retrieve Proxmox nodes', details: errorDetails.message });
      }
    } else if (hypervisorInfo.type === 'vsphere') {
      console.log(`Fetching vSphere nodes for hypervisor ${id}`);
      let vsphereClient;
      try {
        vsphereClient = await getVSphereClient(id);
        const subtype = vsphereClient.vsphereSubtype;
        console.log(`Working with vSphere subtype: ${subtype}`);

        if (subtype === 'vcenter') { 
          try {
            // Get all hosts managed by vCenter
            const response = await vsphereClient.get('/rest/vcenter/host');
            const hosts = response.value || [];
            console.log(`Found ${hosts.length} hosts in vCenter (Hypervisor ID: ${id})`);

            formattedNodes = await Promise.all(hosts.map(async (host) => {
              try {
                // Get detailed info for each host
                const hostDetails = await vsphereClient.get(`/rest/vcenter/host/${host.host}`);
                
                // Get CPU info
                let cpuInfo = { cores: 0, usage: 0 };
                try {
                  const cpuStats = await vsphereClient.get(`/rest/vcenter/host/${host.host}/hardware/cpu`);
                  cpuInfo.cores = cpuStats.count || 0;
                  // Getting usage might require different endpoint or calculation
                } catch (cpuError) {
                  console.warn(`Could not fetch CPU stats for host ${host.host}:`, cpuError.message);
                }
                
                // Get Memory info
                let memoryInfo = { total: 0, used: 0, free: 0 };
                try {
                  const memoryStats = await vsphereClient.get(`/rest/vcenter/host/${host.host}/hardware/memory`);
                  memoryInfo.total = memoryStats.size_MiB * 1024 * 1024 || 0;
                  // Need additional calls for used/free memory
                } catch (memoryError) {
                  console.warn(`Could not fetch memory stats for host ${host.host}:`, memoryError.message);
                }
                
                // Get Storage info
                let storageInfo = { total: 0, used: 0, free: 0 };
                try {
                  const datastores = await vsphereClient.get(`/rest/vcenter/datastore?filter.hosts=${host.host}`);
                  for (const datastore of datastores.value || []) {
                    const datastoreDetail = await vsphereClient.get(`/rest/vcenter/datastore/${datastore.datastore}`);
                    storageInfo.total += datastoreDetail.capacity || 0;
                    storageInfo.free += datastoreDetail.free_space || 0;
                  }
                  storageInfo.used = storageInfo.total - storageInfo.free;
                } catch (storageError) {
                  console.warn(`Could not fetch storage stats for host ${host.host}:`, storageError.message);
                }

                return {
                  id: host.host,
                  name: host.name,
                  status: host.connection_state === 'CONNECTED' ? 'online' : 'offline',
                  cpu: cpuInfo,
                  memory: memoryInfo,
                  storage: storageInfo
                };
              } catch (hostError) {
                console.error(`Error fetching details for host ${host.host}:`, hostError.message);
                // Return basic info if detailed fetch fails
                return {
                  id: host.host,
                  name: host.name,
                  status: host.connection_state === 'CONNECTED' ? 'online' : 'offline',
                  cpu: { cores: 0, usage: 0 },
                  memory: { total: 0, used: 0, free: 0 },
                  storage: { total: 0, used: 0, free: 0 }
                };
              }
            }));
          } catch (vcenterError) {
            console.error(`Error in vCenter API calls:`, vcenterError.message);
            throw vcenterError;
          }
        } else if (subtype === 'esxi') { // Corrected: Use ESXi logic if subtype is 'esxi'
          // ESXi direct API handling
          try {
            console.log('Using ESXi direct API endpoints');
            
            // Get Host Summary info
            const hostSummary = await vsphereClient.get('/api/host');
            
            // Get Hardware info
            let hardwareInfo = { cpuCores: 0, memory: 0 };
            try {
              const hardware = await vsphereClient.get('/api/host/hardware');
              hardwareInfo.cpuCores = hardware.cpuPkgs * hardware.cpuCoresPerPkg || 0;
              hardwareInfo.memory = hardware.memorySize || 0;
            } catch (hwError) {
              console.warn('Failed to get hardware info:', hwError.message);
            }
            
            // Get CPU Usage
            let cpuUsage = 0;
            try {
              const cpuStats = await vsphereClient.get('/api/host/stats');
              cpuUsage = cpuStats.cpu?.usage?.latest || 0;
            } catch (cpuError) {
              console.warn('Failed to get CPU stats:', cpuError.message);
            }
            
            // Get Memory info
            let memoryStats = { total: hardwareInfo.memory, used: 0, free: 0 };
            try {
              const memInfo = await vsphereClient.get('/api/host/stats');
              memoryStats.used = memInfo.mem?.used?.latest || 0;
              memoryStats.free = memoryStats.total - memoryStats.used;
            } catch (memError) {
              console.warn('Failed to get memory stats:', memError.message);
            }
            
            // Get Storage info
            let storageInfo = { total: 0, used: 0, free: 0 };
            try {
              const datastores = await vsphereClient.get('/api/host/datastore');
              
              // Process each datastore
              for (const ds of datastores.value || []) {
                try {
                  const dsInfo = await vsphereClient.get(`/api/host/datastore/${ds.datastore}`);
                  storageInfo.total += dsInfo.capacity || 0;
                  storageInfo.free += dsInfo.freeSpace || 0;
                } catch (dsError) {
                  console.warn(`Failed to get datastore info for ${ds.name}:`, dsError.message);
                }
              }
              storageInfo.used = storageInfo.total - storageInfo.free;
            } catch (storageError) {
              console.warn('Failed to get storage stats:', storageError.message);
            }
            
            // Fallback if no name is available
            const hostName = hostSummary.name || hypervisorInfo.name || 'ESXi Host';
            
            formattedNodes = [{
              id: hypervisorInfo.id,
              name: hostName,
              status: 'online', // Assume online if we can connect
              cpu: {
                cores: hardwareInfo.cpuCores,
                usage: cpuUsage
              },
              memory: memoryStats,
              storage: storageInfo
            }];
          } catch (esxiError) {
            console.error('Error in ESXi API calls:', esxiError.message);
            
            // Try fallback to ESXi legacy endpoints if modern API fails
            try {
              console.log('Attempting fallback to legacy ESXi API endpoints');
              
              // Basic host info
              const hostInfo = await vsphereClient.get('/sdk/vimServiceVersions.xml');
              let name = hypervisorInfo.name || 'ESXi Host';
              
              formattedNodes = [{
                id: hypervisorInfo.id,
                name: name,
                status: 'online', // If we can connect, it's online
                cpu: { cores: 0, usage: 0 },
                memory: { total: 0, used: 0, free: 0 },
                storage: { total: 0, used: 0, free: 0 }
              }];
              
            } catch (fallbackError) {
              console.error('Fallback ESXi API also failed:', fallbackError.message);
              throw esxiError; // Throw the original error
            }
          }
        } else {
          console.warn(`Unsupported or unknown vSphere subtype '${subtype}' for hypervisor ${id}. Cannot fetch nodes.`);
          // formattedNodes will remain empty, leading to an empty JSON array response.
        }

        console.log(`Fetched ${formattedNodes.length} vSphere nodes for hypervisor ${id}`);
      } catch (vsphereError) {
        console.error(`Error fetching vSphere nodes for hypervisor ${id}:`, vsphereError.message);
        return res.status(500).json({
          error: 'Failed to retrieve vSphere nodes',
          details: vsphereError.message
        });
      } finally {
        if (vsphereClient) {
          await vsphereClient.logout().catch(err => {
            console.warn(`Error during logout: ${err.message}`);
          });
        }
      }
    } else {
      console.warn(`Unknown hypervisor type '${hypervisorInfo.type}' for ID ${id} when fetching nodes.`);
      return res.status(400).json({ error: `Unsupported hypervisor type: ${hypervisorInfo.type}` });
    }
    
    // Format and sanitize the output
    formattedNodes = formattedNodes.map(node => {
      // Ensure we have valid values for all properties
      return {
        id: node.id || '',
        name: node.name || '',
        status: node.status || 'unknown',
        cpu: {
          cores: node.cpu?.cores || 0,
          usage: node.cpu?.usage || 0
        },
        memory: {
          total: node.memory?.total || 0,
          used: node.memory?.used || 0,
          free: node.memory?.free || 0
        },
        storage: node.storage ? {
          total: node.storage.total || 0,
          used: node.storage.used || 0,
          free: node.storage.free || 0
        } : {
          total: 0,
          used: 0, 
          free: 0
        }
      };
    });
    
    res.json(formattedNodes);
  } catch (error) {
    console.error(`Error fetching nodes for hypervisor ${id}:`, error.message);
    const errorDetails = error.response && error.response.status ? getProxmoxError(error) : { code: 500, message: error.message || 'Failed to retrieve nodes' };
    res.status(errorDetails.code).json({ error: 'Failed to retrieve nodes', details: errorDetails.message });
  }
});

//Get the hypervisor info from the request body
app.get('/api/hypervisors/:id/storage', authenticate, async (req, res) => {
  const { id } = req.params;
  console.log(`--- GET /api/hypervisors/${id}/storage ---`);
  try {
    // 1. Get Hypervisor info from DB (similar to other endpoints)
    const { rows: [hypervisorInfo] } = await pool.query(
      'SELECT id, name, type, status FROM hypervisors WHERE id = $1',
      [id]
    );

    if (!hypervisorInfo) {
      return res.status(404).json({ error: 'Hypervisor not found.' });
    }

    if (hypervisorInfo.status !== 'connected') {
      return res.status(409).json({ error: `Hypervisor ${hypervisorInfo.name} (${id}) is not connected. Cannot fetch storage.` });
    }

    let formattedStorage = [];

    if (hypervisorInfo.type === 'proxmox') {
      console.log(`Fetching Proxmox storage for hypervisor ${id}`);
      try {
        const proxmox = await getProxmoxClient(id); // This helper already checks type and status
        const storageResources = await proxmox.storage.$get();
        formattedStorage = storageResources.map(storage => ({
          id: storage.storage,
          name: storage.storage,
          type: storage.type,
          size: storage.total || 0,
          used: storage.used || 0,
          available: storage.avail || 0,
          path: storage.path,
        }));
        console.log(`Fetched ${formattedStorage.length} Proxmox storage resources for hypervisor ${id}`);
      } catch (proxmoxError) {
        console.error(`Error fetching Proxmox storage for hypervisor ${id}:`, proxmoxError.message);
        const errorDetails = getProxmoxError(proxmoxError);
        return res.status(errorDetails.code).json({ error: 'Failed to retrieve Proxmox storage', details: errorDetails.message });
      }
    } else if (hypervisorInfo.type === 'vsphere') {
      console.log(`Fetching vSphere storage (datastores) for hypervisor ${id}`);
      let vsphereClient;
      try {
        vsphereClient = await getVSphereClient(id);
        // The /rest/vcenter/datastore endpoint is standard for vCenter.
        // For standalone ESXi, this specific endpoint might not be available or might behave differently.
        // If vsphereClient.vsphereSubtype === 'esxi', you might need an alternative way or accept limited info.
        const datastoresResponse = await vsphereClient.get('/rest/vcenter/datastore');
        const datastores = datastoresResponse.value || datastoresResponse; // Response structure can vary (sometimes .value)

        if (Array.isArray(datastores)) {
          formattedStorage = datastores.map(ds => ({
            id: ds.datastore, // e.g., "datastore-123"
            name: ds.name,
            type: ds.type, // e.g., "VMFS", "NFS"
            size: ds.capacity || 0, // Bytes
            used: (ds.capacity && ds.free_space !== undefined) ? (ds.capacity - ds.free_space) : 0, // Bytes
            available: ds.free_space || 0, // Bytes
            path: null, // Path is not typically relevant for vSphere datastores in the same way as Proxmox storage paths
          }));
          console.log(`Fetched ${formattedStorage.length} vSphere datastores for hypervisor ${id}`);
        } else {
          console.warn(`Unexpected response structure for vSphere datastores:`, datastores);
        }
      } catch (vsphereError) {
        console.error(`Error fetching vSphere storage for hypervisor ${id}:`, vsphereError.message);
        // Error already logged by getVSphereClient or during API calls
      } finally {
        if (vsphereClient) {
          await vsphereClient.logout();
        }
      }
    } else {
      console.warn(`Unknown hypervisor type '${hypervisorInfo.type}' for ID ${id} when fetching storage.`);
      return res.status(400).json({ error: `Unsupported hypervisor type: ${hypervisorInfo.type}` });
    }

    res.json(formattedStorage);
  } catch (error) {
    console.error(`Error fetching storage for hypervisor ${id}:`, error);
    const errorDetails = error.response && error.response.status ? getProxmoxError(error) : { code: 500, message: error.message || 'Failed to retrieve storage' };
    res.status(errorDetails.code).json({ error: 'Failed to retrieve storage', details: errorDetails.message });
  }
});

// Helper function to fetch VM Templates from vSphere
async function fetchVSphereVMTemplates(vsphereClient) {
  console.log(`vSphere Templates: Fetching VM templates for ${vsphereClient.hypervisorId}`);
  try {
    // This endpoint is typically for vCenter. ESXi might require different handling or may not list "templates" in the same way.
    const response = await vsphereClient.get('/rest/vcenter/vm?filter.templates=true');
    return response.map(vm => ({
      id: vm.vm, // vSphere VM ID (e.g., "vm-123")
      name: vm.name,
      description: `vSphere VM Template: ${vm.name}`,
      size: vm.memory_size_MiB * 1024 * 1024, // Example: use memory size, disk size not directly available here
      path: vm.vm, // Use VM ID as path identifier
      type: 'template',
      storage: 'vSphere Managed', // Placeholder, actual datastore might need another call
    }));
  } catch (error) {
    console.error(`vSphere Templates: Error fetching VM templates for ${vsphereClient.hypervisorId}:`, error.message);
    return [];
  }
}

// Helper function to fetch ISO files from vSphere datastores (simplified)
async function fetchVSphereIsoFiles(vsphereClient) {
  console.log(`vSphere ISOs: Fetching ISO files for ${vsphereClient.hypervisorId}`);
  let isoFiles = [];
  try {
    const datastores = await vsphereClient.get('/rest/vcenter/datastore');
    console.log(`vSphere ISOs: Found ${datastores.length} datastores.`);

    for (const ds of datastores) {
      console.log(`vSphere ISOs: Scanning datastore ${ds.name} (ID: ${ds.datastore}) for ISOs...`);
      try {
        // Attempt to list files in a common 'ISO' or 'ISOs' directory, or root.
        // This is a simplification; a full recursive browse can be very slow.
        // Common paths to check:
        const commonIsoPaths = ['/ISOs/', '/ISO/', '/']; // Check root as a last resort
        let filesInDs = [];

        for (const searchPath of commonIsoPaths) {
            try {
                const files = await vsphereClient.get(`/rest/vcenter/datastore/${ds.datastore}/files?path=${encodeURIComponent(searchPath)}`);
                filesInDs = filesInDs.concat(files.filter(file => file.name.toLowerCase().endsWith('.iso')));
                if (filesInDs.length > 0 && searchPath !== '/') break; // Stop if ISOs found in a subfolder
            } catch (pathError) {
                // console.warn(`vSphere ISOs: Could not list path '${searchPath}' in datastore ${ds.name}: ${pathError.message.substring(0,100)}`);
            }
        }

        filesInDs.forEach(file => {
          isoFiles.push({
            id: `${ds.datastore}:${file.path}`, // Unique ID: datastore_id:full_file_path
            name: file.name,
            description: `ISO file from datastore ${ds.name}`,
            size: file.size,
            path: file.path,
            type: 'iso',
            storage: ds.name,
          });
        });
      } catch (dsError) {
        console.error(`vSphere ISOs: Error processing datastore ${ds.name}:`, dsError.message);
      }
    }
  } catch (error) {
    console.error(`vSphere ISOs: Error fetching datastores for ${vsphereClient.hypervisorId}:`, error.message);
  }
  console.log(`vSphere ISOs: Found ${isoFiles.length} ISO files in total.`);
  return isoFiles;
}

// GET /api/hypervisors/:id/templates
app.get('/api/hypervisors/:id/templates', authenticate, async (req, res) => {
  const { id } = req.params;
  console.log(`--- GET /api/hypervisors/${id}/templates ---`);
  try {
    // 1. Get Hypervisor info from DB
    const { rows: [hypervisorInfo] } = await pool.query(
      'SELECT id, name, type, status FROM hypervisors WHERE id = $1',
      [id]
    );

    if (!hypervisorInfo) {
      return res.status(404).json({ error: 'Hypervisor not found.' });
    }

    if (hypervisorInfo.status !== 'connected') {
      return res.status(409).json({ error: `Hypervisor ${hypervisorInfo.name} (${id}) is not connected. Cannot fetch templates.` });
    }

    let allTemplates = [];

    if (hypervisorInfo.type === 'proxmox') {
      console.log(`Fetching Proxmox templates for hypervisor ${id}`);
      try {
        const proxmox = await getProxmoxClient(id); // This helper already checks type and status
        // Use the more robust fetchProxmoxTemplates helper function
        allTemplates = await fetchProxmoxTemplates(proxmox);
        console.log(`Fetched ${allTemplates.length} Proxmox templates for hypervisor ${id}`);
      } catch (proxmoxError) {
        console.error(`Error fetching Proxmox templates for hypervisor ${id}:`, proxmoxError.message);
        const errorDetails = getProxmoxError(proxmoxError);
        return res.status(errorDetails.code).json({ error: 'Failed to retrieve Proxmox templates', details: errorDetails.message });
      }
    } else if (hypervisorInfo.type === 'vsphere') {
      console.log(`Fetching vSphere templates and ISOs for hypervisor ${id}`);
      let vsphereClient;
      try {
        vsphereClient = await getVSphereClient(id);
        const vmTemplates = await fetchVSphereVMTemplates(vsphereClient);
        const isoFiles = await fetchVSphereIsoFiles(vsphereClient); // Simplified ISO fetching
        allTemplates = vmTemplates.concat(isoFiles);
        console.log(`Fetched ${allTemplates.length} vSphere templates/ISOs for hypervisor ${id}`);
      } catch (vsphereError) {
        console.error(`Error fetching vSphere templates/ISOs for hypervisor ${id}:`, vsphereError.message);
        // Do not return yet, try to logout if client was obtained
      } finally {
        if (vsphereClient) {
          await vsphereClient.logout();
        }
      }
      // If an error occurred during fetching and allTemplates is still empty, we might want to return an error response
      // For now, it will return an empty array if fetching failed.
    } else {
      console.warn(`Unknown hypervisor type '${hypervisorInfo.type}' for ID ${id} when fetching templates.`);
      return res.status(400).json({ error: `Unsupported hypervisor type: ${hypervisorInfo.type}` });
    }

    res.json(allTemplates);
  } catch (error) {
    console.error(`Error fetching templates for hypervisor ${id}:`, error);
    const errorDetails = error.response && error.response.status ? getProxmoxError(error) : { code: 500, message: error.message || 'Failed to retrieve templates' };
    res.status(errorDetails.code).json({ error: 'Failed to retrieve templates', details: errorDetails.message });
  }
});

// GET /api/hypervisors - List all hypervisors
app.get('/api/hypervisors', authenticate, async (req, res) => {
 // console.log('--- Received GET /api/hypervisors ---');
  try {
    // Select all relevant fields, excluding sensitive ones like password or full token details
    const result = await pool.query(
      'SELECT id, name, type, host, username, status, last_sync, vsphere_subtype, created_at, updated_at FROM hypervisors ORDER BY created_at DESC'
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching hypervisors from DB:', err);
    res.status(500).json({ error: 'Failed to retrieve hypervisors' });
  }
});
// POST /api/hypervisors - Create new hyperviso
app.post('/api/hypervisors', authenticate, requireAdmin, async (req, res) => {
  const { host, username, password, apiToken, tokenName, type, vsphere_subtype } = req.body;

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
              // Si no tiene puerto, añadir el puerto por defecto para ESXi
              else {
                  vsphereApiUrl += ':443';
              }
          }
          // Extraer el hostname limpio para la base de datos
          try {
              cleanHost = new URL(vsphereApiUrl).hostname;
          } catch (urlError) {
              console.error(`Invalid URL format: ${vsphereApiUrl}`);
              throw new Error(`Invalid host format: ${host}`);
          }

          // Configurar agente para manejar certificados auto-firmados con opciones avanzadas
          const agent = new https.Agent({
            rejectUnauthorized: false, // Para entornos de prueba/desarrollo
            secureOptions: cryptoConstants.SSL_OP_NO_SSLv3 | cryptoConstants.SSL_OP_NO_TLSv1, // Use imported constants
            ciphers: 'ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES256-GCM-SHA384',
            minVersion: 'TLSv1.2'
          });

          let sessionId = null;
          vsphereSubtype = 'unknown'; // Valor inicial

          try {
              // Intentar múltiples enfoques de autenticación, empezando con el más probable para ESXi 6.7
              console.log(`Trying ESXi 6.7 authentication methods for ${vsphereApiUrl}`);

              // 1. Primer intento: REST API (disponible en ESXi 6.7)
              console.log(`Attempting modern REST API authentication: ${vsphereApiUrl}/rest/com/vmware/cis/session`);
              let authResponse;
              try {
                  authResponse = await fetch(`${vsphereApiUrl}/rest/com/vmware/cis/session`, {
                      method: 'POST',
                      headers: {
                          'Authorization': `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
                          'Accept': 'application/json',
                          'Content-Type': 'application/json',
                          'vmware-use-header-authn': 'true'
                      },
                      body: JSON.stringify({}), // Add empty JSON body

                      agent: agent,
                      timeout: 10000 // 10 segundos de timeout
                  });

                  console.log(`REST API auth response status: ${authResponse.status}`);

                  if (authResponse.ok) {
                      const sessionData = await authResponse.json();
                      sessionId = sessionData.value;

                      if (!sessionId) {
                          console.warn('Session ID not received from vSphere REST API');
                      } else {
                        console.log(`vSphere REST API session obtained: ${sessionId.substring(0, 10)}...`);
                        // Autenticación exitosa, ahora sondear para diferenciar vCenter de ESXi
                        try {
                            console.log(`Probing for vCenter specific endpoint: ${vsphereApiUrl}/rest/vcenter`);
                            const probeResponse = await fetch(`${vsphereApiUrl}/rest/vcenter`, { // Endpoint base de vCenter
                                method: 'GET',
                                headers: { 'vmware-api-session-id': sessionId, 'Accept': 'application/json' },
                                agent: agent,
                                timeout: 7000 // Timeout corto para el sondeo
                            });
                            console.log(`vCenter probe response status: ${probeResponse.status}`);
                            if (probeResponse.ok) { // Si /rest/vcenter es accesible, es vCenter
                                vsphereSubtype = 'vcenter';
                                console.log('Determined subtype: vCenter based on probe.');
                            } else {
                                vsphereSubtype = 'esxi'; // Sino, es un ESXi moderno
                                console.log(`Determined subtype: ESXi (modern) - probe to /rest/vcenter status ${probeResponse.status}.`);
                            }
                        } catch (probeError) {
                            console.warn(`vCenter probe error: ${probeError.message}. Assuming ESXi (modern).`);
                            vsphereSubtype = 'esxi';
                        }
                        status = 'connected';
                        lastSync = new Date();
                      }
                  } else {
                      console.warn(`REST API auth failed with status: ${authResponse.status}`);
                      // Intentar leer el cuerpo de error para más detalles
                      try {
                          const errorBody = await authResponse.text();
                          console.warn(`Auth error details: ${errorBody.substring(0, 500)}`);
                      } catch (e) {
                          console.warn('Could not read error response body');
                      }
                  }
              } catch (restAuthError) {
                  console.warn(`REST API auth connection error: ${restAuthError.message}`);
              }

              // 2. Si falla la API REST, intentar con la autenticación de la interfaz web
              if (status !== 'connected') { // Solo intentar si el método anterior falló en conectar
                  console.log(`Trying UI login method for ESXi: ${vsphereApiUrl}/ui/login`);
                  try {
                      const formData = new URLSearchParams();
                      formData.append('userName', username);
                      formData.append('password', password);

                      const uiLoginResponse = await fetch(`${vsphereApiUrl}/ui/login`, {
                          method: 'POST',
                          headers: {
                              'Content-Type': 'application/x-www-form-urlencoded'
                          },
                          body: formData.toString(),
                          agent: agent,
                          redirect: 'manual', // No seguir redirecciones
                          timeout: 10000
                      });

                      console.log(`UI login response status: ${uiLoginResponse.status}`);

                      // ESXi UI login normalmente devuelve 302 con cookies de sesión
                      const cookies = uiLoginResponse.headers.get('set-cookie');

                      if (uiLoginResponse.status === 302 && cookies) {
                          console.log(`ESXi UI session obtained via cookies`);
                          vsphereSubtype = 'esxi';
                          status = 'connected';
                          lastSync = new Date();
                      } else {
                          // Inspeccionar errores UI
                          console.warn('UI login failed without proper redirect/cookies');
                          try {
                              const uiErrorBody = await uiLoginResponse.text();
                              console.warn(`UI login error details: ${uiErrorBody.substring(0, 200)}...`);
                          } catch (e) {
                              console.warn('Could not read UI error response');
                          }
                      }
                  } catch (uiLoginError) {
                      console.warn(`UI login error: ${uiLoginError.message}`);
                  }
              }

              // 3. Intentar con el endpoint /sdk para ESXi SOAP API (último recurso)
              if (status !== 'connected') { // Solo intentar si los métodos anteriores fallaron
                  console.log(`Trying SOAP API check for ESXi: ${vsphereApiUrl}/sdk`);
                  try {
                      const soapCheckResponse = await fetch(`${vsphereApiUrl}/sdk`, {
                          method: 'GET',
                          headers: {
                              'Authorization': `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
                          },
                          agent: agent,
                          timeout: 10000
                      });

                      console.log(`SOAP API check status: ${soapCheckResponse.status}`);

                      // Si logramos acceder al endpoint SOAP, es una buena señal
                      if (soapCheckResponse.status === 200 || soapCheckResponse.status === 401) { // Accept 401 as endpoint existing
                        // 401 podría significar que necesitamos configurar mejor la autenticación SOAP
                          // pero al menos el endpoint existe
                          if (soapCheckResponse.status === 200) {
                              console.log('SOAP API access verified');
                              vsphereSubtype = 'esxi';
                              status = 'connected';
                              lastSync = new Date();
                          } else {
                              console.warn('SOAP API endpoint exists but authentication failed');
                          }
                      }
                  } catch (soapError) {
                      console.warn(`SOAP API check error: ${soapError.message}`);
                  }
              }

              // Si todos los métodos fallan, lanzar error
              if (!status || status !== 'connected') {
                            // Don't throw here, just set status to error and let the outer catch handle response
                            status = 'error';
                            console.error('Authentication failed with all ESXi 6.7 compatible methods');
                            // Store the specific error message if needed for the final response
                            // vsphereError = new Error('Authentication failed with all ESXi 6.7 compatible methods');

              }

          } catch (vsphereError) {
              console.error(`vSphere connection failed for ${vsphereApiUrl}:`, vsphereError.message);
              status = 'error';
              throw new Error(`vSphere connection failed: ${vsphereError.message}`);
          } finally {
              // Cerrar sesión si existe sessionId de REST API
              if (sessionId) {
                  try {
                      //console.log(`Logging out vSphere REST API session ${sessionId.substring(0, 10)}...`);
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
              (type === 'vsphere' ? password : (apiToken || null)), // api_token: vSphere password or Proxmox token secret
              (type === 'proxmox' ? (tokenName || null) : null),     
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
     // Modificación para la parte de vSphere en el código existente
// --- Lógica de Conexión a vSphere mejorada para ESXi 6.7 ---
else if (type === 'vsphere') {
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
      // Si no tiene puerto, añadir el puerto por defecto para ESXi
      else {
          vsphereApiUrl += ':443';
      }
  }

  // Extraer el hostname limpio para la base de datos
  try {
      cleanHost = new URL(vsphereApiUrl).hostname;
  } catch (urlError) {
      console.error(`Invalid URL format: ${vsphereApiUrl}`);
      throw new Error(`Invalid host format: ${host}`);
  }

  // Configurar agente para manejar certificados auto-firmados con opciones avanzadas
  const agent = new https.Agent({
    rejectUnauthorized: false, // Para entornos de prueba/desarrollo
    secureOptions: cryptoConstants.SSL_OP_NO_SSLv3 | cryptoConstants.SSL_OP_NO_TLSv1, // Use imported constants
    ciphers: 'ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES256-GCM-SHA384',
    minVersion: 'TLSv1.2'
  });

  let sessionId = null;
  vsphereSubtype = 'unknown'; // Valor inicial

  try {
      // Intentar múltiples enfoques de autenticación, empezando con el más probable para ESXi 6.7
      console.log(`Trying ESXi 6.7 authentication methods for ${vsphereApiUrl}`);

      // 1. Primer intento: REST API (disponible en ESXi 6.7)
      console.log(`Attempting modern REST API authentication: ${vsphereApiUrl}/rest/com/vmware/cis/session`);
      let authResponse;
      try {
          authResponse = await fetch(`${vsphereApiUrl}/rest/com/vmware/cis/session`, {
              method: 'POST',
              headers: {
                  'Authorization': `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
                  'Accept': 'application/json',
                  'Content-Type': 'application/json',
                  'vmware-use-header-authn': 'true'
              },
              body: JSON.stringify({}), // Add empty JSON body

              agent: agent,
              timeout: 10000 // 10 segundos de timeout
          });

          console.log(`REST API auth response status: ${authResponse.status}`);

          if (authResponse.ok) {
              const sessionData = await authResponse.json();
              sessionId = sessionData.value;

              if (!sessionId) {
                  console.warn('Session ID not received from vSphere REST API');
              } else {
                  console.log(`vSphere REST API session obtained: ${sessionId.substring(0, 10)}...`);
                  vsphereSubtype = 'esxi';
                  status = 'connected';
                  lastSync = new Date();
              }
          } else {
              console.warn(`REST API auth failed with status: ${authResponse.status}`);
              // Intentar leer el cuerpo de error para más detalles
              try {
                  const errorBody = await authResponse.text();
                  console.warn(`Auth error details: ${errorBody}`);
              } catch (e) {
                  console.warn('Could not read error response body');
              }
          }
      } catch (restAuthError) {
          console.warn(`REST API auth error: ${restAuthError.message}`);
      }

      // 2. Si falla la API REST, intentar con la autenticación de la interfaz web
      if (!sessionId) {
          console.log(`Trying UI login method for ESXi: ${vsphereApiUrl}/ui/login`);
          try {
              const formData = new URLSearchParams();
              formData.append('userName', username);
              formData.append('password', password);

              const uiLoginResponse = await fetch(`${vsphereApiUrl}/ui/login`, {
                  method: 'POST',
                  headers: {
                      'Content-Type': 'application/x-www-form-urlencoded'
                  },
                  body: formData.toString(),
                  agent: agent,
                  redirect: 'manual', // No seguir redirecciones
                  timeout: 10000
              });

              console.log(`UI login response status: ${uiLoginResponse.status}`);

              // ESXi UI login normalmente devuelve 302 con cookies de sesión
              const cookies = uiLoginResponse.headers.get('set-cookie');

              if (uiLoginResponse.status === 302 && cookies) {
                  console.log(`ESXi UI session obtained via cookies`);
                  vsphereSubtype = 'esxi';
                  status = 'connected';
                  lastSync = new Date();
              } else {
                  // Inspeccionar errores UI
                  console.warn('UI login failed without proper redirect/cookies');
                  try {
                      const uiErrorBody = await uiLoginResponse.text();
                      console.warn(`UI login error details: ${uiErrorBody.substring(0, 200)}...`);
                  } catch (e) {
                      console.warn('Could not read UI error response');
                  }
              }
          } catch (uiLoginError) {
              console.warn(`UI login error: ${uiLoginError.message}`);
          }
      }

      // 3. Intentar con el endpoint /sdk para ESXi SOAP API (último recurso)
      if (!status || status !== 'connected') {
          console.log(`Trying SOAP API check for ESXi: ${vsphereApiUrl}/sdk`);
          try {
              const soapCheckResponse = await fetch(`${vsphereApiUrl}/sdk`, {
                  method: 'GET',
                  headers: {
                      'Authorization': `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
                  },
                  agent: agent,
                  timeout: 10000
              });

              console.log(`SOAP API check status: ${soapCheckResponse.status}`);

              // Si logramos acceder al endpoint SOAP, es una buena señal
              if (soapCheckResponse.status === 200 || soapCheckResponse.status === 401) { // Accept 401 as endpoint existing
                // 401 podría significar que necesitamos configurar mejor la autenticación SOAP
                  // pero al menos el endpoint existe
                  if (soapCheckResponse.status === 200) {
                      console.log('SOAP API access verified');
                      vsphereSubtype = 'esxi';
                      status = 'connected';
                      lastSync = new Date();
                  } else {
                      console.warn('SOAP API endpoint exists but authentication failed');
                  }
              }
          } catch (soapError) {
              console.warn(`SOAP API check error: ${soapError.message}`);
          }
      }

      // Si todos los métodos fallan, lanzar error
      if (!status || status !== 'connected') {
                    // Don't throw here, just set status to error and let the outer catch handle response
                    status = 'error';
                    console.error('Authentication failed with all ESXi 6.7 compatible methods');
                    // Store the specific error message if needed for the final response
                    // vsphereError = new Error('Authentication failed with all ESXi 6.7 compatible methods');

      }

  } catch (vsphereError) {
      console.error(`vSphere connection/authentication process failed for ${vsphereApiUrl}:`, vsphereError.message);
      status = 'error';
      throw new Error(`vSphere connection failed: ${vsphereError.message}`);
  } finally {
      // Cerrar sesión si existe sessionId de REST API
      if (sessionId) {
          try {
              console.log(`Logging out vSphere REST API session ${sessionId.substring(0, 10)}...`);
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
  // Check if connection failed during the process
  if (status !== 'connected') {
    // Throw an error here to be caught by the main try...catch block
    throw new Error('vSphere connection failed during authentication attempts.');
}
}
      // Errores de conexión generales
      else if (error.code === 'ECONNREFUSED') {
          errorInfo.code = 503;
          errorInfo.message = 'Connection refused';
          errorInfo.suggestion = `Check ${type} service and firewall rules`;
      } else {
          // Otros errores
          errorInfo.message = error.message || 'An unknown error occurred during hypervisor creation/connection.';
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

    // If connected, try to fetch details based on type
    if (hypervisor.status === 'connected' && hypervisor.type === 'proxmox') { // Proxmox Logic
      console.log(`Hypervisor ${id} is connected, fetching details...`);
      try {
        const [dbHost, dbPortStr] = hypervisor.host.split(':');
        const port = dbPortStr ? parseInt(dbPortStr, 10) : 8006;
        const cleanHost = dbHost;
        const proxmoxConfig = {
          host: cleanHost, port: port, username: hypervisor.username,
          tokenID: `${hypervisor.username}!${hypervisor.token_name}`,
          tokenSecret: hypervisor.api_token, timeout: 15000, rejectUnauthorized: false
        };
        const proxmox = proxmoxApi(proxmoxConfig);

        const [basicNodesData, storageData, templatesData] = await Promise.all([
          proxmox.nodes.$get().catch(e => { console.error(`Error fetching basic node list for ${id}:`, e.message); return []; }), // Fetch basic node list
          proxmox.storage.$get().catch(e => { console.error(`Error fetching storage for ${id}:`, e.message); return []; }), // Fetch storage
          fetchProxmoxTemplates(proxmox).catch(e => { console.error(`Error fetching templates for ${id}:`, e.message); return []; }) // Use helper for templates
        ]);

        const detailedNodesData = await Promise.all(
          basicNodesData.map(async (node) => {
            try {
              const nodeStatus = await proxmox.nodes.$(node.node).status.$get();
              const diskInfo = await proxmox.nodes.$(node.node).disks.list.$get().catch(diskError => {
                console.error(`Error fetching disks for node ${node.node}:`, diskError.message);
                return []; // Return empty array on error
              });
              const totalLogicalCpus = (nodeStatus.cpuinfo?.cores || 0) * (nodeStatus.cpuinfo?.sockets || 1);
              return {
                ...node,
                detailedStatus: nodeStatus,
                physicalDisks: diskInfo,
                status: node.status,
                cpu: { cores: totalLogicalCpus, usage: nodeStatus.cpu || 0 },
                memory: { total: nodeStatus.memory?.total || 0, used: nodeStatus.memory?.used || 0, free: nodeStatus.memory?.free || 0 },
                rootfs: nodeStatus.rootfs ? { total: nodeStatus.rootfs.total || 0, used: nodeStatus.rootfs.used || 0 } : undefined,
              };
            } catch (nodeStatusError) {
              console.error(`Error fetching status for node ${node.node}:`, nodeStatusError.message);
              return { ...node, detailedStatus: null, physicalDisks: [], status: 'unknown', cpu: undefined, memory: undefined, rootfs: undefined };
            }
          })
        );

        hypervisor.nodes = detailedNodesData;
        hypervisor.storage = storageData;
        hypervisor.templates = templatesData;
        console.log(`Fetched details for ${id}: ${detailedNodesData.length} nodes, ${storageData.length} storage, ${templatesData.length} templates`);

        let aggTotalCpuCores = 0;
        let aggUsedCpuCores = 0;
        let aggTotalMemoryBytes = 0;
        let aggUsedMemoryBytes = 0;
        let aggTotalDiskBytes = 0;
        let aggUsedDiskBytes = 0;

        const { rows: activePlans } = await pool.query(
          'SELECT id, name, specs FROM vm_plans WHERE is_active = true ORDER BY name'
        );
        console.log(`Fetched ${activePlans.length} active VM plans for capacity calculation.`);

        if (detailedNodesData.length > 0) {
            detailedNodesData.forEach(node => {
                if (!node.detailedStatus) return; // Skip nodes where status fetch failed
                const nodeTotalLogicalCpus = node.cpu?.cores || 0;
                aggTotalCpuCores += nodeTotalLogicalCpus;
                aggUsedCpuCores += (node.cpu?.usage || 0) * nodeTotalLogicalCpus;
                aggTotalMemoryBytes += node.memory?.total || 0;
                aggUsedMemoryBytes += node.memory?.used || 0;

                const nodeAvailableCpuCores = Math.max(0, (node.cpu?.cores || 0) * (1 - (node.cpu?.usage || 0)));
                const nodeAvailableMemoryBytes = node.memory?.free || 0;
                const nodeAvailableDiskBytes = Math.max(0, (node.rootfs?.total || 0) - (node.rootfs?.used || 0));

                node.planCapacityEstimates = activePlans.map(plan => {
                  const planCpu = plan.specs?.cpu || 0;
                  const planMemoryMB = plan.specs?.memory || 0;
                  const planDiskGB = plan.specs?.disk || 0;
                  const planMemoryBytes = planMemoryMB * 1024 * 1024;
                  const planDiskBytes = planDiskGB * 1024 * 1024 * 1024;
                  const maxByCpu = planCpu > 0 ? Math.floor(nodeAvailableCpuCores / planCpu) : Infinity;
                  const maxByMemory = planMemoryBytes > 0 ? Math.floor(nodeAvailableMemoryBytes / planMemoryBytes) : Infinity;
                  const maxByDisk = planDiskBytes > 0 ? Math.floor(nodeAvailableDiskBytes / planDiskBytes) : Infinity;
                  const estimatedCount = Math.min(maxByCpu, maxByMemory, maxByDisk);
                  const finalCount = estimatedCount === Infinity ? 0 : estimatedCount;
                  return {
                    planId: plan.id,
                    planName: plan.name,
                    estimatedCount: finalCount,
                    specs: plan.specs
                  };
                });
            });
        }

        if (storageData.length > 0) {
            storageData.forEach(storage => {
                aggTotalDiskBytes += Number(storage.total) || 0;
                aggUsedDiskBytes += Number(storage.used) || 0;
            });
        }

        const aggAvgCpuUsagePercent = aggTotalCpuCores > 0 ? (aggUsedCpuCores / aggTotalCpuCores) * 100 : 0;

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
        console.error(`Failed to fetch Proxmox details for connected hypervisor ${id}:`, detailError);
        hypervisor.detailsError = detailError.message || 'Failed to load details';
      }
    } else if (hypervisor.status === 'connected' && hypervisor.type === 'vsphere') { // vSphere Logic
      console.log(`Hypervisor ${id} is connected, fetching vSphere details...`);
      let vsphereClient;
      try {
        vsphereClient = await getVSphereClient(hypervisor.id);

        // Fetch Nodes (ESXi Hosts)
        let vsphereHostsRaw = [];
        if (vsphereClient.vsphereSubtype === 'vcenter') {
          const hostsResponse = await vsphereClient.get('/rest/vcenter/host');
          vsphereHostsRaw = hostsResponse.value || [];
        } else if (vsphereClient.vsphereSubtype === 'esxi') {
          // Represent the ESXi itself as a node
          vsphereHostsRaw = [{ // Simplified representation for standalone ESXi
            host: hypervisor.id, name: hypervisor.name || 'ESXi Host',
            connection_state: 'CONNECTED', power_state: 'POWERED_ON',
            cpu_count: 0, memory_size: 0, // Placeholders, ideally fetch real stats
          }];
        }
        hypervisor.nodes = vsphereHostsRaw.map(h => ({
          id: h.host, name: h.name,
          status: h.connection_state === 'CONNECTED' && h.power_state === 'POWERED_ON' ? 'online' : 'offline',
          cpu: { cores: h.cpu_count || 0, usage: 0 }, // Usage would need perf counters
          memory: { total: h.memory_size || 0, used: 0, free: 0 }, // Usage would need perf counters
        }));

        // Fetch Storage (Datastores)
        const datastoresResponse = await vsphereClient.get('/rest/vcenter/datastore');
        const vsphereDatastoresRaw = datastoresResponse.value || datastoresResponse;
        hypervisor.storage = Array.isArray(vsphereDatastoresRaw) ? vsphereDatastoresRaw.map(ds => ({
          id: ds.datastore, name: ds.name, type: ds.type,
          size: ds.capacity || 0,
          used: (ds.capacity && ds.free_space !== undefined) ? (ds.capacity - ds.free_space) : 0,
          available: ds.free_space || 0,
        })) : [];

        // Fetch Templates & ISOs
        const vmTemplates = await fetchVSphereVMTemplates(vsphereClient);
        const isoFiles = await fetchVSphereIsoFiles(vsphereClient);
        hypervisor.templates = vmTemplates.concat(isoFiles);

        console.log(`Fetched vSphere details for ${id}: ${hypervisor.nodes.length} nodes, ${hypervisor.storage.length} templates`);

        // Calculate Aggregated Stats for vSphere
        let aggTotalCpuCores = 0;
        let aggTotalMemoryBytes = 0;
        let aggUsedMemoryBytes = 0; // Placeholder, real usage is complex

        hypervisor.nodes.forEach(node => {
          aggTotalCpuCores += node.cpu?.cores || 0;
          aggTotalMemoryBytes += node.memory?.total || 0;
          // Note: Accurate used CPU/Memory for vSphere often requires querying performance counters,
          // which is more involved. For now, avgCpuUsagePercent will be 0.
        });

        let aggTotalDiskBytes = 0;
        let aggUsedDiskBytes = 0;
        hypervisor.storage.forEach(s => {
          aggTotalDiskBytes += s.size || 0;
          aggUsedDiskBytes += s.used || 0;
        });

        hypervisor.aggregatedStats = {
          totalCores: aggTotalCpuCores,
          avgCpuUsagePercent: 0, // Placeholder for vSphere, as detailed usage is complex
          totalMemoryBytes: aggTotalMemoryBytes,
          usedMemoryBytes: aggUsedMemoryBytes, // Placeholder
          totalDiskBytes: aggTotalDiskBytes,
          usedDiskBytes: aggUsedDiskBytes,
          storagePoolCount: hypervisor.storage.length
        };
        console.log(`Added vSphere aggregated stats for ${id}:`, hypervisor.aggregatedStats);

        // Plan Capacity Estimates for vSphere Nodes (Simplified)
        if (hypervisor.nodes.length > 0) {
          const { rows: activePlans } = await pool.query(
            'SELECT id, name, specs FROM vm_plans WHERE is_active = true ORDER BY name'
          );
          hypervisor.nodes.forEach(node => {
            const nodeAvailableCpuCores = node.cpu?.cores || 0; // Simplified: assumes all cores are available
            const nodeAvailableMemoryBytes = node.memory?.total || 0; // Simplified: assumes all memory is available

            node.planCapacityEstimates = activePlans.map(plan => {
              const planCpu = plan.specs?.cpu || 0;
              const planMemoryMB = plan.specs?.memory || 0;
              const planMemoryBytes = planMemoryMB * 1024 * 1024;
              // Disk capacity for vSphere is typically from shared datastores, so per-node disk estimate is less direct.
              // We'll focus on CPU/Memory for per-node estimate here.
              const maxByCpu = planCpu > 0 ? Math.floor(nodeAvailableCpuCores / planCpu) : Infinity;
              const maxByMemory = planMemoryBytes > 0 ? Math.floor(nodeAvailableMemoryBytes / planMemoryBytes) : Infinity;
              const estimatedCount = Math.min(maxByCpu, maxByMemory);
              return {
                planId: plan.id, planName: plan.name,
                estimatedCount: estimatedCount === Infinity ? 0 : estimatedCount,
                specs: plan.specs
              };
            });
          });
        }
      } catch (detailError) {
        console.error(`Failed to fetch vSphere details for connected hypervisor ${id}:`, detailError);
        hypervisor.detailsError = detailError.message || 'Failed to load vSphere details';
      } finally {
        if (vsphereClient) {
          await vsphereClient.logout();
        }
      }
    }

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
  let allTemplatesMap = new Map(); // Use a Map for deduplication
  const nodes = await proxmox.nodes.$get();
  for (const node of nodes) {
    try { // Add try-catch for storage/content fetching per node
      const storageList = await proxmox.nodes.$(node.node).storage.$get();
      for (const storage of storageList) {
        // Check if storage is active and readable - skip if not active?
        // if (!storage.active) continue;

        if (storage.content.includes('iso') || storage.content.includes('vztmpl') || storage.content.includes('template')) { // Added 'template' for VM templates
          const content = await proxmox.nodes.$(node.node).storage.$(storage.storage).content.$get();
          content
            .filter(item => item.content === 'iso' || item.content === 'vztmpl' || item.template === 1) // Check 'template' flag for VM templates
            .forEach(item => { // Use forEach instead of map+concat
              const templateId = item.volid;
              if (!allTemplatesMap.has(templateId)) { // Add only if not already present
                allTemplatesMap.set(templateId, {
                  id: templateId, // e.g., local:iso/ubuntu.iso or local:100/vm-100-disk-0.qcow2 for templates
                  name: item.volid.split('/')[1] || item.volid, // Basic name extraction
                  description: item.volid,
                  size: item.size,
                  path: item.volid,
                  // Determine type more accurately
                  type: item.content === 'iso' ? 'iso' : (item.template === 1 ? 'template' : 'vztmpl'),
                  version: item.format,
                  storage: storage.storage,
                  // Add hypervisorType and specs if possible/needed for VMTemplate type
                  // hypervisorType: 'proxmox', // Assuming proxmox here
                  // specs: {}, // Default or fetch specs if possible
                });
              }
            });
        }
      }
    } catch (nodeError) {
        console.error(`Error fetching storage/content for node ${node.node}: ${nodeError.message}`);
        // Continue with the next node
    }
  }
  return Array.from(allTemplatesMap.values()); // Convert Map values back to an array
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

// POST /api/hypervisors/:id/connect
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

      const encodedTokenName = encodeURIComponent(hypervisor.token_name);

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
  const MAX_DAYS_FOR_DAILY_COUNTS = 90; // Maximum range to return daily counts
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
    // Calculate total count
    const totalCountResult = await pool.query(
      'SELECT COUNT(*) FROM virtual_machines WHERE created_at >= $1 AND created_at < $2',
      [start, endOfDay] // Use adjusted end date for the query
    );
    const count = parseInt(totalCountResult.rows[0].count, 10);
    console.log(`Found ${count} VMs created between ${startDate} and ${endDate}`);

    let dailyCounts = null;

    // Calculate daily counts if the range is within the limit
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 to include start/end days

    if (diffDays <= MAX_DAYS_FOR_DAILY_COUNTS) {
      console.log(`Date range (${diffDays} days) is within limit (${MAX_DAYS_FOR_DAILY_COUNTS}), calculating daily counts.`);
      const dailyResult = await pool.query(
        `SELECT DATE(created_at) as date, COUNT(*) as count
         FROM virtual_machines
         WHERE created_at >= $1 AND created_at < $2
         GROUP BY DATE(created_at)
         ORDER BY date ASC`,
        [start, endOfDay]
      );
      // Format date to YYYY-MM-DD string
      dailyCounts = dailyResult.rows.map(row => ({
        date: new Date(row.date).toISOString().split('T')[0],
        count: parseInt(row.count, 10)
      }));
      console.log(`Calculated daily counts for ${dailyCounts.length} days.`);
    } else {
      console.log(`Date range (${diffDays} days) exceeds limit (${MAX_DAYS_FOR_DAILY_COUNTS}), skipping daily counts.`);
    }

    res.json({ count, startDate, endDate, dailyCounts }); // Include dailyCounts in the response

  } catch (err) {
    console.error('Error fetching VM creation stats:', err);
    res.status(500).json({ error: 'Failed to retrieve VM creation statistics' });
  }
});

// GET /api/stats/client-vms/:clientId - Get VMs for a specific client with pagination
app.get('/api/stats/client-vms/:clientId', authenticate, async (req, res) => {
  const { clientId } = req.params;
  const page = parseInt(req.query.page || '1', 10);
  const limit = parseInt(req.query.limit || '5', 10); // Default to 5 VMs per page
  const offset = (page - 1) * limit;

  console.log(`--- GET /api/stats/client-vms/${clientId} --- Page: ${page}, Limit: ${limit}`);

  if (!clientId) {
    return res.status(400).json({ error: 'Client ID is required.' });
  }

  try {
    const vmsQuery = `
      SELECT
        vm.id as database_id, -- Keep the UUID if needed elsewhere
        vm.hypervisor_vm_id as id, -- Use hypervisor_vm_id as the primary ID for linking
        vm.name,
        vm.status,
        vm.created_at,
        vm.cpu_cores,
        vm.memory_mb,
        vm.disk_gb,
        vm.os,
        vm.hypervisor_id,
        h.type as hypervisor_type
      FROM virtual_machines vm
      JOIN hypervisors h ON vm.hypervisor_id = h.id
      WHERE vm.final_client_id = $1
      ORDER BY vm.created_at DESC
      LIMIT $2 OFFSET $3
    `;
    const vmsResult = await pool.query(vmsQuery, [clientId, limit, offset]);

    const countQuery = 'SELECT COUNT(*) FROM virtual_machines WHERE final_client_id = $1';
    const countResult = await pool.query(countQuery, [clientId]);

    const totalItems = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalItems / limit);

    // Map to VM type structure expected by frontend
    const formattedVms = vmsResult.rows.map(dbVm => ({
      id: dbVm.id, // This is now the hypervisor_vm_id
      databaseId: dbVm.database_id, // The UUID from the DB
      name: dbVm.name,
      status: dbVm.status,
      createdAt: dbVm.created_at,
      hypervisorId: dbVm.hypervisor_id,
      hypervisorType: dbVm.hypervisor_type,
      specs: {
        cpu: dbVm.cpu_cores,
        memory: dbVm.memory_mb,
        disk: dbVm.disk_gb,
        os: dbVm.os,
      }
      // nodeName, tags, ipAddresses are not in the DB table directly
    }));

    res.json({ items: formattedVms, pagination: { currentPage: page, totalPages, totalItems, limit } });
  } catch (err) {
    console.error(`Error fetching VMs for client ${clientId}:`, err);
    res.status(500).json({ error: 'Failed to retrieve VMs for the client.' });
  }
});

// --- End Final Client CRUD API Routes ---


// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
