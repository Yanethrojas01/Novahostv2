import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Server, Cpu, MemoryStick as Memory, HardDrive, Power, Activity } from 'lucide-react';
import type { VirtualMachine } from '../types/vm';
import { mockVMs } from '../utils/mockData';

export default function VMDetails() {
  const { id } = useParams();
  const [vm, setVM] = useState<VirtualMachine | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simulate API call to fetch VM details
    const fetchVM = () => {
      setLoading(true);
      // Find VM in mock data - in production, this would be an API call
      const foundVM = mockVMs.find(vm => vm.id === id);
      setVM(foundVM || null);
      setLoading(false);
    };

    fetchVM();
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!vm) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <Server className="w-16 h-16 text-gray-400 mb-4" />
        <h2 className="text-2xl font-semibold text-gray-700">Virtual Machine Not Found</h2>
        <p className="text-gray-500 mt-2">The requested VM could not be found.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-800 px-6 py-4">
          <div className="flex items-center space-x-4">
            <Server className="w-8 h-8 text-white" />
            <div>
              <h1 className="text-2xl font-bold text-white">{vm.name}</h1>
              <p className="text-blue-100">ID: {vm.id}</p>
            </div>
            <div className="ml-auto flex items-center space-x-2">
              <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                vm.status === 'running' ? 'bg-green-100 text-green-800' : 
                vm.status === 'stopped' ? 'bg-red-100 text-red-800' : 
                'bg-yellow-100 text-yellow-800'
              }`}>
                <Power className="w-4 h-4 mr-1" />
                {vm.status.charAt(0).toUpperCase() + vm.status.slice(1)}
              </span>
            </div>
          </div>
        </div>

        {/* Details Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
          {/* CPU Info */}
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center space-x-3 mb-3">
              <Cpu className="w-6 h-6 text-blue-600" />
              <h3 className="text-lg font-semibold text-gray-700">CPU</h3>
            </div>
            <p className="text-gray-600">{vm.cpu} vCPUs</p>
          </div>

          {/* Memory Info */}
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center space-x-3 mb-3">
              <Memory className="w-6 h-6 text-blue-600" />
              <h3 className="text-lg font-semibold text-gray-700">Memory</h3>
            </div>
            <p className="text-gray-600">{vm.memory} GB RAM</p>
          </div>

          {/* Storage Info */}
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center space-x-3 mb-3">
              <HardDrive className="w-6 h-6 text-blue-600" />
              <h3 className="text-lg font-semibold text-gray-700">Storage</h3>
            </div>
            <p className="text-gray-600">{vm.storage} GB</p>
          </div>
        </div>

        {/* Performance Metrics */}
        <div className="border-t border-gray-200 p-6">
          <div className="flex items-center space-x-2 mb-4">
            <Activity className="w-5 h-5 text-blue-600" />
            <h3 className="text-lg font-semibold text-gray-700">Performance Metrics</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-500">CPU Usage</p>
              <div className="mt-2 flex items-center">
                <div className="flex-1 bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-blue-600 h-2 rounded-full" 
                    style={{ width: `${vm.metrics?.cpuUsage || 0}%` }}
                  ></div>
                </div>
                <span className="ml-2 text-sm text-gray-600">{vm.metrics?.cpuUsage || 0}%</span>
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-500">Memory Usage</p>
              <div className="mt-2 flex items-center">
                <div className="flex-1 bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-blue-600 h-2 rounded-full" 
                    style={{ width: `${vm.metrics?.memoryUsage || 0}%` }}
                  ></div>
                </div>
                <span className="ml-2 text-sm text-gray-600">{vm.metrics?.memoryUsage || 0}%</span>
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-500">Disk Usage</p>
              <div className="mt-2 flex items-center">
                <div className="flex-1 bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-blue-600 h-2 rounded-full" 
                    style={{ width: `${vm.metrics?.diskUsage || 0}%` }}
                  ></div>
                </div>
                <span className="ml-2 text-sm text-gray-600">{vm.metrics?.diskUsage || 0}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}