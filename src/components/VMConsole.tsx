import React, { useState, useEffect, useRef } from 'react';
import { Monitor, Maximize2, Minimize2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth'; // For fetching auth token
import { toast } from 'react-hot-toast';

interface VMConsoleProps {
  vmId: string; // This should be the hypervisor_vm_id
  vmName: string;
  // hypervisorType: string; // May be needed if console handling differs (e.g. VNC vs WebMKS)
}

const VMConsole: React.FC<VMConsoleProps> = ({ vmId, vmName }) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [consoleUrl, setConsoleUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true); // Start with true
  const [error, setError] = useState<string | null>(null);
  const { token } = useAuth(); // Get auth token from context
  const consoleRef = useRef<HTMLIFrameElement>(null);
  const currentFetchVmIdRef = useRef<string | null>(null); // To track the vmId for which a fetch is in progress or was last completed

  useEffect(() => {
    // When vmId changes, reset relevant states
    setConsoleUrl(null);
    setError(null);
    setLoading(true); // Assume we will load for the new vmId
    currentFetchVmIdRef.current = vmId; // Track the current vmId we intend to fetch for

    if (!vmId) {
      setError("VM ID no proporcionado.");
      setLoading(false);
      return;
    }
    if (!token) {
      // Don't set an error here, as token might become available later, just don't load yet.
      // Or, if you prefer, setError("Autenticación requerida para la consola.");
      setLoading(false);
      return;
    }

    const fetchConsoleDetails = async (fetchForVmId: string) => {
      try {
        const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/vms/${fetchForVmId}/console`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        // If vmId has changed since this fetch started, ignore the result
        if (currentFetchVmIdRef.current !== fetchForVmId) {
          return;
        }

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.details || errorData.error || `Failed to get console URL: ${response.status}`);
        }

        const data = await response.json();
        if (data.url) {
          setConsoleUrl(data.url);
          setError(null);
        } else {
          throw new Error('Console URL not provided in API response.');
        }
      } catch (error: any) {
        console.error('Failed to initialize console:', error);
        // Only set error if this fetch is still relevant
        if (currentFetchVmIdRef.current === fetchForVmId) {
          setError(`Console Error: ${error.message}`);
          setConsoleUrl(null);
        }
        toast.error(`Console Error: ${error.message}`);
      } finally {
        // Only stop loading if this fetch is still relevant
        if (currentFetchVmIdRef.current === fetchForVmId) {
          setLoading(false);
        }
      }
    };

    fetchConsoleDetails(vmId);

    return () => {
      // Optional: If you want to signal that any ongoing fetch for this vmId is now stale
      // currentFetchVmIdRef.current = null; // Or handle in the fetch itself
    };
  }, [vmId, token]); // Effect runs if vmId or token changes

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  return (
    <div className={`bg-black rounded-lg shadow-lg overflow-hidden ${
      isFullscreen ? 'fixed inset-0 z-50' : 'h-80' // Adjusted default height
    }`}>
      <div className="bg-gray-800 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center">
          <Monitor size={16} className="text-gray-400 mr-2" />
          <h3 className="text-sm font-medium text-white">{vmName} Console</h3>
        </div>
        <button
          onClick={toggleFullscreen}
          className="text-gray-400 hover:text-white transition-colors"
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        >
          {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </div>

      <div
        className="bg-black h-full"
        style={{ height: isFullscreen ? 'calc(100% - 40px)' : 'calc(100% - 40px)' }} // Adjusted to fill remaining space
      >
        {loading && (
          <div className="flex items-center justify-center h-full text-gray-400">
            Loading console...
          </div>
        )}
        {!loading && error && (
          <div className="flex items-center justify-center h-full text-red-400 px-4 text-center">
            {error}
          </div>
        )}
        {!loading && !error && consoleUrl && (
          <iframe
            ref={consoleRef}
            // IMPORTANT: A raw 'wss://' URL will NOT work in an iframe src directly for VNC.
            // This iframe needs to load an HTML page (e.g., a self-hosted noVNC client)
            // which then uses this 'consoleUrl' (the WSS endpoint) to establish the VNC connection.
            // For example, src={`/noVNC/vnc.html?path=${encodeURIComponent(consoleUrl)}`}
            // Or, if 'consoleUrl' is an HTTP/S URL to a page that hosts the console (like Proxmox web UI's console page, or a WebMKS URL), it might work directly.
            // For now, we'll set it directly, assuming you'll handle the noVNC integration or the URL is directly usable.
            src={consoleUrl}
            className="w-full h-full border-0"
            title={`${vmName} Console`}
            // sandbox="allow-scripts allow-same-origin" // Consider sandbox attributes if loading external/complex content
          />
        )}
        {!loading && !error && !consoleUrl && (
          <div className="flex items-center justify-center h-full text-gray-400">
            Console unavailable.
          </div>
        )}
      </div>
    </div>
  );
};

export default VMConsole;
