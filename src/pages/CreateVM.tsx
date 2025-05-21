import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom'; // Import Link
import { ArrowLeft, Server, Cpu, MemoryStick as Memory, CloudOff, Plus, RefreshCw } from 'lucide-react'; // Import CloudOff, Plus, RefreshCw
import { motion } from 'framer-motion';
import { VMCreateParams, VMTemplate, VMPlan, VMSpecs } from '../types/vm'; // Import VMPlan, VMSpecs
import { Hypervisor, StorageResource } from '../types/hypervisor'; // Import StorageResource
import { FinalClient } from '../types/client';
import { useAuth } from '../hooks/useAuth'; // Import useAuth
// import { supabase } from '../lib/supabase'; // Remove direct Supabase usage
import { formatBytes } from '../utils/formatters'; // Import formatBytes
import { toast } from 'react-hot-toast';

import type { NodeResource } from '../types/hypervisor'; // Import NodeResource
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL; // Read from .env

interface DisplayableVMPlan extends VMPlan {
  isCompatible: boolean;
  incompatibilityReason?: string;
}


export default function CreateVM() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false); // General loading state for create action
  const [isFetchingHypervisors, setIsFetchingHypervisors] = useState(true);
  const [isFetchingTemplates, setIsFetchingTemplates] = useState(false);
  const [isFetchingPlans, setIsFetchingPlans] = useState(false); // State for fetching plans
  const [isFetchingDatastores, setIsFetchingDatastores] = useState(false); // State for fetching datastores
  const [isFetchingClients, setIsFetchingClients] = useState(false); // State for fetching clients
  const [availableHypervisors, setAvailableHypervisors] = useState<Hypervisor[]>([]);
  const [templates, setTemplates] = useState<VMTemplate[]>([]); // Use VMTemplate type
  const [availableClients, setAvailableClients] = useState<FinalClient[]>([]); // State for final clients
  const [availableStorages, setAvailableStorages] = useState<StorageResource[]>([]); // Renamed from availableDatastores for clarity
  const [availablePlans, setAvailablePlans] = useState<VMPlan[]>([]); 
  const [displayablePlans, setDisplayablePlans] = useState<DisplayableVMPlan[]>([]); // Now uses DisplayableVMPlan
  const [selectedNodeDetails, setSelectedNodeDetails] = useState<NodeResource | null>(null);
  const [configMode, setConfigMode] = useState<'plan' | 'custom'>('plan'); // 'plan' or 'custom'

  const [vmParams, setVmParams] = useState<VMCreateParams>({
    name: '',
    description: '',
    hypervisorId: '',
    specs: {
      cpu: 1,
      memory: 1024,
      disk: 20,
      // os: '', // We'll use templateId and copy os from template
    },
    start: true,
    tags: [], // Initialize tags as empty array
    templateId: undefined, // Initialize templateId
    ticket: '', // Initialize ticket
    finalClientId: undefined, // Initialize finalClientId
    // vSphere specific fields (optional, can be added to UI later if needed)
    datastoreName: undefined, // For vSphere ISO creation
    // resourcePoolName: undefined,
  });

  const [tagInput, setTagInput] = useState('');
  const { user, token: authToken } = useAuth(); // Get user and token from context

  // Fetch hypervisors on mount
  useEffect(() => {
    const fetchHypervisors = async () => {
      setIsFetchingHypervisors(true);
      try {
        const response = await fetch(`${API_BASE_URL}/hypervisors`, {
          headers: { ...(authToken && { 'Authorization': `Bearer ${authToken}` }) },
        });
        if (!response.ok) throw new Error('Failed to fetch hypervisors');
        const data: Hypervisor[] = await response.json();
        setAvailableHypervisors(data.filter(h => h.status === 'connected')); // Only show connected ones
      } catch (error) {
        console.error('Error fetching hypervisors:', error);
        toast.error('Could not load hypervisors.');
      } finally {
        setIsFetchingHypervisors(false);
      }
    };
    if (authToken) fetchHypervisors();
  }, [authToken]);

  // Fetch active VM plans on mount
  useEffect(() => {
    const fetchPlans = async () => {
      setIsFetchingPlans(true);
      try {
        const response = await fetch(`${API_BASE_URL}/vm-plans`, {
          headers: { ...(authToken && { 'Authorization': `Bearer ${authToken}` }) },
        });
        if (!response.ok) throw new Error('Failed to fetch VM plans');
        const data: VMPlan[] = await response.json();
        setAvailablePlans(data.filter(plan => plan.is_active)); // Filter for active plans
      } catch (error) {
        console.error('Error fetching VM plans:', error);
        toast.error('Could not load VM plans.');
      } finally {
        setIsFetchingPlans(false);
      }
    };
    if (authToken) fetchPlans();
  }, [authToken]);

  // Fetch final clients on mount
  useEffect(() => {
    const fetchClients = async () => {
      setIsFetchingClients(true);
      try {
        const response = await fetch(`${API_BASE_URL}/final-clients?limit=1000`, {
          headers: { ...(authToken && { 'Authorization': `Bearer ${authToken}` }) },
        });
        if (!response.ok) throw new Error('Failed to fetch final clients');
        const data = await response.json();
        setAvailableClients(data.items || []);
      } catch (error) {
        console.error('Error fetching final clients:', error);
        toast.error('Could not load final clients.');
      } finally {
        setIsFetchingClients(false);
      }
    };
    if (authToken) fetchClients();
  }, [authToken]);
  
  const selectedHypervisor = availableHypervisors.find(h => h.id === vmParams.hypervisorId);
  // Fetch templates when hypervisor changes
  useEffect(() => {
    setTemplates([]); // Clear previous templates
    setVmParams(prev => ({ ...prev, templateId: undefined, specs: { ...prev.specs, os: undefined } })); // Clear selected template and os
    setAvailableStorages([]); // Clear storages when hypervisor changes
    setVmParams(prev => ({ ...prev, datastoreName: undefined })); // Clear selected datastore
    setSelectedNodeDetails(null); // Clear selected node details

    if (vmParams.hypervisorId && authToken) {
      // const selectedHypervisor = availableHypervisors.find(h => h.id === vmParams.hypervisorId); // Moved up
      const fetchTemplates = async () => {
        setIsFetchingTemplates(true); // This state is for templates
        try {
          const response = await fetch(`${API_BASE_URL}/hypervisors/${vmParams.hypervisorId}/templates`, {
            headers: { ...(authToken && { 'Authorization': `Bearer ${authToken}` }) },
          });
          if (!response.ok) throw new Error('Failed to fetch templates');
          const data: VMTemplate[] = await response.json();
          setTemplates(data);
        } catch (error) {
          console.error('Error fetching templates:', error);
          toast.error('No se han podido cargar plantillas para el hipervisor seleccionado.');
        } finally {
          setIsFetchingTemplates(false);
        }
      };
      fetchTemplates();

      if (selectedHypervisor?.type === 'proxmox') {
        // Fetch nodes for Proxmox
        const fetchNodes = async () => {
          try {
            const response = await fetch(`${API_BASE_URL}/hypervisors/${vmParams.hypervisorId}/nodes`, {
              headers: { ...(authToken && { 'Authorization': `Bearer ${authToken}` }) },
            });
            if (!response.ok) throw new Error('Failed to fetch Proxmox nodes');
            const nodes: NodeResource[] = await response.json();
            if (nodes.length > 0) {
              // For simplicity, select the first node.
              // TODO: Implement node selection if multiple nodes exist.
              setSelectedNodeDetails(nodes[0]);
            } else {
              setSelectedNodeDetails(null);
            }
          } catch (error) {
            console.error('Error fetching Proxmox nodes:', error);
            toast.error('Could not load Proxmox node details.');
            setSelectedNodeDetails(null);
          }
        };
        fetchNodes();

        // Fetch storages for Proxmox (that can hold 'images')
        const fetchStorages = async () => {
          setIsFetchingDatastores(true);
          try {
            const response = await fetch(`${API_BASE_URL}/hypervisors/${vmParams.hypervisorId}/storage`, {
              headers: { ...(authToken && { 'Authorization': `Bearer ${authToken}` }) },
            });
            if (!response.ok) throw new Error('Failed to fetch Proxmox storages');
            const storages: StorageResource[] = await response.json();
            // Filter storages that can contain 'images' (Proxmox specific content type for VM disks)
            // Backend should ideally provide this info or a way to filter.
            // For now, assuming the /storage endpoint for Proxmox might return a content string.
            setAvailableStorages(storages.filter(s => s.type !== 'iso' && s.type !== 'backup')); // Basic filter
          } catch (error) {
            console.error('Error fetching Proxmox storages:', error);
            toast.error('Could not load Proxmox storages.');
            setAvailableStorages([]);
          } finally {
            setIsFetchingDatastores(false);
          }
        };
        fetchStorages();
      } else if (selectedHypervisor?.type === 'vsphere') {
        // No specific node selection needed for vSphere in the same way for resource limits here
        // Fetch datastores for vSphere to be used for plan filtering and ISO placement
        const fetchVSphereDatastores = async () => {
          setIsFetchingDatastores(true); // Use the existing loading state
          try {
            const response = await fetch(`${API_BASE_URL}/hypervisors/${vmParams.hypervisorId}/storage`, {
              headers: { ...(authToken && { 'Authorization': `Bearer ${authToken}` }) },
            });
            if (!response.ok) throw new Error('Failed to fetch vSphere datastores');
            const datastores: StorageResource[] = await response.json();
            setAvailableStorages(datastores); // Populate availableStorages with vSphere datastores
          } catch (error) {
            console.error('Error fetching vSphere datastores:', error);
            toast.error('Could not load vSphere datastores.');
            setAvailableStorages([]);
          } finally {
            setIsFetchingDatastores(false);
          }
        };
        fetchVSphereDatastores();
      }
    } else { // If hypervisorId is cleared or authToken is missing
      setAvailableStorages([]); // Clear storages
    }
  }, [vmParams.hypervisorId, authToken, availableHypervisors]); // Add availableHypervisors

  const handleNext = () => {
    if (currentStep < 3) {
      setCurrentStep(currentStep + 1);
    } else {
      handleCreate();
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const addTag = () => {
    if (tagInput && !vmParams.tags?.includes(tagInput)) {
      setVmParams(prev => ({
        ...prev,
        tags: [...(prev.tags || []), tagInput],
      }));
      setTagInput('');
    }
  };

  const removeTag = (tag: string) => {
    setVmParams(prev => ({
      ...prev,
      tags: prev.tags?.filter(t => t !== tag),
    }));
  };

  // Handle Plan Selection
  const handlePlanSelect = (planId: string) => {
    const selectedAugmentedPlan = displayablePlans.find(p => p.id === planId);
    if (selectedAugmentedPlan && selectedAugmentedPlan.isCompatible) {
      setVmParams(prev => ({
        ...prev,
        planId: selectedAugmentedPlan.id,
        specs: {
          ...prev.specs,
          cpu: selectedAugmentedPlan.specs.cpu,
          memory: selectedAugmentedPlan.specs.memory,
          disk: selectedAugmentedPlan.specs.disk,
          // os: prev.specs.os, // Keep OS from template if already selected
        }
      }));
    } else if (selectedAugmentedPlan && !selectedAugmentedPlan.isCompatible) {
      toast.error(`El plan '${selectedAugmentedPlan.name}' no es compatible: ${selectedAugmentedPlan.incompatibilityReason}`);
      // Do not change the selection if user clicks a disabled (incompatible) option.
      // The select's value won't update if the option is disabled.
      // If it somehow does, ensure planId is cleared or remains unchanged.
      // setVmParams(prev => ({ ...prev, planId: undefined })); // Or keep current vmParams.planId
      // For safety, ensure the UI reflects the actual state if planId was somehow set to an incompatible one.
    } else {
      setVmParams(prev => ({ ...prev, planId: undefined }));
    }
  };

  // Filter displayable plans based on selected node/storage resources
  useEffect(() => {
    const augmentedPlans = availablePlans.map(plan => {
      let isCompatible = true;
      const reasons: string[] = [];

      // Check CPU and Memory against selected Proxmox node
      if (selectedHypervisor?.type === 'proxmox' && selectedNodeDetails) {
        if (plan.specs.cpu > (selectedNodeDetails.cpu?.cores || 0)) {
          isCompatible = false;
          reasons.push("CPU excede límite del nodo");
        }
        if (plan.specs.memory > (selectedNodeDetails.memory?.total ? selectedNodeDetails.memory.total / (1024*1024) : 0)) {
          isCompatible = false;
          reasons.push("Memoria excede límite del nodo");
        }
      }
      // For vSphere, CPU/Memory limits are often cluster-wide or based on the template's host.
      // If you have per-host limits for vSphere from `selectedNodeDetails`, you can add similar checks here.
      // For now, vSphere plan compatibility for CPU/Memory is assumed true unless specific node details are used.

      // Check Disk against selected storage/datastore
      const selectedStorage = availableStorages.find(s => s.name === vmParams.datastoreName);
      if (selectedStorage) { // This check applies if a storage/datastore is selected
        if (plan.specs.disk > (selectedStorage.available / (1024 * 1024 * 1024))) {
          isCompatible = false;
          reasons.push("Disco excede capacidad del storage/datastore");
        }
      } else if (selectedHypervisor?.type === 'proxmox' || selectedHypervisor?.type === 'vsphere') {
        // If storage/datastore is required but not yet selected, mark plans needing disk as potentially incompatible
        // Or, assume compatible for now and let the form validation catch it.
        // For a better UX, if datastoreName is required and not set, all plans could be marked as "requiere selección de storage".
        // For simplicity here, we'll let the main form validation handle missing datastoreName.
        // If you want to be stricter:
        // if (plan.specs.disk > 0) {
        //   isCompatible = false;
        //   reasons.push("Seleccione un storage/datastore");
        // }
      }

      return {
        ...plan,
        isCompatible,
        incompatibilityReason: reasons.join(', ') || undefined
      };
    });

    setDisplayablePlans(augmentedPlans);

    // Deselect plan if current plan is no longer compatible or available
    if (vmParams.planId) {
      const currentSelectedPlanInList = augmentedPlans.find(p => p.id === vmParams.planId);
      if (!currentSelectedPlanInList || !currentSelectedPlanInList.isCompatible) {
        setVmParams(prev => ({ ...prev, planId: undefined }));
      }
    }

  }, [availablePlans, selectedNodeDetails, vmParams.datastoreName, availableStorages, vmParams.hypervisorId, availableHypervisors, selectedHypervisor, vmParams.planId]);

  const handleCreate = async () => {
    setIsLoading(true);
    // const selectedHypervisor = availableHypervisors.find(h => h.id === vmParams.hypervisorId);

    const payload: VMCreateParams = {
      ...vmParams,
    };
    // --- INICIO DEBUG ---
    console.log('Payload being sent from CreateVM.tsx:', JSON.stringify(payload, null, 2));
    // --- FIN DEBUG ---
    try {
      const response = await fetch(`${API_BASE_URL}/vms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken && { 'Authorization': `Bearer ${authToken}` }),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
        throw new Error(errorData.error || `Failed to initiate VM creation (status: ${response.status})`);
      }

      const result = await response.json();
      toast.success(result.message || 'La creación de la máquina virtual se ha iniciado correctamente.');
      navigate('/');
    } catch (error: unknown) {
      console.error('Error creating VM:', error);
      let errorMessage = 'Failed to create VM.';
      if (error instanceof Error) {
        errorMessage = `Failed to create VM: ${error.message}`;
      }
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const isNextDisabled = () => {
    if (currentStep === 1) {
      return !vmParams.name || !vmParams.hypervisorId;
    }
    if (currentStep === 2) {
      // const isVSphereIso = availableHypervisors.find(h => h.id === vmParams.hypervisorId)?.type === 'vsphere' &&
      //                      templates.find(t => t.id === vmParams.templateId)?.name?.toLowerCase().includes('.iso');
      const isProxmox = availableHypervisors.find(h => h.id === vmParams.hypervisorId)?.type === 'proxmox';
      const isVSphere = availableHypervisors.find(h => h.id === vmParams.hypervisorId)?.type === 'vsphere';
      
      // For both Proxmox and vSphere, datastoreName (storage/datastore) is now required in Step 2
      const datastoreMissing = (isProxmox || isVSphere) && !vmParams.datastoreName;

      return !vmParams.templateId ||
             datastoreMissing ||
             (configMode === 'plan' && !vmParams.planId);
    }
    // No specific validation for step 3 that would disable "Next" (which is "Create VM")
    // as resource inputs have defaults or are derived.
    return false;
  };

  // const selectedHypervisor = availableHypervisors.find(h => h.id === vmParams.hypervisorId); // Moved up
  const maxCpu = selectedNodeDetails?.cpu?.cores ?? 16; // Default max if no node selected
  const maxMemoryMb = selectedNodeDetails?.memory?.total ? Math.floor(selectedNodeDetails.memory.total / (1024 * 1024)) : 32768; // Convert bytes to MB
  const selectedStorageResource = availableStorages.find(s => s.name === vmParams.datastoreName);
  const maxDiskGb = selectedStorageResource?.available ? Math.floor(selectedStorageResource.available / (1024 * 1024 * 1024)) : 500; // Convert bytes to GB

  // Content to display based on hypervisor availability
  let pageContent;

  if (isFetchingHypervisors) {
    pageContent = (
      <div className="text-center py-10 card p-6">
        <RefreshCw className="h-12 w-12 text-slate-400 animate-spin mx-auto" />
        <p className="mt-2 text-slate-500 dark:text-slate-400">Cargando hypervisores disponibles...</p>
      </div>
    );
  } else if (availableHypervisors.length === 0) {
    pageContent = (
      <div className="text-center py-10 card p-6">
        <CloudOff className="mx-auto h-12 w-12 text-slate-400" />
        <h3 className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">No hay hypervisores conectados</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Para crear una máquina virtual, primero debe {user?.role === 'admin' ? 'registrar y conectar' : 'contactar a un administrador para configurar'} un hypervisor.
        </p>
        {(user?.role === 'admin') && (
          <div className="mt-6">
            <Link to="/hypervisors" className="btn btn-primary">
              <Plus className="h-4 w-4 mr-2" />
              Configurar Hypervisor
            </Link>
          </div>
        )}
      </div>
    );
  } else {
    pageContent = (
      <>
        {/* Stepper */}
        <div className="mb-8">
          <div className="flex items-center">
            <div className="flex items-center relative">
              <div className={`rounded-full h-8 w-8 flex items-center justify-center ${
                currentStep >= 1 ? 'bg-primary-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
              }`}>
                1
              </div>
              <div className="ml-2 text-sm font-medium text-slate-900 dark:text-white">
                Información Básica
              </div>
            </div>
            <div className={`flex-1 h-0.5 mx-4 ${
              currentStep >= 2 ? 'bg-primary-600' : 'bg-slate-200 dark:bg-slate-700'
            }`}></div>
            <div className="flex items-center relative">
              <div className={`rounded-full h-8 w-8 flex items-center justify-center ${
                currentStep >= 2 ? 'bg-primary-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
              }`}>
                2
              </div>
              <div className="ml-2 text-sm font-medium text-slate-900 dark:text-white">
                Configuración
              </div>
            </div>
            <div className={`flex-1 h-0.5 mx-4 ${
              currentStep >= 3 ? 'bg-primary-600' : 'bg-slate-200 dark:bg-slate-700'
            }`}></div>
            <div className="flex items-center relative">
              <div className={`rounded-full h-8 w-8 flex items-center justify-center ${
                currentStep >= 3 ? 'bg-primary-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
              }`}>
                3
              </div>
              <div className="ml-2 text-sm font-medium text-slate-900 dark:text-white">
                Recursos
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 shadow rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
          {/* Step 1: Basic Info */}
          {currentStep === 1 && (
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="p-6"
            >
              <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-6">Información Básica </h2>

              <div className="space-y-4">
                <div>
                  <label htmlFor="name" className="form-label">Nombre VM</label>
                  <input
                    type="text"
                    id="name"
                    className="form-input"
                    placeholder="ej., web-server-1"
                    value={vmParams.name}
                    onChange={(e) => setVmParams(prev => ({ ...prev, name: e.target.value }))}
                  />
                </div>

                <div>
                  <label htmlFor="description" className="form-label">Descripción</label>
                  <textarea
                    id="description"
                    rows={3}
                    className="form-input"
                    placeholder="Para que es esta VM?"
                    value={vmParams.description}
                    onChange={(e) => setVmParams(prev => ({ ...prev, description: e.target.value }))}
                  ></textarea>
                </div>

                <div>
                  <label htmlFor="hypervisor" className="form-label">Hypervisor</label>
                  <select
                    id="hypervisor"
                    className="form-select"
                    value={vmParams.hypervisorId}
                    onChange={(e) => setVmParams(prev => ({ ...prev, hypervisorId: e.target.value }))}
                    disabled={isFetchingHypervisors}
                  >
                    <option value="">{isFetchingHypervisors ? 'Loading...' : 'Selecciona un hypervisor conectado'}</option>
                    {availableHypervisors.map(h => (
                      <option key={h.id} value={h.id}>
                        {h.name} ({h.type})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Ticket Input */}
                <div>
                  <label htmlFor="ticket" className="form-label">Ticket (Opcional)</label>
                  <input
                    type="text"
                    id="ticket"
                    className="form-input"
                    placeholder="ej., INC-12345"
                    value={vmParams.ticket || ''}
                    onChange={(e) => setVmParams(prev => ({ ...prev, ticket: e.target.value }))}
                  />
                </div>

                {/* Final Client Select */}
                <div>
                  <label htmlFor="finalClient" className="form-label">Cliente Final (Opcional)</label>
                  <select id="finalClient" className="form-select" value={vmParams.finalClientId || ''} onChange={(e) => setVmParams(prev => ({ ...prev, finalClientId: e.target.value || undefined }))} disabled={isFetchingClients}>
                    <option value="">{isFetchingClients ? 'Cargando clientes...' : (availableClients.length === 0 ? 'No hay clientes. Registre uno en Configuración.' : 'Selecciona un cliente')}</option>
                    {availableClients.map(client => (
                      <option key={client.id} value={client.id}>{client.name} ({client.rif})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="tags" className="form-label">Tags</label>
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      id="tags"
                      className="form-input flex-1"
                      placeholder="Agrega un tag..."
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addTag();
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={addTag}
                      className="btn btn-secondary"
                    >
                      Agrega
                    </button>
                  </div>
                  {vmParams.tags && vmParams.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {vmParams.tags.map(tag => (
                        <span
                          key={tag}
                          className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-800 dark:text-primary-300"
                        >
                          {tag}
                          <button
                            type="button"
                            onClick={() => removeTag(tag)}
                            className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full hover:bg-primary-200 dark:hover:bg-primary-800 focus:outline-none"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* Step 2: OS & Storage */}
          {currentStep === 2 && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="p-6"
            >
              <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-6">Configuración</h2>

              <div className="space-y-6">
                {/* Storage/Datastore Selection - Unified and moved to the top of Step 2 */}
                {(selectedHypervisor?.type === 'proxmox' || selectedHypervisor?.type === 'vsphere') &&
                 (
                  <div>
                    <label htmlFor="datastoreName" className="form-label">
                      {selectedHypervisor?.type === 'proxmox' 
                        ? 'Storage de Destino (Proxmox)' 
                        : 'Datastore de Destino (vSphere)'}
                    </label>
                    <select id="datastoreName" className="form-select" value={vmParams.datastoreName || ''} onChange={(e) => setVmParams(prev => ({ ...prev, datastoreName: e.target.value }))} disabled={isFetchingDatastores || availableStorages.length === 0} >
                      <option value="">{isFetchingDatastores ? 'Cargando...' : (availableStorages.length === 0 ? 'No hay storages/datastores disponibles' : 'Selecciona uno')}</option>
                      {availableStorages.map(ds => ( <option key={ds.id} value={ds.name}>{ds.name} (Libre: {formatBytes(ds.available)})</option> ))}
                    </select>
                    {availableStorages.length === 0 && !isFetchingDatastores && <p className="text-xs text-warning-600 mt-1">No se encontraron datastores o el hypervisor no está conectado.</p>}
                  </div>
                )}

                {/* Configuration Mode Toggle */}
                <div className="flex items-center space-x-4">
                  <label className="form-label mb-0">Tipo de Configuración:</label>
                  <div className="flex items-center">
                    <input
                      type="radio"
                      id="config-plan"
                      name="configMode"
                      value="plan"
                      checked={configMode === 'plan'}
                      onChange={() => {
                        setConfigMode('plan');
                        // Auto-select first compatible plan if available
                        const firstCompatiblePlan = displayablePlans.find(p => p.isCompatible);
                        if (firstCompatiblePlan) {
                          handlePlanSelect(firstCompatiblePlan.id);
                        } else {
                           setVmParams(prev => ({ ...prev, planId: undefined }));
                        }
                      }}
                      className="form-radio"
                    />
                    <label htmlFor="config-plan" className="ml-2 text-sm">Use un Plan</label>
                  </div>
                  <div className="flex items-center">
                    <input
                      type="radio"
                      id="config-custom"
                      name="configMode"
                      value="custom"
                      checked={configMode === 'custom'}
                      onChange={() => {
                        setConfigMode('custom');
                        setVmParams(prev => ({ ...prev, planId: undefined }));
                      }}
                      className="form-radio"
                    />
                    <label htmlFor="config-custom" className="ml-2 text-sm">Especificaciones a medida</label>
                  </div>
                </div>

                {/* VM Plan Selection (only if configMode is 'plan') */}
                {configMode === 'plan' && (
                  <div>
                    <label htmlFor="vm-plan" className="form-label">Seleccione un Plan VM</label>
                    <select 
                      id="vm-plan" 
                      className="form-select" 
                      value={vmParams.planId || ''} 
                      onChange={(e) => handlePlanSelect(e.target.value)} 
                      disabled={isFetchingPlans || availablePlans.length === 0} // Disable select if no plans at all or fetching
                    >
                      <option value="" disabled>
                        {isFetchingPlans ? 'Cargando planes...' :
                         availablePlans.length === 0 ? 'No hay planes activos' :
                         displayablePlans.every(p => !p.isCompatible) && availablePlans.length > 0 ? 'No hay planes compatibles con los recursos/storage seleccionado' :
                         'Seleccione un plan'}
                      </option>
                      {displayablePlans.map(plan => (
                        <option key={plan.id} value={plan.id} disabled={!plan.isCompatible} className={!plan.isCompatible ? 'text-slate-400 dark:text-slate-500 italic' : ''}>
                          {plan.name} ({plan.specs.cpu} CPU, {plan.specs.memory >= 1024 ? `${plan.specs.memory / 1024}GB` : `${plan.specs.memory}MB`} RAM, {plan.specs.disk}GB Disk)
                          {!plan.isCompatible && plan.incompatibilityReason && ` (Incompatible: ${plan.incompatibilityReason})`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Template Selection (always shown) */}
                <div>
                  <label className="form-label">Plantillas Disponibles</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {isFetchingTemplates ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="animate-pulse">
                          <div className="h-32 bg-slate-200 dark:bg-slate-700 rounded-lg"></div>
                        </div>
                      ))
                    ) : templates.length > 0 ? (
                      templates.map(template => (
                        <button
                          key={template.id}
                          type="button"
                          className={`p-4 border rounded-lg text-center hover:border-primary-500 dark:hover:border-primary-400 ${
                            vmParams.templateId === template.id
                              ? 'border-primary-500 dark:border-primary-400 bg-primary-50 dark:bg-primary-900/20 ring-2 ring-primary-300'
                              : 'border-slate-200 dark:border-slate-700'
                          }`}
                          onClick={() => {
                            console.log('Selected Template Object:', template); // Debug the template object
                            setVmParams(prev => ({
                              ...prev,
                              templateId: template.id,
                              specs: { ...prev.specs, os: template.os } // Copy guestId from template
                            }));
                          }}
                        >
                          <Server className="h-8 w-8 mx-auto mb-2 text-slate-500 dark:text-slate-400" />
                          <div className="text-sm font-medium">{template.name}</div>
                          {template.osVersion && (
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                              {template.osVersion}
                            </div>
                          )}
                          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            {template.size.toFixed(1)} GB
                          </div>
                        </button>
                      ))
                    ) : (
                      <p className="col-span-full text-slate-500 dark:text-slate-400 text-sm">No se selecciono plantillas o hypervisor no seleccionado.</p>
                    )}
                  </div>
                </div>

                {/* Disk Size Slider (only if configMode is 'custom') */}
                {configMode === 'custom' && (
                  <div>
                  <label htmlFor="disk" className="form-label">Tamaño del Disco (GB)</label>
                  <div className="flex items-center">
                    <input
                      type="range"
                      id="disk"
                      min={selectedHypervisor?.type === 'proxmox' ? 1 : 10} // Proxmox allows smaller disks
                      max={maxDiskGb}
                      step="10"
                      className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer"
                      value={vmParams.specs.disk}
                      onChange={(e) => setVmParams(prev => ({
                        ...prev,
                        specs: {
                          ...prev.specs,
                          disk: parseInt(e.target.value)
                        }
                      }))}
                    />
                    <span className="ml-3 w-12 text-center text-slate-700 dark:text-slate-300">
                      {vmParams.specs.disk}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 px-1 mt-1">
                    <span>{selectedHypervisor?.type === 'proxmox' ? '1 GB' : '10 GB'}</span>
                    <span>{maxDiskGb} GB</span>
                  </div>
                </div>
                )}
              </div>
            </motion.div>
          )}

          {/* Step 3: Resources */}
          {currentStep === 3 && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="p-6"
            >
              <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-6">Recursos</h2>

              <div className="space-y-6">
                {/* Only show CPU slider if configMode is 'custom' */}
                {configMode === 'custom' && (<>
                  <div className="flex items-center justify-between mb-2">
                    <label htmlFor="cpu" className="form-label mb-0">CPU Cores</label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="w-6 h-6 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center"
                        onClick={() => setVmParams(prev => ({
                          ...prev,
                          specs: {
                            ...prev.specs,
                            cpu: Math.max(1, prev.specs.cpu - 1)
                          }
                        }))}
                      >
                        -
                      </button>
                      <span className="text-slate-700 dark:text-slate-300">{vmParams.specs.cpu}</span>
                      <button
                        type="button"
                        className="w-6 h-6 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center"
                        onClick={() => setVmParams(prev => ({
                          ...prev,
                          specs: {
                            ...prev.specs,
                            cpu: Math.min(maxCpu, prev.specs.cpu + 1) // Use maxCpu
                          }
                        }))}
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center">
                    <Cpu className="h-5 w-5 text-slate-400 mr-2" />
                    <input
                      type="range"
                      id="cpu"
                      min="1" // Min CPU cores
                      max={maxCpu} // Max CPU cores from selected node or default
                      step="1"
                      className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer"
                      value={vmParams.specs.cpu}
                      onChange={(e) => setVmParams(prev => ({
                        ...prev,
                        specs: {
                          ...prev.specs,
                          cpu: parseInt(e.target.value)
                        }
                      }))}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 px-1 mt-1">
                    <span>1 core</span>
                    <span>{maxCpu} cores</span>
                  </div>
                </>)}

                {/* Only show Memory slider if configMode is 'custom' */}
                {configMode === 'custom' && (<>
                  <div className="flex items-center justify-between mb-2">
                    <label htmlFor="memory" className="form-label mb-0">Memoria (MB)</label>
                    <div className="text-slate-700 dark:text-slate-300">
                      {vmParams.specs.memory >= 1024
                        ? `${(vmParams.specs.memory / 1024).toFixed(1)} GB`
                        : `${vmParams.specs.memory} MB`}
                    </div>
                  </div>
                  <div className="flex items-center">
                    <Memory className="h-5 w-5 text-slate-400 mr-2" />
                    <input
                      type="range"
                      id="memory"
                      min="512" // Min memory in MB
                      max={maxMemoryMb} // Max memory in MB from selected node or default
                      step="512"
                      className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer"
                      value={vmParams.specs.memory}
                      onChange={(e) => setVmParams(prev => ({
                        ...prev,
                        specs: {
                          ...prev.specs,
                          memory: parseInt(e.target.value)
                        }
                      }))}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 px-1 mt-1">
                    <span>512 MB</span>
                    <span>{maxMemoryMb >= 1024 ? `${(maxMemoryMb / 1024).toFixed(0)} GB` : `${maxMemoryMb} MB`}</span>
                  </div>
                </>)}

                <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="start"
                      className="form-checkbox"
                      checked={vmParams.start}
                      onChange={(e) => setVmParams(prev => ({ ...prev, start: e.target.checked }))}
                    />
                    <label htmlFor="start" className="ml-2 text-sm text-slate-700 dark:text-slate-300">
                      arrancar la VM luego de creada
                    </label>
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
                  <h3 className="text-sm font-medium text-slate-900 dark:text-white mb-2">Resumen</h3>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <div className="sm:col-span-2">
                      <dt className="text-slate-500 dark:text-slate-400">Nombre</dt>
                      <dd className="text-slate-900 dark:text-white mt-0.5">{vmParams.name || '-'}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 dark:text-slate-400">Configuración</dt>
                      <dd className="text-slate-900 dark:text-white mt-0.5">{configMode === 'plan' ? (displayablePlans.find(p => p.id === vmParams.planId)?.name || 'Plan Selecccionado') : 'Especificaciones a Medida'}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 dark:text-slate-400">Sistema Operativo / Plantilla</dt>
                      <dd className="text-slate-900 dark:text-white mt-0.5">{templates.find(t => t.id === vmParams.templateId)?.name || '-'}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 dark:text-slate-400">Hypervisor</dt>
                      <dd className="text-slate-900 dark:text-white mt-0.5">
                        {vmParams.hypervisorId
                          ? availableHypervisors.find(h => h.id === vmParams.hypervisorId)?.name
                          : '-'
                        }
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 dark:text-slate-400">CPU</dt>
                      <dd className="text-slate-900 dark:text-white mt-0.5">{vmParams.specs.cpu} cores</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 dark:text-slate-400">Memoria</dt>
                      <dd className="text-slate-900 dark:text-white mt-0.5">
                        {vmParams.specs.memory >= 1024
                          ? `${(vmParams.specs.memory / 1024).toFixed(1)} GB`
                          : `${vmParams.specs.memory} MB`}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 dark:text-slate-400">Disco</dt>
                      <dd className="text-slate-900 dark:text-white mt-0.5">{vmParams.specs.disk} GB</dd>
                    </div>
                  </dl>
                </div>
              </div>
            </motion.div>
          )}

          {/* Navigation */}
          <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700 flex justify-between">
            <button
              type="button"
              onClick={handleBack}
              disabled={currentStep === 1}
              className="btn btn-secondary"
            >
              Atras
            </button>
            <button
              type="button"
              onClick={() => handleNext()}
              disabled={isNextDisabled() || isLoading}
              className="btn btn-primary"
            >
              {isLoading ? (
                <span className="inline-flex items-center">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Creando VM...
                </span>
              ) : currentStep < 3 ? 'Siguiente' : 'Creando VM'}
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center">
          <button
            onClick={() => navigate(-1)}
            className="mr-4 p-1 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700"
          >
            <ArrowLeft className="h-5 w-5 text-slate-600 dark:text-slate-400" />
          </button>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Crear Maquina Virtual</h1>
        </div>
        <p className="text-slate-500 dark:text-slate-400 mt-1 ml-10">
          Configure y despliegue una nueva maquina virtual
        </p>
      </div>

      {pageContent}
    </div>
  );
}
