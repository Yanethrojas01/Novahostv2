import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Server, Cpu, MemoryStick as Memory } from 'lucide-react';
import { motion } from 'framer-motion';
import { VMCreateParams, VMTemplate } from '../types/vm'; // Use VMTemplate from vm.ts
import { Hypervisor } from '../types/hypervisor'; // Import Hypervisor type
// import { supabase } from '../lib/supabase'; // Remove direct Supabase usage
import { toast } from 'react-hot-toast';

const API_BASE_URL = 'http://localhost:3001/api'; // Define API base URL

export default function CreateVM() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false); // General loading state for create action
  const [isFetchingHypervisors, setIsFetchingHypervisors] = useState(true);
  const [isFetchingTemplates, setIsFetchingTemplates] = useState(false);
  const [availableHypervisors, setAvailableHypervisors] = useState<Hypervisor[]>([]);
  const [templates, setTemplates] = useState<VMTemplate[]>([]); // Use VMTemplate type

  const [vmParams, setVmParams] = useState<VMCreateParams>({
    name: '',
    description: '',
    hypervisorId: '',
    specs: {
      cpu: 1,
      memory: 1024,
      disk: 20,
      // os: '', // We'll use templateId instead
    },
    start: true,
    tags: [],
    templateId: undefined, // Initialize templateId
  });

  const [tagInput, setTagInput] = useState('');

  // Fetch hypervisors on mount
  useEffect(() => {
    const fetchHypervisors = async () => {
      setIsFetchingHypervisors(true);
      try {
        const response = await fetch(`${API_BASE_URL}/hypervisors`, {
          headers: { 'Authorization': 'Bearer MOCK_TOKEN' }, // Replace with actual token logic
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
    fetchHypervisors();
  }, []);

  // Fetch templates when hypervisor changes
  useEffect(() => {
    setTemplates([]); // Clear previous templates
    setVmParams(prev => ({ ...prev, templateId: undefined })); // Clear selected template

    if (vmParams.hypervisorId) {
      const fetchTemplates = async () => {
        setIsFetchingTemplates(true);
        try {
          const response = await fetch(`${API_BASE_URL}/hypervisors/${vmParams.hypervisorId}/templates`, {
            headers: { 'Authorization': 'Bearer MOCK_TOKEN' }, // Replace with actual token logic
          });
          if (!response.ok) throw new Error('Failed to fetch templates');
          const data: VMTemplate[] = await response.json();
          setTemplates(data);
        } catch (error) {
          console.error('Error fetching templates:', error);
          toast.error('Could not load templates for the selected hypervisor.');
        } finally {
          setIsFetchingTemplates(false);
        }
      };
      fetchTemplates();
    }
  }, [vmParams.hypervisorId]);

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

  const handleCreate = async () => {
    setIsLoading(true);
    try {
      // Call the backend API to create the VM
      const response = await fetch(`${API_BASE_URL}/vms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer MOCK_TOKEN', // Use actual token
        },
        body: JSON.stringify(vmParams),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
        throw new Error(errorData.error || `Failed to initiate VM creation (status: ${response.status})`);
      }

      const result = await response.json();
      toast.success(result.message || 'VM creation initiated successfully!');

      // Remove Supabase call from frontend
      // Redirect to the dashboard
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
      return !vmParams.templateId; // Check if a template is selected
    }
    return false;
  };

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
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Create Virtual Machine</h1>
        </div>
        <p className="text-slate-500 dark:text-slate-400 mt-1 ml-10">
          Configure and deploy a new virtual machine
        </p>
      </div>

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
              Basic Info
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
              OS & Storage
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
              Resources
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
            <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-6">Basic Information</h2>

            <div className="space-y-4">
              <div>
                <label htmlFor="name" className="form-label">VM Name</label>
                <input
                  type="text"
                  id="name"
                  className="form-input"
                  placeholder="e.g., web-server-1"
                  value={vmParams.name}
                  onChange={(e) => setVmParams(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>

              <div>
                <label htmlFor="description" className="form-label">Description</label>
                <textarea
                  id="description"
                  rows={3}
                  className="form-input"
                  placeholder="What is this VM for?"
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
                  <option value="">{isFetchingHypervisors ? 'Loading...' : 'Select a connected hypervisor'}</option>
                  {availableHypervisors.map(h => (
                    <option key={h.id} value={h.id}>
                      {h.name} ({h.type})
                    </option>
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
                    placeholder="Add a tag..."
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
                    Add
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
            <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-6">Operating System & Storage</h2>

            <div className="space-y-6">
              <div>
                <label className="form-label">Available Templates</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {isFetchingTemplates ? (
                    // Loading skeleton
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
                          vmParams.templateId === template.id // Check templateId
                            ? 'border-primary-500 dark:border-primary-400 bg-primary-50 dark:bg-primary-900/20 ring-2 ring-primary-300'
                            : 'border-slate-200 dark:border-slate-700'
                        }`}
                        onClick={() => setVmParams(prev => ({
                          ...prev,
                          templateId: template.id // Set templateId
                        }))}
                      >
                        <Server className="h-8 w-8 mx-auto mb-2 text-slate-500 dark:text-slate-400" />
                        <div className="text-sm font-medium">{template.name}</div>
                        {template.osVersion && (
                          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            {template.osVersion}
                          </div>
                        )}
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          {(template.size / (1024 * 1024 * 1024)).toFixed(1)} GB
                        </div>
                      </button>
                    ))
                  ) : (
                    <p className="col-span-full text-slate-500 dark:text-slate-400 text-sm">No templates found or hypervisor not selected.</p>
                  )}
                </div>
              </div>

              <div>
                <label htmlFor="disk" className="form-label">Disk Size (GB)</label>
                <div className="flex items-center">
                  <input
                    type="range"
                    id="disk"
                    min="10"
                    max="500"
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
                  <span>10 GB</span>
                  <span>500 GB</span>
                </div>
              </div>
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
            <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-6">Resources</h2>

            <div className="space-y-6">
              <div>
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
                          cpu: Math.min(16, prev.specs.cpu + 1)
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
                    min="1"
                    max="16"
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
                  <span>16 cores</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label htmlFor="memory" className="form-label mb-0">Memory (MB)</label>
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
                    min="512"
                    max="32768"
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
                  <span>32 GB</span>
                </div>
              </div>

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
                    Start VM after creation
                  </label>
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
                <h3 className="text-sm font-medium text-slate-900 dark:text-white mb-2">Summary</h3>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div className="sm:col-span-2">
                    <dt className="text-slate-500 dark:text-slate-400">Name</dt>
                    <dd className="text-slate-900 dark:text-white mt-0.5">{vmParams.name || '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">Operating System</dt>
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
                    <dt className="text-slate-500 dark:text-slate-400">Memory</dt>
                    <dd className="text-slate-900 dark:text-white mt-0.5">
                      {vmParams.specs.memory >= 1024
                        ? `${(vmParams.specs.memory / 1024).toFixed(1)} GB`
                        : `${vmParams.specs.memory} MB`}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">Disk</dt>
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
            Back
          </button>
          <button
            type="button"
            onClick={handleNext}
            disabled={isNextDisabled() || isLoading}
            className="btn btn-primary"
          >
            {isLoading ? (
              <span className="inline-flex items-center">
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Creating VM...
              </span>
            ) : currentStep < 3 ? 'Next' : 'Create VM'}
          </button>
        </div>
      </div>
    </div>
  );
}
