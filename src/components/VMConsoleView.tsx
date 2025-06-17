import React, { useEffect, useRef, useState, useCallback } from 'react';
import RFB from '@novnc/novnc'; // Importar RFB desde el paquete npm
import { toast } from "react-hot-toast";

// Types for WMKS
type WMKSConnectionStateChangeData = {
  state: string;
  error?: { message?: string };
};
type WMKSErrorData = {
  errorType?: string;
  error?: { message?: string };
};
type WMKSEventHandler<T = unknown> = (event: unknown, data: T) => void;

type WMKSInstance = {
  register: <T = unknown>(event: string, handler: WMKSEventHandler<T>) => WMKSInstance;
  connect: (url: string, options: { useSSL: boolean; sslThumbprint: string }) => void;
  destroy: () => void;
  // Add other methods if used, e.g., sendCad(), sendKey(), sendMouseEvent()
};

type WMKSStatic = {
  createWMKS: (containerId: string, options: object) => WMKSInstance;
  Events: {
    CONNECTION_STATE_CHANGE: string;
    ERROR: string;
  };
  ConnectionState: {
    CONNECTED: string;
    DISCONNECTED: string;
    ERROR: string; // Add ERROR state if WMKS has it
    CONNECTING: string; // Add CONNECTING state
    INITIALIZED: string; // Add INITIALIZED state
    CLOSING: string; // Add CLOSING state
  };
};

declare global {
  interface Window {
    WMKS?: WMKSStatic; // VMware WebMKS library
  }
}

// Define connection details types for each hypervisor/method
export interface ProxmoxConnectionDetails {
  host: string; // Proxmox API host
  port: number; // Proxmox API port
  ticket: string; // This is the VNC password provided by Proxmox
  node: string; // Proxmox node name
  vmid: string | number; // Proxmox VM ID
  vmName?: string; // Optional VM name hint
  vncPort?: number; // The internal VNC port on the Proxmox node
}

// New type for vSphere MKS ticket details
export interface VSphereMKSConnectionDetails {
  vcenterHost: string; // vCenter host to connect WebSocket to (typically port 9443)
  mksTicket: string; // The MKS ticket
  esxiHost: string;    // ESXi host where VM runs (used in the URL)
  esxiPort: number;    // ESXi VNC port (e.g., 902) (used in the URL)
  cfgFile: string;     // Path to .vmx file (used in the URL)
  sslThumbprint: string; // ESXi host's SSL thumbprint (used in the URL)
  vmName?: string; // Optional VM name hint
}

// Type for vSphere WebMKS ticket details
export interface VSphereWebMKSConnectionDetails {
  host: string; // ESXi host or vCenter proxy (where the WebSocket connects)
  port: number; // Port for WebMKS ticket (e.g., 9443 for vCenter proxy, 443 for direct ESXi)
  ticket: string; // WebMKS ticket
  sslThumbprint: string; // Thumbprint of the 'host' (for SSL verification)
  vmName?: string; // Optional VM name hint
}

// Type for vSphere HTML5 console URL
export interface VSphereHTML5ConnectionDetails {
  url: string; // The full HTML5 console URL
  vmName?: string; // Optional VM name hint
}


// Define types for each specific console option returned by the backend
export interface ProxmoxConsoleOption {
  type: 'proxmox';
  connectionDetails: ProxmoxConnectionDetails;
  vmName?: string; // Optional VM name specific to this option

}

export interface VSphereHTML5ConsoleOption {
  type: 'vsphere_html5';
  connectionDetails: VSphereHTML5ConnectionDetails;
  vmName?: string; // Optional VM name specific to this option

}

export interface VSphereWebMKSConsoleOption {
  type: 'vsphere_webmks';
  connectionDetails: VSphereWebMKSConnectionDetails;
  vmName?: string; // Optional VM name specific to this option

}

