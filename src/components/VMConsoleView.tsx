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
}

export interface VSphereHTML5ConsoleOption {
  type: 'vsphere_html5';
  connectionDetails: VSphereHTML5ConnectionDetails;
}

export interface VSphereWebMKSConsoleOption {
  type: 'vsphere_webmks';
  connectionDetails: VSphereWebMKSConnectionDetails;
}

export interface VSphereMKSConsoleOption {
  type: 'vsphere_mks';
  connectionDetails: VSphereMKSConnectionDetails;
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

  // Function to attempt connecting with a specific console option
  const attemptConnection = useCallback((option: ConsoleOption) => {
      console.log(`Attempting connection with type: ${option.type}`);
      setConnectionStatus(`Connecting via ${option.type}...`);
      setError(null); // Clear previous errors
      setCurrentConsoleType(option.type); // Set the type being attempted

      // Ensure previous clients are cleaned up before attempting a new one
      cleanupConsole();

      try {
          if (option.type === 'proxmox') {
              const details = option.connectionDetails;
              if (!rfbCanvasRef.current) {
                  throw new Error('RFB canvas element not found.');
              }

              // Construct WebSocket URL for Proxmox VNC via backend proxy
              const backendHost = window.location.hostname;
              // Use port 3001 in development, or the window's port in production
              const backendPort = import.meta.env.DEV ? 3001 : (window.location.port || (window.location.protocol === 'https:' ? 443 : 80));
              const backendWebSocketProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';

              // The backend endpoint should handle the Proxmox ticket and VNC port
              const rfbUrl = `${backendWebSocketProtocol}://${backendHost}:${backendPort}/ws/proxmox-console/${details.node}/${details.vmid}?ticket=${encodeURIComponent(details.ticket)}&vncPort=${details.vncPort}`;

              console.log(`Proxmox VNC (via Proxy): Connecting to ${rfbUrl}`);
              setConnectionStatus('Connecting to VNC...');

              if (!RFB) {
                  throw new Error("RFB module not available. Check import.");
              }

              rfbInstance.current = new RFB(rfbCanvasRef.current, rfbUrl, {
                  credentials: { password: details.ticket }, // Ticket is used as password for noVNC
                  // Other options can be added here if needed
              });

              // Add event listeners for noVNC
              rfbInstance.current.addEventListener('connect', () => {
                  console.log('Proxmox VNC: Connected');
                  setConnectionStatus(`Connected to ${vmName} (Proxmox)`);
              });

              rfbInstance.current.addEventListener('disconnect', (event: CustomEvent<{ clean: boolean, reason?: string }>) => {
                  console.log('Proxmox VNC: Disconnected', event.detail);
                  const reason = event.detail.reason || (event.detail.clean ? 'Clean disconnect' : 'Abrupt disconnect');
                  setConnectionStatus(`Disconnected from ${vmName} (Proxmox). Reason: ${reason}`);
                  if (!event.detail.clean) {
                      setError(`VNC connection lost: ${reason}`);
                      if (onError) onError(`VNC connection lost: ${reason}`);
                      // Optionally attempt next console option here if this one fails
                      // handleConnectionFailure(`Proxmox VNC failed: ${reason}`);
                  }
              });

              rfbInstance.current.addEventListener('securityfailure', (event: CustomEvent<{ reason?: string }>) => {
                  console.error('Proxmox VNC: Security failure', event.detail);
                  const reason = event.detail.reason || 'Unknown reason';
                  setConnectionStatus(`Security failure for ${vmName} (Proxmox)`);
                  setError(`VNC security failure: ${reason}`);
                  if (onError) onError(`VNC security failure: ${reason}`);
                  // Attempt next console option
                  handleConnectionFailure(`Proxmox VNC security failure: ${reason}`);
              });

              rfbInstance.current.addEventListener('error', (event: CustomEvent) => { // Simplified event type
                const detail = event.detail as { message?: string, reason?: string } | undefined; // Type assertion for detail
                console.error('Proxmox VNC: Error event', detail);
                const message = detail?.message || detail?.reason || 'Unknown error';

                   setConnectionStatus(`Error with ${vmName} (Proxmox)`);
                   setError(`VNC Error: ${message}`);
                   if (onError) onError(`VNC Error: ${message}`);
                   // Attempt next console option
                   handleConnectionFailure(`Proxmox VNC error: ${message}`);
              });


          } else if (option.type === 'vsphere_webmks') {
              const details = option.connectionDetails;
              if (!wmksContainerRef.current || !window.WMKS) {
                  throw new Error('WMKS container or library not found.');
              }
              // Ensure the container has the unique ID before creating WMKS instance
              wmksContainerRef.current.id = uniqueWmksId;

              console.log(`vSphere WebMKS: Connecting to ${details.host}:${details.port}`);
              setConnectionStatus('Connecting to vSphere WebMKS...');

              wmksInstance.current = window.WMKS.createWMKS(uniqueWmksId, {
                  // WMKS options can go here
                  // e.g., enableFullScreen: true, enableCopyPaste: true
              })
              .register<WMKSConnectionStateChangeData>(
                  window.WMKS.Events.CONNECTION_STATE_CHANGE,
                  (event, data) => {
                      console.log('vSphere WebMKS: State Change', data.state, data.error);
                      if (data.state === window.WMKS!.ConnectionState.CONNECTED) {
                          setConnectionStatus(`Connected to ${vmName} (vSphere WebMKS)`);
                      } else if (data.state === window.WMKS!.ConnectionState.CONNECTING) {
                          setConnectionStatus(`Connecting to ${vmName} (vSphere WebMKS)...`);
                      } else if (data.state === window.WMKS!.ConnectionState.INITIALIZED) {
                          setConnectionStatus(`Initializing ${vmName} (vSphere WebMKS)...`);
                      } else if (data.state === window.WMKS!.ConnectionState.CLOSING) {
                          setConnectionStatus(`Closing connection to ${vmName} (vSphere WebMKS)...`);
                      } else if (data.state === window.WMKS!.ConnectionState.DISCONNECTED) {
                          const reason = data.error?.message || 'Unknown reason';
                          setConnectionStatus(`Disconnected from ${vmName} (vSphere WebMKS). Reason: ${reason}`);
                          setError(`WebMKS disconnected: ${reason}`);
                          if (onError) onError(`WebMKS disconnected: ${reason}`);
                          // Attempt next console option
                          handleConnectionFailure(`WebMKS disconnected: ${reason}`);
                      }
                  }
              )
              .register<WMKSErrorData>(
                  window.WMKS.Events.ERROR,
                  (event, data) => {
                      console.error('vSphere WebMKS: Error Event', data);
                      const message = data.error?.message || data.errorType || 'Unknown error';
                      setConnectionStatus(`Error with ${vmName} (vSphere WebMKS)`);
                      setError(`WebMKS Error: ${message}`);
                      if (onError) onError(`WebMKS Error: ${message}`);
                      // Attempt next console option
                      handleConnectionFailure(`WebMKS error: ${message}`);
                  }
              );

              // Construct the WebMKS WebSocket URL
              const webmksUrl = `wss://${details.host}:${details.port}/ticket/${details.ticket}`;

              wmksInstance.current.connect(webmksUrl, {
                  useSSL: true,
                  sslThumbprint: details.sslThumbprint, // Required for SSL verification
              });

          } else if (option.type === 'vsphere_mks') {
              const details = option.connectionDetails;
              if (!wmksContainerRef.current || !window.WMKS) {
                  throw new Error('WMKS container or library not found.');
              }
               // Ensure the container has the unique ID before creating WMKS instance
              wmksContainerRef.current.id = uniqueWmksId;

              // Construct the MKS WebSocket URL using the vCenter proxy endpoint
              // Note: The MKS ticket URL format is specific to the vSphere Client's webconsole proxy
              const mksUrl = `wss://${details.vcenterHost}:9443/vsphere-client/webconsole/authd?mksTicket=${encodeURIComponent(details.mksTicket)}&host=${encodeURIComponent(details.esxiHost)}&port=${details.esxiPort}&cfgFile=${encodeURIComponent(details.cfgFile)}&sslThumbprint=${encodeURIComponent(details.sslThumbprint)}`;

              console.log(`vSphere MKS Ticket: Connecting to ${details.vcenterHost}:9443`);
              setConnectionStatus('Connecting to vSphere MKS...');

              wmksInstance.current = window.WMKS.createWMKS(uniqueWmksId, {
                  // WMKS options
              })
              .register<WMKSConnectionStateChangeData>(
                  window.WMKS.Events.CONNECTION_STATE_CHANGE,
                  (event, data) => {
                      console.log('vSphere MKS: State Change', data.state, data.error);
                       if (data.state === window.WMKS!.ConnectionState.CONNECTED) {
                          setConnectionStatus(`Connected to ${vmName} (vSphere MKS)`);
                      } else if (data.state === window.WMKS!.ConnectionState.CONNECTING) {
                           setConnectionStatus(`Connecting to ${vmName} (vSphere MKS)...`);
                      } else if (data.state === window.WMKS!.ConnectionState.INITIALIZED) {
                           setConnectionStatus(`Initializing ${vmName} (vSphere MKS)...`);
                      } else if (data.state === window.WMKS!.ConnectionState.CLOSING) {
                           setConnectionStatus(`Closing connection to ${vmName} (vSphere MKS)...`);
                      } else if (data.state === window.WMKS!.ConnectionState.DISCONNECTED) {
                          const reason = data.error?.message || 'Unknown reason';
                          setConnectionStatus(`Disconnected from ${vmName} (vSphere MKS). Reason: ${reason}`);
                          setError(`MKS disconnected: ${reason}`);
                          if (onError) onError(`MKS disconnected: ${reason}`);
                          // Attempt next console option
                          handleConnectionFailure(`MKS disconnected: ${reason}`);
                      }
                  }
              )
              .register<WMKSErrorData>(
                  window.WMKS.Events.ERROR,
                  (event, data) => {
                      console.error('vSphere MKS: Error Event', data);
                      const message = data.error?.message || data.errorType || 'Unknown error';
                      setConnectionStatus(`Error with ${vmName} (vSphere MKS)`);
                      setError(`MKS Error: ${message}`);
                      if (onError) onError(`MKS Error: ${message}`);
                      // Attempt next console option
                      handleConnectionFailure(`MKS error: ${message}`);
                  }
              );

              // For MKS tickets, the SSL thumbprint is part of the URL parameters,
              // but the WMKS connect method still requires a sslThumbprint option.
              // It might be the vCenter proxy's thumbprint, or just an empty string
              // if the URL parameters are sufficient for validation. Using an empty string here
              // as the URL contains the necessary thumbprint for the ESXi host.
              wmksInstance.current.connect(mksUrl, { useSSL: true, sslThumbprint: "" });

          } else if (option.type === 'vsphere_html5') {
              const details = option.connectionDetails;
              if (!iframeRef.current) {
                  throw new Error('HTML5 iframe element not found.');
              }
              console.log(`vSphere HTML5: Loading URL ${details.url}`);
              setConnectionStatus('Loading HTML5 console...');

              // Set iframe source
              iframeRef.current.src = details.url;

              // HTML5 console connection status is harder to track directly from iframe.
              // We can use load/error events, but they don't indicate the *console* connection status,
              // only whether the iframe content loaded.
              iframeRef.current.onload = () => {
                  console.log('vSphere HTML5: Iframe loaded');
                  setConnectionStatus(`HTML5 console loaded for ${vmName}`);
                  // Note: Actual console connection happens *inside* the iframe.
                  // We can't easily monitor its state from here.
              };
              iframeRef.current.onerror = () => {
                  console.error('vSphere HTML5: Iframe load error');
                  const message = 'HTML5 console iframe failed to load.';
                  setError(message);
                  if (onError) onError(message);
                  setConnectionStatus('Error loading HTML5 console');
                  // Attempt next console option
                  handleConnectionFailure(`HTML5 iframe failed to load.`);
              };
          } else {
              // Exhaustive check: should never reach here if all types are handled
              const _exhaustiveCheck: never = option;
              throw new Error(`Unsupported console type`);
          }
      } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          console.error(`Error initializing console client for type ${option.type}:`, e);
          setError(`Failed to initialize console client: ${message}`);
          if (onError) onError(`Failed to initialize console client: ${message}`);
          setConnectionStatus(`Error initializing ${option.type} client`);
          // Attempt next console option if initialization fails
          handleConnectionFailure(`Initialization failed for ${option.type}: ${message}`);
      }
  }, [vmName, consoleOptions, uniqueWmksId, onError, cleanupConsole]); // Added dependencies

  // Function to handle connection failure and attempt the next option
  const handleConnectionFailure = useCallback((reason: string) => {
      console.warn(`Connection attempt failed. Reason: ${reason}. Attempting next option...`);
      // Increment attempt index and try the next option in the list
      setAttemptIndex(prevIndex => {
          const nextIndex = prevIndex + 1;
          if (nextIndex < consoleOptions.length) {
              // Wait a moment before attempting the next connection
              setTimeout(() => {
                 attemptConnection(consoleOptions[nextIndex]);
              }, 1000); // 1 second delay before next attempt
              return nextIndex;
          } else {
              // No more options left
              console.error('All console connection options failed.');
              setConnectionStatus('All connection attempts failed.');
              setError(`Failed to connect using any available method. Last error: ${reason}`);
              if (onError) onError(`All connection attempts failed. Last error: ${reason}`);
              setCurrentConsoleType(null); // Ensure no client is rendered
              return prevIndex; // Stay at the last index
          }
      });
  }, [consoleOptions, attemptConnection, onError]); // Added dependencies

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
  }, [consoleDetails, attemptConnection, cleanupConsole, onError]); // Re-run effect if consoleDetails changes

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
              return <canvas ref={rfbCanvasRef} className="w-full h-full" />;
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

        <div className="flex-grow bg-black rounded overflow-hidden">
           {/* Render the appropriate console client */}
           {renderConsoleClient()}
        </div>
      </div>
    </div>
  );
};

export default VMConsoleView;
