import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {  Moon, Sun, User, Shield, Key, Globe, Database, Server, Plus, Trash2 } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
// import { supabase } from '../lib/supabase'; // No longer needed
import { toast } from 'react-hot-toast'; // Import toast for feedback
import type { VMPlan } from '../types/vm';

export default function Settings() {
  const API_BASE_URL = 'http://localhost:3001/api'; // Define API base URL
  const { theme, toggleTheme } = useTheme();
  // const [emailNotifications, setEmailNotifications] = useState(true);
  // const [slackNotifications, setSlackNotifications] = useState(false);
  // const [autoBackups, setAutoBackups] = useState(true);
  // const [apiKey, setApiKey] = useState('');
  // const [isGeneratingKey, setIsGeneratingKey] = useState(false);
  const [plans, setPlans] = useState<VMPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
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
  
  useEffect(() => {
    fetchPlans();
  }, []);

  const fetchPlans = async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`${API_BASE_URL}/vm-plans`, {
        headers: {
          'Authorization': 'Bearer MOCK_TOKEN', // Replace with actual token logic
        },
      });
      if (!response.ok) {
        throw new Error('Failed to fetch plans');
      }
      const data = await response.json();
      console.log(data)
      setPlans(data || []);
    } catch (error) {
      console.error('Error fetching plans:', error);
      toast.error('Could not load VM plans.');
    } finally {
      // Make sure isLoading is set to false even if there's an error
      setIsLoading(false);
    }
  };

  const handleAddPlan = async () => {
    try {
      
      const response = await fetch(`${API_BASE_URL}/vm-plans`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer MOCK_TOKEN', // Replace with actual token logic
        },
        body: JSON.stringify({
          name: newPlan.name,
          description: newPlan.description,
          specs: newPlan.specs,
          is_active: true
        }),
      });

      if (!response.ok) throw new Error('Failed to add plan');
      const addedPlan = await response.json();
      setPlans([...plans, addedPlan]);
      setNewPlan({
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
    try {
      const response = await fetch(`${API_BASE_URL}/vm-plans/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': 'Bearer MOCK_TOKEN', // Replace with actual token logic
        },
      });

      if (!response.ok) throw new Error('Failed to delete plan');

      // Check for 204 No Content status
      if (response.status === 204) {
      setPlans(plans.filter(plan => plan.id !== id));
        toast.success('VM Plan deleted.');
      } else {
        // Handle unexpected successful responses if needed
        const data = await response.json(); // Or handle as text if no body expected
        console.warn('Unexpected response status after delete:', response.status, data);
        toast.error('Plan deleted, but received unexpected server response.');
      }
    } catch (error) {
      console.error('Error deleting plan:', error);
      toast.error('Failed to delete VM plan.');
    }
  };

  const handleTogglePlan = async (id: string, is_active: boolean) => {
    try {
      const response = await fetch(`${API_BASE_URL}/vm-plans/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer MOCK_TOKEN', // Replace with actual token logic
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
              VM Plans
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
                      value={newPlan.name}
                      onChange={(e) => setNewPlan(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="e.g., Basic Server"
                    />
                  </div>
                  <div>
                    <label className="form-label">Descripción</label>
                    <input
                      type="text"
                      className="form-input"
                      value={newPlan.description}
                      onChange={(e) => setNewPlan(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="e.g., Perfect for small applications"
                    />
                  </div>
                  <div>
                    <label className="form-label">CPU Cores</label>
                    <input
                      type="number"
                      className="form-input"
                      value={newPlan.specs?.cpu}
                      onChange={(e) => setNewPlan(prev => ({
                        ...prev,
                        specs: { ...prev.specs!, cpu: parseInt(e.target.value) }
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
                      value={newPlan.specs?.memory}
                      onChange={(e) => setNewPlan(prev => ({
                        ...prev,
                        specs: { ...prev.specs!, memory: parseInt(e.target.value) }
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
                      value={newPlan.specs?.disk}
                      onChange={(e) => setNewPlan(prev => ({
                        ...prev,
                        specs: { ...prev.specs!, disk: parseInt(e.target.value) }
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
                          <div className="flex items-center">
                            <input
                              type="checkbox"
                              id={`active-${plan.id}`}
                              className="form-checkbox"
                              checked={plan.is_active}
                              onChange={(e) => handleTogglePlan(plan.id, e.target.checked)}
                            />
                            <label htmlFor={`active-${plan.id}`} className="ml-2 text-sm text-slate-700 dark:text-slate-300">
                              Activo
                            </label>
                          </div>
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

        {/* Account Settings */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="card"
        >
          <div className="p-6">
            <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-4 flex items-center">
              <User className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" />
              Ajustes de la Cuenta
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="form-label">Correo</label>
                <input
                  type="email"
                  className="form-input"
                  value="admin@example.com"
                  disabled
                />
              </div>
              
              <div>
                <label className="form-label">Nombre Completo</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Your full name"
                  defaultValue="Admin User"
                />
              </div>
              
              <div>
                <button className="btn btn-primary">
                  Actualizar Perfil
                </button>
              </div>
            </div>
          </div>
        </motion.section>
        
        {/* Security Settings */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="card"
        >
          <div className="p-6">
            <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-4 flex items-center">
              <Shield className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" />
              Seguridad
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="form-label">Actual Password</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Enter current password"
                />
              </div>
              
              <div>
                <label className="form-label">Nueva Password</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Enter new password"
                />
              </div>
              
              <div>
                <label className="form-label">Confirma nueva Password</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Confirm new password"
                />
              </div>
              
              <div>
                <button className="btn btn-primary">
                  Cambiar Password
                </button>
              </div>
            </div>
          </div>
        </motion.section>
        
        {/* API Settings */}
        {/* <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="card"
        >
          <div className="p-6">
            <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-4 flex items-center">
              <Key className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" />
              API Access
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="form-label">API Key</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="form-input font-mono"
                    value={apiKey}
                    placeholder="No API key generated"
                    readOnly
                  />
                  <button
                    className="btn btn-primary whitespace-nowrap"
                    onClick={handleGenerateApiKey}
                    disabled={isGeneratingKey}
                  >
                    {isGeneratingKey ? 'Generating...' : 'Generate Key'}
                  </button>
                </div>
              </div>
              
              <div className="text-sm text-slate-500 dark:text-slate-400">
                Use this key to authenticate API requests. Keep it secure and never share it.
              </div>
            </div>
          </div>
        </motion.section> */}
        
        {/* Preferences */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="card"
        >
          <div className="p-6">
            <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-4 flex items-center">
              <Globe className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" />
              Preferencias
            </h2>
            
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  {theme === 'dark' ? (
                    <Moon className="h-5 w-5 text-slate-400" />
                  ) : (
                    <Sun className="h-5 w-5 text-slate-400" />
                  )}
                  <span className="text-slate-700 dark:text-slate-300">Tema</span>
                </div>
                <button
                  onClick={toggleTheme}
                  className="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-600 focus:ring-offset-2 bg-slate-200 dark:bg-slate-700"
                >
                  <span className="sr-only">Toggle theme</span>
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      theme === 'dark' ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              
              {/* <div className="space-y-4">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="email-notifications"
                    className="form-checkbox"
                    checked={emailNotifications}
                    onChange={(e) => setEmailNotifications(e.target.checked)}
                  />
                  <label htmlFor="email-notifications" className="ml-2 text-slate-700 dark:text-slate-300">
                    Email Notifications
                  </label>
                </div>
                
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="slack-notifications"
                    className="form-checkbox"
                    checked={slackNotifications}
                    onChange={(e) => setSlackNotifications(e.target.checked)}
                  />
                  <label htmlFor="slack-notifications" className="ml-2 text-slate-700 dark:text-slate-300">
                    Slack Notifications
                  </label>
                </div>
              </div> */}

            </div>
          </div>
        </motion.section>
        
        {/* Backup Settings */}
        {/* <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="card"
        >
          <div className="p-6">
            <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-4 flex items-center">
              <Database className="h-5 w-5 mr-2 text-primary-600 dark:text-primary-400" />
              Backup Settings
            </h2>
            
            <div className="space-y-4">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="auto-backups"
                  className="form-checkbox"
                  checked={autoBackups}
                  onChange={(e) => setAutoBackups(e.target.checked)}
                />
                <label htmlFor="auto-backups" className="ml-2 text-slate-700 dark:text-slate-300">
                  Enable Automatic Backups
                </label>
              </div>
              
              <div>
                <label className="form-label">Backup Schedule</label>
                <select className="form-select" disabled={!autoBackups}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              
              <div>
                <label className="form-label">Retention Period</label>
                <select className="form-select" disabled={!autoBackups}>
                  <option value="7">7 days</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="365">1 year</option>
                </select>
              </div>
            </div>
          </div>
        </motion.section> */}
      </div>
    </div>
  );
}