export interface VSphereMKSConsoleOption {
  type: 'vsphere_mks';
  connectionDetails: VSphereMKSConnectionDetails;
  vmName?: string; // Optional VM name specific to this option

}

// Union type for all possible console options
export type ConsoleOption = ProxmoxConsoleOption | VSphereHTML5ConsoleOption | VSphereWebMKSConsoleOption | VSphereMKSConsoleOption;

// Interface for the data structure returned by the backend's /vm/<uuid>/console endpoint
export interface ConsoleDetailsData {
  vmName: string; // The VM name from the backend
  consoleOptions: ConsoleOption[]; // List of available console connection methods
};

// Props for the VMConsoleView component
interface VMConsoleViewProps {
  consoleDetails: ConsoleDetailsData;
  onClose: () => void;
  onError?: (message: string) => void;
}

const VMConsoleView: React.FC<VMConsoleViewProps> = ({ consoleDetails, onClose, onError }) => {
  const rfbCanvasRef = useRef<HTMLCanvasElement>(null);
  const wmksContainerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null); // For HTML5 console

  const [connectionStatus, setConnectionStatus] = useState('Initializing...');
  const [error, setError] = useState<string | null>(null);
  const [currentConsoleType, setCurrentConsoleType] = useState<ConsoleOption['type'] | null>(null);
  const [attemptIndex, setAttemptIndex] = useState(0); // Track which option we are attempting

  const rfbInstance = useRef<InstanceType<typeof RFB> | null>(null); // For Proxmox VNC
  const wmksInstance = useRef<WMKSInstance | null>(null); // For vSphere WebMKS/MKS

  const { vmName, consoleOptions } = consoleDetails;

  // Generate a unique ID for the WMKS container if needed
  const [uniqueWmksId] = useState(() => `wmks-container-${Math.random().toString(36).substring(2, 9)}`);

  // Cleanup function for all console types
  const cleanupConsole = useCallback(() => {
      console.log('Cleaning up console connections...');
      // Cleanup RFB (noVNC)
      if (rfbInstance.current) {
          console.log('Cleaning up Proxmox VNC connection');
          try {
              rfbInstance.current.disconnect();
          } catch (cleanupError) {
              console.warn('Error during RFB disconnect cleanup:', cleanupError);
          }
          rfbInstance.current = null;
      }
      // Cleanup WMKS
      if (wmksInstance.current) {
          console.log('Cleaning up vSphere WebMKS/MKS connection');
          wmksInstance.current.destroy();
          wmksInstance.current = null;
      }
      // Cleanup HTML5 iframe
      if (iframeRef.current) {
          console.log('Cleaning up HTML5 iframe');
          iframeRef.current.src = 'about:blank'; // Stop loading
          iframeRef.current.onload = null;
          iframeRef.current.onerror = null;
      }
      setCurrentConsoleType(null); // Reset current type
  }, []); // No dependencies needed for cleanup logic itself

  const attemptConnectionRef = useRef<((option: ConsoleOption) => void) | null>(null);

  const handleConnectionFailureRef = useRef<((reason: string) => void) | null>(null);

 // Function to handle connection failure and attempt the next option
 const handleConnectionFailure = useCallback((reason: string) => {
  console.warn(`Connection attempt failed. Reason: ${reason}. Attempting next option...`);
  // Increment attempt index and try the next option in the list
  setAttemptIndex(prevIndex => {
      const nextIndex = prevIndex + 1;
      // Ensure consoleOptions is available and nextIndex is within bounds
      if (consoleOptions && nextIndex < consoleOptions.length) {
    
          // Wait a moment before attempting the next connection
          setTimeout(() => { // Call through ref
            if (attemptConnectionRef.current) {
              attemptConnectionRef.current(consoleOptions[nextIndex]);
            }
          }, 0); // 1 second delay before next attempt
          return nextIndex;
      } else {
          // No more options left
          console.error('All console connection options failed.');
          setConnectionStatus('All connection attempts failed.');
          const finalErrorMessage = `Failed to connect using any available method. Last error: ${reason}`;
          setError(finalErrorMessage);
          if (onError) onError(finalErrorMessage);
          setCurrentConsoleType(null); // Ensure no client is rendered
          return prevIndex; // Stay at the last index
      }
  });
}, [consoleOptions, onError, setAttemptIndex, setConnectionStatus, setError, setCurrentConsoleType]);


