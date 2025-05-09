import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Database, Server, Plus, Trash2, Users, UserPlus, Briefcase, Search, ChevronLeft, ChevronRight, Edit } from 'lucide-react'; // Removed Moon, Sun, Globe
// import { supabase } from '../lib/supabase'; // No longer needed
import { useAuth } from '../hooks/useAuth'; // Import useAuth to get token
import { toast } from 'react-hot-toast'; // Import toast for feedback
import type { User } from '../types/auth'; // Import User type
import type { VMPlan } from '../types/vm';
import type { FinalClient } from '../types/client'; // Import FinalClient type

export default function Settings() {
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
  // const [emailNotifications, setEmailNotifications] = useState(true);
  const { user: currentUser, token: authToken  } = useAuth(); // Get current user info for token
  // const [slackNotifications, setSlackNotifications] = useState(false);
  // const [autoBackups, setAutoBackups] = useState(true);
  // const [apiKey, setApiKey] = useState('');
  // const [isGeneratingKey, setIsGeneratingKey] = useState(false);
  const [plans, setPlans] = useState<VMPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true); // Combined loading state for plans
  const [newPlan, setNewPlan] = useState<Partial<VMPlan>>({
    name: '',
    description: '',
    specs: {
      cpu: 1,
      memory: 1024,
      disk: 20
    },
    is_active: true
  });
  const [users, setUsers] = useState<User[]>([]); // Use User type
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [newUser, setNewUser] = useState({
    username: '',
    email: '',
    password: '',
    role_name: 'user' // Default role
  });
   // State for Final Clients
   const [clients, setClients] = useState<FinalClient[]>([]);
   const [isLoadingClients, setIsLoadingClients] = useState(false);
   const [clientSearchTerm, setClientSearchTerm] = useState('');
   const [clientCurrentPage, setClientCurrentPage] = useState(1);
   const [clientTotalPages, setClientTotalPages] = useState(1);
   const [newClient, setNewClient] = useState<Partial<FinalClient>>({
     name: '',
     rif: '',
     contact_info: {},
     additional_info: ''
     });


  useEffect(() => {
    fetchPlans();
    fetchUsers(); // Fetch users on mount
    fetchClients();
  }, [authToken]);

  // Helper to get the auth token
  const getAuthToken = () => {
    if (!authToken) toast.error("Authentication token not found. Please log in again.");
    return authToken ? `Bearer ${authToken}` : null;
 
  };

  const fetchClients = async (page = 1, search = clientSearchTerm) => {
    if (!authToken) {
      toast.error("Authentication token not found. Please log in again.");
      return;
    }
    setIsLoadingClients(true);
    try {
      const response = await fetch(`${API_BASE_URL}/final-clients?page=${page}&limit=10&search=${encodeURIComponent(search)}`, {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      if (!response.ok) throw new Error('Failed to fetch clients');
      const data = await response.json();
      setClients(data.items || []);
      setClientCurrentPage(data.pagination.currentPage);
      setClientTotalPages(data.pagination.totalPages);
    } catch (error) {
      console.error('Error fetching clients:', error);
      toast.error('Could not load final clients.');
      setClients([]); // Clear clients on error
    } finally {
      setIsLoadingClients(false);
    }
  };

  // Effect to refetch clients when search term changes (with debounce)
  useEffect(() => {
    const handler = setTimeout(() => {
      if (authToken) fetchClients(1, clientSearchTerm);
  }, 500); // Debounce search    return () => clearTimeout(handler);
  }, [clientSearchTerm, authToken]);

  const fetchPlans = async () => {
    try {
      if (!authToken) { toast.error("Token no encontrado."); return; }

      setIsLoading(true); // Use the combined loading state
      const response = await fetch(`${API_BASE_URL}/vm-plans`, {
        headers: {
          'Authorization': `Bearer ${authToken}`, // Use the actual token
        },
      });
      if (!response.ok) {
        throw new Error('Failed to fetch plans');
      }
      const data = await response.json();

      setPlans(data || []);
    } catch (error) {
      console.error('Error fetching plans:', error);
      toast.error('Could not load VM plans.');
    } finally {
      // Make sure isLoading is set to false even if there's an error
      setIsLoading(false); // Use the combined loading state
    }
  };

  const fetchUsers = async () => {
    if (!authToken) { toast.error("Token no encontrado."); return; }

    setIsLoadingUsers(true);
    try {
      const response = await fetch(`${API_BASE_URL}/users`, {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      if (!response.ok) throw new Error('Failed to fetch users');
      const data = await response.json();
      setUsers(data || []);
    } catch (error) {
      console.error('Error fetching users:', error);
      toast.error('Could not load users.');
    } finally {
      setIsLoadingUsers(false);
    }
  };

  const handleAddPlan = async () => {
    if (!authToken) { toast.error("Token no encontrado."); return; }

    try {
      const response = await fetch(`${API_BASE_URL}/vm-plans`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          name: newPlan.name,
          description: newPlan.description,
          specs: newPlan.specs,
          is_active: true // Assuming new plans are active by default
        }),
      });

      if (!response.ok) throw new Error('Failed to add plan');
      const addedPlan = await response.json();
      setPlans([...plans, addedPlan]);
      setNewPlan({ // Reset form
        name: '',
        description: '',
        specs: {
          cpu: 1,
          memory: 1024,
          disk: 20
        },
        is_active: true
      });
      toast.success('VM Plan added successfully!');
    } catch (error) {
      console.error('Error adding plan:', error);
      toast.error('Failed to add VM plan.');
    }
  };
 
  const handleDeletePlan = async (id: string) => {
    if (!authToken) { toast.error("Token no encontrado."); return; }

    try {
      const response = await fetch(`${API_BASE_URL}/vm-plans/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      if (!response.ok) throw new Error('Failed to delete plan');

      // Check for 204 No Content status
      if (response.status === 204) {
        setPlans(plans.filter(plan => plan.id !== id));
        toast.success('VM Plan deleted.');
      } else {
        // Handle unexpected successful responses if needed
        const data = await response.json().catch(() => null); // Try to parse JSON, ignore if no body
        console.warn('Unexpected response status after delete:', response.status, data);
        toast.error('Plan deleted, but received unexpected server response.');
        // Still remove from list locally if server confirmed deletion despite status code
        setPlans(plans.filter(plan => plan.id !== id));
      }
    } catch (error) {
      console.error('Error deleting plan:', error);
      toast.error('Failed to delete VM plan.');
    }
  };

  const handleTogglePlan = async (id: string, is_active: boolean) => {
    if (!authToken) { toast.error("Token no encontrado."); return; }

    try {
      const response = await fetch(`${API_BASE_URL}/vm-plans/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ is_active }),
      });
      if (!response.ok) throw new Error('Failed to update plan status');
      const updatedPlan = await response.json();
      setPlans(plans.map(plan => (plan.id === id ? updatedPlan : plan)));
      toast.success(`Plan ${is_active ? 'activated' : 'deactivated'}.`);
    } catch (error) {
      console.error('Error updating plan:', error);
      toast.error('Failed to update plan status.');
    }
  };

  const handleAddClient = async () => {
    if (!authToken) { toast.error("Token no encontrado."); return; }

    if (!newClient.name || !newClient.rif) {
      toast.error("Name and RIF are required for a new client.");
      return;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/final-clients`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(newClient),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
        throw new Error(errorData.error || `Failed to add client (status: ${response.status})`);
      }
      toast.success('Final client added successfully!');
      setNewClient({ name: '', rif: '', contact_info: {}, additional_info: '' }); // Reset form
      fetchClients(clientCurrentPage); // Refresh client list on current page
    } catch (error: unknown) {
      console.error('Error adding client:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Failed to add client: ${message}`);
    }
  };

  const handleDeleteClient = async (clientId: string) => {
    if (!authToken) { toast.error("Token no encontrado."); return; }

    if (!window.confirm("Are you sure you want to delete this client? This action cannot be undone.")) return;

    try {
      const response = await fetch(`${API_BASE_URL}/final-clients/${clientId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
        throw new Error(errorData.error || `Failed to delete client (status: ${response.status})`);
      }

      if (response.status === 204) {
        toast.success('Client deleted successfully!');
        // Refetch, considering if the current page might become empty
        fetchClients(clients.length === 1 && clientCurrentPage > 1 ? clientCurrentPage - 1 : clientCurrentPage);
      } else {
        console.warn('Unexpected response status after client delete:', response.status);
        toast.error('Client deleted, but received unexpected server response.');
        fetchClients(clientCurrentPage); // Refresh list anyway
      }
    } catch (error: unknown) {
      console.error('Error deleting client:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Failed to delete client: ${message}`);
    }
  };

  // TODO: Implement Edit Client functionality


  const handleAddUser = async () => {
    if (!authToken) { toast.error("Token no encontrado."); return; }

    // Basic validation
    if (!newUser.username || !newUser.email || !newUser.password) {
      toast.error("Username, email, and password are required.");
      return;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(newUser),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
        throw new Error(errorData.error || `Failed to add user (status: ${response.status})`);
      }
      // const addedUser = await response.json(); // Use if needed
      toast.success('User added successfully!');
      setNewUser({ username: '', email: '', password: '', role_name: 'user' }); // Reset form
      fetchUsers(); // Refresh user list
    } catch (error: unknown) {
      console.error('Error adding user:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Failed to add user: ${message}`);
    }
  };

  // TODO: Implement Edit User functionality
  const handleEditUser = (user: User) => {
    toast(`Edit functionality for ${user.email} not yet implemented.`);
    // Logic to open modal or enable inline editing
  };

  // TODO: Implement Delete User functionality
  const handleDeleteUser = async (userId: string) => {
    if (!authToken) { toast.error("Token no encontrado."); return; }

    if (!window.confirm("Are you sure you want to delete this user? This action cannot be undone.")) return;

    try {
      // Call DELETE /api/users/:id
      const response = await fetch(`${API_BASE_URL}/users/${userId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
        throw new Error(errorData.error || `Failed to delete user (status: ${response.status})`);
      }

      if (response.status === 204) {
        toast.success('User deleted successfully!');
        fetchUsers(); // Refresh list
      } else {
        console.warn('Unexpected response status after user delete:', response.status);
        toast.error('User deleted, but received unexpected server response.');
        fetchUsers(); // Refresh list anyway
      }
    } catch (error: unknown) {
      console.error('Error deleting user:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Failed to delete user: ${message}`);
    }
  };

  // const handleGenerateApiKey = () => {
  //   setIsGeneratingKey(true);
  //   setTimeout(() => {
  //     setApiKey('vmf_' + Math.random().toString(36).substring(2, 15));
  //     setIsGeneratingKey(false);
  //   }, 1000);
  // };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Configuración</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1">
        Gestione su cuenta y sus preferencias de aplicación
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {/* VM Plans */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="card"
        >
          <div className="p-6">
            <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-4 flex items-center">
              <Server className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" />
              Planes Preestablecidos
            </h2>

            <div className="space-y-6">
              {/* Add New Plan Form */}
              <div className="border-b border-slate-200 dark:border-slate-700 pb-6">
                <h3 className="text-sm font-medium text-slate-900 dark:text-white mb-4">Agregar Nuevo Plan</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="form-label">Nombre del Plan</label>
                    <input
                      type="text"
                      className="form-input"
                      value={newPlan.name || ''}
                      onChange={(e) => setNewPlan(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="e.g., Basic Server"
                    />
                  </div>
                  <div>
                    <label className="form-label">Descripción</label>
                    <input
                      type="text"
                      className="form-input"
                      value={newPlan.description || ''}
                      onChange={(e) => setNewPlan(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="e.g., Perfect for small applications"
                    />
                  </div>
                  <div>
                    <label className="form-label">CPU Cores</label>
                    <input
                      type="number"
                      className="form-input"
                      value={newPlan.specs?.cpu || 1}
                      onChange={(e) => setNewPlan(prev => ({
                        ...prev,
                        specs: { ...prev.specs!, cpu: parseInt(e.target.value) || 1 }
                      }))}
                      min="1"
                      max="32"
                    />
                  </div>
                  <div>
                    <label className="form-label">Memoria (MB)</label>
                    <input
                      type="number"
                      className="form-input"
                      value={newPlan.specs?.memory || 1024}
                      onChange={(e) => setNewPlan(prev => ({
                        ...prev,
                        specs: { ...prev.specs!, memory: parseInt(e.target.value) || 512 }
                      }))}
                      min="512"
                      step="512"
                    />
                  </div>
                  <div>
                    <label className="form-label">Disco (GB)</label>
                    <input
                      type="number"
                      className="form-input"
                      value={newPlan.specs?.disk || 20}
                      onChange={(e) => setNewPlan(prev => ({
                        ...prev,
                        specs: { ...prev.specs!, disk: parseInt(e.target.value) || 10 }
                      }))}
                      min="10"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      className="btn btn-primary"
                      onClick={handleAddPlan}
                      disabled={!newPlan.name || !newPlan.description}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Agregar Plan
                    </button>
                  </div>
                </div>
              </div>

              {/* Existing Plans */}
              <div>
                <h3 className="text-sm font-medium text-slate-900 dark:text-white mb-4">Planes Registrados</h3>
                <div className="space-y-4">
                  {isLoading ? (
                    <div className="animate-pulse space-y-4">
                      {[1, 2, 3].map(i => (
                        <div key={i} className="h-20 bg-slate-200 dark:bg-slate-700 rounded-lg"></div>
                      ))}
                    </div>
                  ) : plans.length > 0 ? (
                    plans.map(plan => (
                      <div
                        key={plan.id}
                        className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-4 flex items-center justify-between"
                      >
                        <div>
                          <h4 className="font-medium text-slate-900 dark:text-white">{plan.name}</h4>
                          <p className="text-sm text-slate-500 dark:text-slate-400">{plan.description}</p>
                          <div className="mt-1 flex items-center space-x-4 text-xs text-slate-500 dark:text-slate-400">
                            <span>{plan.specs.cpu} CPU</span>
                            <span>{plan.specs.memory >= 1024 ? `${plan.specs.memory / 1024}GB` : `${plan.specs.memory}MB`} RAM</span>
                            <span>{plan.specs.disk}GB Almacenamiento</span>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          {/* Toggle Active Status */}
                          <div className="flex items-center">
                            <input
                              type="checkbox"
                              id={`active-${plan.id}`}
                              className="form-checkbox h-4 w-4 text-primary-600"
                              checked={plan.is_active}
                              onChange={(e) => handleTogglePlan(plan.id, e.target.checked)}
                            />
                            <label htmlFor={`active-${plan.id}`} className="ml-2 text-sm text-slate-700 dark:text-slate-300">
                              Activo
                            </label>
                          </div>
                          {/* Delete Button */}
                          <button
                            className="p-1 text-slate-500 hover:text-danger-500 dark:text-slate-400 dark:hover:text-danger-400"
                            onClick={() => handleDeletePlan(plan.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-6 text-slate-500 dark:text-slate-400">
                      No hay planes definidos
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </motion.section>

        {/* User Management */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="card"
        >
          <div className="p-6">
            <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-4 flex items-center">
              <Users className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" />
              Gestión de Usuarios
            </h2>

            <div className="space-y-6">
              {/* Add New User Form */}
              <div className="border-b border-slate-200 dark:border-slate-700 pb-6">
                <h3 className="text-sm font-medium text-slate-900 dark:text-white mb-4">Agregar Nuevo Usuario</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <label className="form-label">Username</label>
                    <input
                      type="text"
                      className="form-input"
                      value={newUser.username}
                      onChange={(e) => setNewUser(prev => ({ ...prev, username: e.target.value }))}
                      placeholder="e.g., john.doe"
                    />
                  </div>
                  <div>
                    <label className="form-label">Email</label>
                    <input
                      type="email"
                      className="form-input"
                      value={newUser.email}
                      onChange={(e) => setNewUser(prev => ({ ...prev, email: e.target.value }))}
                      placeholder="e.g., user@example.com"
                    />
                  </div>
                  <div>
                    <label className="form-label">Password</label>
                    <input
                      type="password"
                      className="form-input"
                      value={newUser.password}
                      onChange={(e) => setNewUser(prev => ({ ...prev, password: e.target.value }))}
                      placeholder="Min. 8 characters"
                    />
                  </div>
                  <div>
                    <label className="form-label">Role</label>
                    <select
                      className="form-select"
                      value={newUser.role_name}
                      onChange={(e) => setNewUser(prev => ({ ...prev, role_name: e.target.value }))}
                    >
                      <option value="user">User</option>
                      <option value="viewer">Viewer</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div className="flex items-end lg:col-span-2">
                    <button
                      className="btn btn-primary"
                      onClick={handleAddUser}
                      disabled={!newUser.username || !newUser.email || !newUser.password}
                    >
                      <UserPlus className="h-4 w-4 mr-2" />
                      Agregar Usuario
                    </button>
                  </div>
                </div>
              </div>

              {/* Existing Users Table */}
              <div>
                <h3 className="text-sm font-medium text-slate-900 dark:text-white mb-4">Usuarios Registrados</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
                    <thead className="bg-slate-50 dark:bg-slate-800">
                      <tr>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Username</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Email</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Role</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
                        <th scope="col" className="relative px-6 py-3">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-700">
                      {isLoadingUsers ? (
                        <tr>
                          <td colSpan={5} className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 dark:text-slate-400 text-center">Cargando usuarios...</td>
                        </tr>
                      ) : users.length > 0 ? (
                        users.map((user) => (
                          <tr key={user.id}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900 dark:text-white">{user.username}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 dark:text-slate-400">{user.email}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 dark:text-slate-400 capitalize">{user.role}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                              <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            user.is_active ? 'bg-success-100 dark:bg-success-900/30 text-success-800 dark:text-success-300' : 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-300'
                              }`}>
                                {user.is_active ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                              <button onClick={() => handleEditUser(user)} className="text-primary-600 hover:text-primary-900 dark:text-primary-400 dark:hover:text-primary-200">Edit</button>
                              {/* Prevent deleting the current user - Use currentUser.id */}
                              {currentUser?.id !== user.id && (
                                <button onClick={() => handleDeleteUser(user.id)} className="text-danger-600 hover:text-danger-900 dark:text-danger-400 dark:hover:text-danger-200">Delete</button>
                              )}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 dark:text-slate-400 text-center">No users found.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </motion.section>

{/* Final Clients Management */}
<motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="card"
        >
          <div className="p-6">
            <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-4 flex items-center">
              <Briefcase className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" />
              Clientes Finales
            </h2>

            <div className="space-y-6">
              {/* Add New Client Form */}
              <div className="border-b border-slate-200 dark:border-slate-700 pb-6">
                <h3 className="text-sm font-medium text-slate-900 dark:text-white mb-4">Agregar Nuevo Cliente</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="form-label">Nombre Cliente</label>
                    <input
                      type="text"
                      className="form-input"
                      value={newClient.name || ''}
                      onChange={(e) => setNewClient(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="e.g., Empresa XYZ C.A."
                    />
                  </div>
                  <div>
                    <label className="form-label">RIF</label>
                    <input
                      type="text"
                      className="form-input"
                      value={newClient.rif || ''}
                      onChange={(e) => setNewClient(prev => ({ ...prev, rif: e.target.value }))}
                      placeholder="e.g., J-12345678-9"
                    />
                  </div>
                  {/* Add fields for contact_info and additional_info if needed */}
                  <div className="md:col-span-2 flex items-end">
                    <button
                      className="btn btn-primary"
                      onClick={handleAddClient}
                      disabled={!newClient.name || !newClient.rif}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Agregar Cliente
                    </button>
                  </div>
                </div>
              </div>

              {/* Existing Clients Table & Search */}
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-sm font-medium text-slate-900 dark:text-white">Clientes Registrados</h3>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Buscar por nombre o RIF..."
                      value={clientSearchTerm}
                      onChange={(e) => setClientSearchTerm(e.target.value)}
                      className="form-input pl-8 text-sm"
                    />
                    <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
                    <thead className="bg-slate-50 dark:bg-slate-800">
                      <tr>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Nombre</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">RIF</th>
                        <th scope="col" className="relative px-6 py-3">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-700">
                      {isLoadingClients ? (
                        <tr><td colSpan={3} className="text-center py-4 text-slate-500">Cargando clientes...</td></tr>
                      ) : clients.length > 0 ? (
                        clients.map((client) => (
                          <tr key={client.id}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900 dark:text-white">{client.name}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 dark:text-slate-400">{client.rif}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                              <button onClick={() => toast(`Edit for ${client.name} not implemented`)} className="text-primary-600 hover:text-primary-900 dark:text-primary-400 dark:hover:text-primary-200">
                                <Edit className="h-4 w-4 inline" />
                              </button>
                              <button onClick={() => handleDeleteClient(client.id)} className="text-danger-600 hover:text-danger-900 dark:text-danger-400 dark:hover:text-danger-200">
                                <Trash2 className="h-4 w-4 inline" />
                              </button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr><td colSpan={3} className="text-center py-4 text-slate-500">No se encontraron clientes.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {/* Pagination Controls */}
                {clientTotalPages > 1 && (
                  <div className="mt-4 flex justify-between items-center text-sm">
                    <button
                      onClick={() => fetchClients(clientCurrentPage - 1)}
                      disabled={clientCurrentPage <= 1 || isLoadingClients}
                      className="btn btn-secondary btn-sm disabled:opacity-50"
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" /> Anterior
                    </button>
                    <span className="text-slate-600 dark:text-slate-400">Página {clientCurrentPage} de {clientTotalPages}</span>
                    <button
                      onClick={() => fetchClients(clientCurrentPage + 1)}
                      disabled={clientCurrentPage >= clientTotalPages || isLoadingClients}
                      className="btn btn-secondary btn-sm disabled:opacity-50"
                    >
                      Siguiente <ChevronRight className="h-4 w-4 ml-1" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.section>

        {/* Backup Settings */}
        {/* ... (Backup settings section remains commented out) ... */}
      </div>
    </div>
  );
}