// Effect to handle HTML5 iframe source and events AFTER it's rendered
useEffect(() => {
  if (currentConsoleType === 'vsphere_html5' && iframeRef.current && consoleOptions && consoleOptions.length > 0) {
    const html5Option = consoleOptions.find(opt => opt.type === 'vsphere_html5') as VSphereHTML5ConsoleOption | undefined;
  if (html5Option) {
    const details = html5Option.connectionDetails;
    console.log(`vSphere HTML5 (Effect): Loading URL ${details.url}`);
    setConnectionStatus('Loading HTML5 console...');
    console.log(`Setting iframe src to: ${details.url}`);
    iframeRef.current.src = details.url;

    const iframe = iframeRef.current; // Capture current ref value for cleanup

    const handleLoad = () => {
      console.log('vSphere HTML5 (Effect): Iframe loaded');
      setConnectionStatus(`HTML5 console loaded for ${vmName}`);
    };

    const handleError = (event: Event) => {
      console.error('vSphere HTML5 (Effect): Iframe load error', event);
      const message = 'HTML5 console iframe failed to load.';
      setError(message);
      if (onError) onError(message);
      setConnectionStatus('Error loading HTML5 console');
      // Attempt next console option if iframe fails to load
      if (handleConnectionFailureRef.current) { // Call through ref
        handleConnectionFailureRef.current(`HTML5 iframe failed to load.`);
      }
    };

    iframe.addEventListener('load', handleLoad);
    iframe.addEventListener('error', handleError);

    return () => {
      iframe.removeEventListener('load', handleLoad);
      iframe.removeEventListener('error', handleError);
    };
  }

} // eslint-disable-next-line react-hooks/exhaustive-deps 
}, [currentConsoleType, consoleOptions, vmName, onError]); // Removed iframeRef (ref object itself is stable) and handleConnectionFailure (will use ref)


  // Function to attempt connecting with a specific console option
  const attemptConnection = useCallback((option: ConsoleOption) => {
      const targetVmName = option.vmName || vmName; // Use option-specific vmName if available
      console.log(`Attempting connection with type: ${option.type} for VM: ${targetVmName}`);
      setConnectionStatus(`Initializing ${option.type}...`);
      setError(null); // Clear previous errors

      // Cleanup previous console *before* setting the new type.
      cleanupConsole();
      // Now, set the new console type. This will trigger the appropriate useEffect.
      setCurrentConsoleType(option.type);

  }, [vmName, cleanupConsole, setCurrentConsoleType, setConnectionStatus, setError]);

    // Update the ref whenever attemptConnection (the memoized function) changes
    useEffect(() => {
      attemptConnectionRef.current = attemptConnection;
    }, [attemptConnection]);
  
    useEffect(() => {
      handleConnectionFailureRef.current = handleConnectionFailure;
    }, [handleConnectionFailure]);

  // Effect for Proxmox VNC connection
  useEffect(() => {
    if (currentConsoleType === 'proxmox' && consoleOptions && consoleOptions.length > 0) {
      const proxmoxOption = consoleOptions.find(opt => opt.type === 'proxmox') as ProxmoxConsoleOption | undefined;
      const targetVmName = proxmoxOption?.vmName || vmName;

      if (!rfbCanvasRef.current) {
        console.error("Proxmox (Effect): RFB canvas element not found when expected.");
        if (handleConnectionFailureRef.current) {
          handleConnectionFailureRef.current("RFB canvas element not found for Proxmox.");
        }
        return;
      }
      if (!proxmoxOption) {
        console.error("Proxmox (Effect): Proxmox option details not found.");
        if (handleConnectionFailureRef.current) {
          handleConnectionFailureRef.current("Proxmox option details missing.");
        }
        return;
      }
      if (!RFB) {
        console.error("Proxmox (Effect): RFB module not available.");
        if (handleConnectionFailureRef.current) {
          handleConnectionFailureRef.current("RFB module not available.");
        }
        return;
      }

      const details = proxmoxOption.connectionDetails;
      const backendHost = window.location.hostname;
      const backendPort = import.meta.env.DEV ? 3001 : (window.location.port || (window.location.protocol === 'https:' ? 443 : 80));
      const backendWebSocketProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const rfbUrl = `${backendWebSocketProtocol}://${backendHost}:${backendPort}/ws/proxmox-console/${details.node}/${details.vmid}?ticket=${encodeURIComponent(details.ticket)}&vncPort=${details.vncPort}`;

      console.log(`Proxmox VNC (Effect via Proxy): Connecting to ${rfbUrl}`);
      setConnectionStatus('Connecting to VNC...');

      rfbInstance.current = new RFB(rfbCanvasRef.current, rfbUrl, {
        credentials: { password: details.ticket },
      });

      rfbInstance.current.addEventListener('connect', () => {
        console.log('Proxmox VNC (Effect): Connected');
        setConnectionStatus(`Connected to ${targetVmName} (Proxmox)`);
      });
      rfbInstance.current.addEventListener('disconnect', (event: CustomEvent<{ clean: boolean, reason?: string }>) => {
        console.log('Proxmox VNC (Effect): Disconnected', event.detail);
        const reason = event.detail.reason || (event.detail.clean ? 'Clean disconnect' : 'Abrupt disconnect');
        if (!event.detail.clean) {
          setError(`VNC connection lost: ${reason}`);
          if (onError) onError(`VNC connection lost: ${reason}`);
          if (handleConnectionFailureRef.current) {
            handleConnectionFailureRef.current(`Proxmox VNC disconnected: ${reason}`);
          }
        } else {
           setConnectionStatus(`Disconnected from ${targetVmName} (Proxmox). Reason: ${reason}`);
        }
      });
      rfbInstance.current.addEventListener('securityfailure', (event: CustomEvent<{ reason?: string }>) => {
        console.error('Proxmox VNC (Effect): Security failure', event.detail);
        const reason = event.detail.reason || 'Unknown reason';
        setError(`VNC security failure: ${reason}`);
        if (onError) onError(`VNC security failure: ${reason}`);
        if (handleConnectionFailureRef.current) {
          handleConnectionFailureRef.current(`Proxmox VNC security failure: ${reason}`);
        }
      });
      rfbInstance.current.addEventListener('error', (event: CustomEvent) => {
        const detail = event.detail as { message?: string, reason?: string } | undefined;
        console.error('Proxmox VNC (Effect): Error event', detail);
        const message = detail?.message || detail?.reason || 'Unknown VNC error';
        setError(`VNC Error: ${message}`);
        if (onError) onError(`VNC Error: ${message}`);
        if (handleConnectionFailureRef.current) {
          handleConnectionFailureRef.current(`Proxmox VNC error: ${message}`);
        }
      });

      return () => {
        if (rfbInstance.current) {
          console.log('Proxmox (Effect Cleanup): Disconnecting RFB instance.');
         // Check if connected before trying to disconnect to avoid errors on already disconnected instances
         if (rfbInstance.current.connected) {
          rfbInstance.current.disconnect();
        }
        rfbInstance.current = null; // Clear the ref

        }
      };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentConsoleType, consoleOptions, vmName, onError, setConnectionStatus, setError]);

  // Effect for vSphere WMKS/MKS connection
  useEffect(() => {
    if ((currentConsoleType === 'vsphere_webmks' || currentConsoleType === 'vsphere_mks') && consoleOptions && consoleOptions.length > 0) {
      const wmksOption = consoleOptions.find(opt => opt.type === currentConsoleType) as (VSphereWebMKSConsoleOption | VSphereMKSConsoleOption) | undefined;
      const targetVmName = wmksOption?.vmName || vmName;

      if (!wmksContainerRef.current) {
        console.error(`vSphere ${currentConsoleType} (Effect): WMKS container not found.`);
        if (handleConnectionFailureRef.current) handleConnectionFailureRef.current("WMKS container not found.");
        return;
      }
      if (!window.WMKS) {
        console.error(`vSphere ${currentConsoleType} (Effect): WMKS library not found.`);
        if (handleConnectionFailureRef.current) handleConnectionFailureRef.current("WMKS library not available.");
        return;
      }
      if (!wmksOption) {
        console.error(`vSphere ${currentConsoleType} (Effect): Option details not found.`);
        if (handleConnectionFailureRef.current) handleConnectionFailureRef.current("WMKS option details missing.");
        return;
      }

      wmksContainerRef.current.id = uniqueWmksId; // Ensure ID is set
      setConnectionStatus(`Connecting to vSphere ${currentConsoleType}...`);

      wmksInstance.current = window.WMKS.createWMKS(uniqueWmksId, {})
        .register<WMKSConnectionStateChangeData>(window.WMKS.Events.CONNECTION_STATE_CHANGE, (event, data) => {
          console.log(`vSphere ${currentConsoleType} (Effect): State Change`, data.state, data.error);
          if (data.state === window.WMKS!.ConnectionState.CONNECTED) {
            setConnectionStatus(`Connected to ${targetVmName} (vSphere ${currentConsoleType})`);
          } else if (data.state === window.WMKS!.ConnectionState.DISCONNECTED) {
            const reason = data.error?.message || 'Unknown reason';
            setError(`${currentConsoleType} disconnected: ${reason}`);
            if (onError) onError(`${currentConsoleType} disconnected: ${reason}`);
            if (handleConnectionFailureRef.current) handleConnectionFailureRef.current(`${currentConsoleType} disconnected: ${reason}`);
          } else {
            setConnectionStatus(`${data.state} to ${targetVmName} (vSphere ${currentConsoleType})...`);
          }
        })
        .register<WMKSErrorData>(window.WMKS.Events.ERROR, (event, data) => {
          console.error(`vSphere ${currentConsoleType} (Effect): Error Event`, data);
          const message = data.error?.message || data.errorType || 'Unknown WMKS error';
          setError(`${currentConsoleType} Error: ${message}`);
          if (onError) onError(`${currentConsoleType} Error: ${message}`);
          if (handleConnectionFailureRef.current) handleConnectionFailureRef.current(`${currentConsoleType} error: ${message}`);
        });

      let connectUrl: string;
      let connectOptions: { useSSL: boolean; sslThumbprint: string };

      if (wmksOption.type === 'vsphere_webmks') {
        const details = wmksOption.connectionDetails;
        connectUrl = `wss://${details.host}:${details.port}/ticket/${details.ticket}`;
        connectOptions = { useSSL: true, sslThumbprint: details.sslThumbprint };
      } else { // vsphere_mks
        const details = wmksOption.connectionDetails;
        connectUrl = `wss://${details.vcenterHost}:9443/vsphere-client/webconsole/authd?mksTicket=${encodeURIComponent(details.mksTicket)}&host=${encodeURIComponent(details.esxiHost)}&port=${details.esxiPort}&cfgFile=${encodeURIComponent(details.cfgFile)}&sslThumbprint=${encodeURIComponent(details.sslThumbprint)}`;
        connectOptions = { useSSL: true, sslThumbprint: "" }; // Thumbprint is in URL for MKS via vCenter proxy
      }
      console.log(`vSphere ${currentConsoleType} (Effect): Connecting to ${connectUrl.split('?')[0]}`);
      wmksInstance.current.connect(connectUrl, connectOptions);

      return () => {
        if (wmksInstance.current) {
          console.log(`WMKS (Effect Cleanup): Destroying ${currentConsoleType} instance.`);
          wmksInstance.current.destroy();
          wmksInstance.current = null;
        }
      };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentConsoleType, consoleOptions, vmName, onError, uniqueWmksId, setConnectionStatus, setError]);

  // Effect to start the connection process when consoleDetails change
  useEffect(() => {
      if (consoleOptions && consoleOptions.length > 0) {
          setAttemptIndex(0); // Start from the first option
          attemptConnection(consoleOptions[0]);
      } else {
          setError("No console options provided by the backend.");
          setConnectionStatus("Error: No console options.");
          if (onError) onError("No console options provided by the backend.");
          setCurrentConsoleType(null); // Ensure no client is rendered
      }

      // Return the cleanup function
      return () => {
          cleanupConsole();
      };
    }, [consoleDetails, attemptConnection, cleanupConsole, onError]); // Removed consoleOptions (derived from consoleDetails)

  // Determine which console client to render based on currentConsoleType
  const renderConsoleClient = () => {
      if (!currentConsoleType) {
        return null;
      }

      // currentConsoleType is guaranteed to be ConsoleOption['type'] here.
      // We find the optionDetails to potentially pass to specific renderers if needed,
      // but the switch itself is on currentConsoleType.
      const optionDetails = consoleOptions.find(opt => opt.type === currentConsoleType);
      
      if (!optionDetails) {
          // This case should ideally not be reached if currentConsoleType is valid and consoleOptions is populated.
          console.error(`Render error: No option details found for active console type: ${currentConsoleType}`);
          return <div className="text-center text-red-500">Error interno al renderizar la consola.</div>;
      }

      switch (currentConsoleType) {
          case 'proxmox':
              // RFB (noVNC) uses a canvas element
              // Added explicit minHeight and minWidth to ensure visibility
              return <canvas ref={rfbCanvasRef} className="w-full h-full" style={{ minHeight: '400px', minWidth: '600px', backgroundColor: '#000' }} />;
          case 'vsphere_webmks':
          case 'vsphere_mks':
              // WMKS uses a div container
              return <div ref={wmksContainerRef} id={uniqueWmksId} className="w-full h-full" />;
          case 'vsphere_html5':
        
              return <iframe ref={iframeRef} className="w-full h-full border-none" src="" title={`${vmName} Console`} allowFullScreen />;
          default:
// This makes the switch exhaustive for currentConsoleType
const _exhaustiveCheck: never = currentConsoleType;
return <div className="text-center text-red-500">Tipo de consola no reconocido: {_exhaustiveCheck}</div>;
}
  };


  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 p-2 rounded-lg shadow-xl w-full max-w-4xl h-[85vh] flex flex-col">
        <div className="flex justify-between items-center mb-2 text-white">
          <h3 className="text-lg font-semibold">
            Console: {vmName}
          </h3>
          <button onClick={onClose} className="text-slate-300 hover:text-white">&times; Close</button>
        </div>
        <p className="text-xs text-slate-400 mb-2">Status: {connectionStatus}</p>
        {/* Display current console type being attempted/used */}
        {currentConsoleType && <p className="text-xs text-slate-400 mb-2">Method: {currentConsoleType}</p>}
        {error && <p className="text-xs text-red-400 mb-2">Error: {error}</p>}

        <div className="flex-grow bg-black rounded overflow-hidden" style={{ minHeight: '400px', minWidth: '600px' }}>
           {/* Render the appropriate console client */}
           {renderConsoleClient()}
        </div>
      </div>
    </div>
  );
};

export default VMConsoleView;
