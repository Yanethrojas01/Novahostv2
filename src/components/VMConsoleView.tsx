import React, { useEffect, useRef, useState } from 'react';

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
  };
};

// Types for noVNC (RFB) loaded from CDN
type RFBEventListener = (e: CustomEvent<any>) => void;

interface RFBInstance {
  disconnect(): void;
  addEventListener: (type: 'connect' | 'disconnect' | 'securityfailure' | string, listener: RFBEventListener) => void;
}

interface RFBStatic {
  new (target: HTMLElement | null, url: string, options?: {
    credentials?: { password?: string; username?: string; target?: string };
    shared?: boolean;
    repeaterID?: string;
  }): RFBInstance;
}
declare global {
  interface Window {
    WMKS?: WMKSStatic; // VMware WebMKS library
    RFB?: RFBStatic;    // noVNC RFB library from CDN
  }
}

export interface ProxmoxConnectionDetails {
  host: string;
  port: number;
  ticket: string; // This is the VNC password
  node: string;
  vmid: string | number;
  vmName?: string;
}

export interface VSphereConnectionDetails {
  host: string;
  port: number;
  ticket: string; // WebMKS ticket
  sslThumbprint: string;
  vmName?: string;
}
export type ConsoleDetailsData = {
  type: 'proxmox' | 'vsphere';
  connectionDetails: ProxmoxConnectionDetails | VSphereConnectionDetails;
  vmName?: string;
};

interface VMConsoleViewProps {
  consoleDetails: ConsoleDetailsData;
  onClose: () => void;
  onError?: (message: string) => void;
}

// Fixed script loading mechanism specifically for Vite + noVNC
function loadNoVNCScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Comprobamos si ya existe el script o si RFB ya está definido
    if (window.RFB) {
      console.log("window.RFB already defined, no need to load script");
      resolve();
      return;
    }
    
    if (document.getElementById("novnc-script")) {
      console.log("noVNC script tag already exists");
      setTimeout(() => {
        if (window.RFB) {
          resolve();
        } else {
          reject(new Error("Script exists but RFB not defined"));
        }
      }, 500);
      return;
    }

    console.log("Loading noVNC UMD bundle from CDN...");
    
    // Creamos el script tag
    const script = document.createElement("script");
    script.id = "novnc-script";
    script.type = "text/javascript";
    
    // Usamos la versión UMD que funciona mejor con Vite
    script.src = "https://cdn.jsdelivr.net/npm/@novnc/novnc@1.3.0/dist/novnc.min.js";
    
    // Importante para CORS
    script.crossOrigin = "anonymous";
    
    script.onload = () => {
      console.log("noVNC script loaded successfully");
      
      // Verificamos que RFB esté definido
      if (window.RFB) {
        console.log("window.RFB is available");
        resolve();
      } else {
        console.warn("noVNC script loaded but RFB not defined");
        reject(new Error("RFB not defined after loading script"));
      }
    };
    
    script.onerror = (error) => {
      console.error("Error loading noVNC script:", error);
      script.remove();
      reject(new Error("Failed to load noVNC script"));
    };
    
    // Agregamos el script al <head>
    document.head.appendChild(script);
  });
}

// Intentar cargar desde varias fuentes
async function loadNoVNCLibrary(): Promise<void> {
  // Lista de CDNs para intentar en orden
  const cdnSources = [
    {
      name: "jsDelivr 1.3.0 (UMD)",
      url: "https://cdn.jsdelivr.net/npm/@novnc/novnc@1.3.0/dist/novnc.min.js"
    },
    {
      name: "UNPKG 1.3.0 (UMD)",
      url: "https://unpkg.com/@novnc/novnc@1.3.0/dist/novnc.min.js"
    },
    {
      name: "jsDelivr 1.2.0 (UMD)",
      url: "https://cdn.jsdelivr.net/npm/@novnc/novnc@1.2.0/dist/novnc.min.js"
    }
  ];

  // Si RFB ya está definido, no necesitamos hacer nada
  if (window.RFB) {
    console.log("window.RFB already available");
    return;
  }

  console.log("Attempting to load noVNC from multiple sources...");
  
  let lastError = null;
  
  for (const source of cdnSources) {
    try {
      console.log(`Trying ${source.name}...`);
      
      // Eliminar cualquier script de noVNC anterior que haya fallado
      const existingScript = document.getElementById("novnc-script");
      if (existingScript) {
        existingScript.remove();
      }
      
      // Crear y añadir el nuevo script
      const script = document.createElement("script");
      script.id = "novnc-script";
      script.src = source.url;
      script.crossOrigin = "anonymous";
      
      // Esperar a que se cargue el script
      await new Promise<void>((resolve, reject) => {
        script.onload = () => {
          if (window.RFB) {
            console.log(`Successfully loaded noVNC from ${source.name}`);
            resolve();
          } else {
            reject(new Error(`Script loaded but RFB not defined from ${source.name}`));
          }
        };
        script.onerror = () => reject(new Error(`Failed to load from ${source.name}`));
        document.head.appendChild(script);
      });
      
      // Si llegamos aquí, significa que la carga fue exitosa
      return;
      
    } catch (error) {
      console.warn(`Failed with ${source.name}:`, error);
      lastError = error;
      // Seguir con la siguiente fuente
    }
  }
  
  // Si llegamos aquí, todas las fuentes fallaron
  throw new Error(`All noVNC sources failed: ${lastError?.message || 'Unknown error'}`);
}

const VMConsoleView: React.FC<VMConsoleViewProps> = ({ consoleDetails, onClose, onError }) => {
  const rfbCanvasRef = useRef<HTMLCanvasElement>(null);
  const wmksContainerRef = useRef<HTMLDivElement>(null);
  const [connectionStatus, setConnectionStatus] = useState('Initializing...');
  const [error, setError] = useState<string | null>(null);
  const [isLibraryLoading, setIsLibraryLoading] = useState(false);

  const rfbInstance = useRef<RFBInstance | null>(null);
  const wmksInstance = useRef<WMKSInstance | null>(null);

  useEffect(() => {
    let isMounted = true;
    setError(null);
    setConnectionStatus('Connecting...');

    const { type, connectionDetails: rawConnectionDetails } = consoleDetails;
    const vmName = rawConnectionDetails.vmName || consoleDetails.vmName || 'VM';

    async function initProxmoxRFB() {
      if (!rfbCanvasRef.current) {
        setError('RFB canvas element not found.');
        setConnectionStatus('Error: Canvas missing');
        if (onError) onError('RFB canvas element not found.');
        return;
      }

      try {
        // Prevent multiple simultaneous loading attempts
        if (isLibraryLoading) {
          console.log("Library loading already in progress");
          return;
        }
        
        setIsLibraryLoading(true);
        setConnectionStatus('Loading VNC library...');
        
        // Try to load noVNC with multiple fallbacks
        if (!window.RFB) {
          try {
            await loadNoVNCLibrary();
            console.log("noVNC library loaded successfully");
          } catch (error) {
            console.error("Error loading noVNC library:", error);
            throw new Error(`Failed to load noVNC library: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        // Now that we know window.RFB is available, proceed with connection
        const connectionDetails = rawConnectionDetails as ProxmoxConnectionDetails;
        const { host, port, ticket, node, vmid } = connectionDetails;
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const rfbUrl = `${protocol}://${host}:${port}`;

        console.log(`Proxmox VNC: Connecting to ${rfbUrl} for VM ${vmid} on node ${node}`);
        setConnectionStatus('Connecting to VNC...'); // Update status after library load

        try {
          if (!window.RFB) {
            throw new Error("RFB is still not defined after loading attempts");
          }
          
          rfbInstance.current = new window.RFB(rfbCanvasRef.current, rfbUrl, {
            credentials: { password: ticket },
          });

          rfbInstance.current.addEventListener('connect', () => {
            if (!isMounted) return;
            setConnectionStatus(`Connected to ${vmName} (Proxmox)`);
            console.log('Proxmox VNC: Connected');
          });

          rfbInstance.current.addEventListener('disconnect', (event: CustomEvent<{ clean: boolean }>) => {
            if (!isMounted) return;
            setConnectionStatus(`Disconnected from ${vmName} (Proxmox). ${event.detail.clean ? 'Cleanly.' : 'Abruptly.'}`);
            console.log('Proxmox VNC: Disconnected', event.detail);
            if (!event.detail.clean) {
              setError('VNC connection lost abruptly.');
              if (onError) onError('VNC connection lost abruptly.');
            }
          });

          rfbInstance.current.addEventListener('securityfailure', (event: CustomEvent<{ reason?: string }>) => {
            if (!isMounted) return;
            setConnectionStatus(`Security failure for ${vmName} (Proxmox)`);
            console.error('Proxmox VNC: Security failure', event.detail);
            setError(`VNC security failure: ${event.detail.reason || 'Unknown reason'}`);
            if (onError) onError(`VNC security failure: ${event.detail.reason || 'Unknown reason'}`);
          });

        } catch (e: unknown) {
          if (!isMounted) return;
          console.error('Proxmox VNC: RFB instantiation error', e);
          const message = e instanceof Error ? e.message : String(e);
          setError(`Failed to initialize VNC client: ${message}`);
          if (onError) onError(`Failed to initialize VNC client: ${message}`);
          setConnectionStatus('Error initializing VNC');
        }

      } catch (loadError: any) {
        console.error('Proxmox VNC: Failed to ensure noVNC script is loaded:', loadError);
        const message = loadError instanceof Error ? loadError.message : String(loadError);
        setError(`Failed to load VNC library (noVNC): ${message}`);
        setConnectionStatus('Error loading VNC library');
        if (onError) onError(`Failed to load VNC library (noVNC): ${message}`);
      } finally {
        setIsLibraryLoading(false);
      }
    }

    if (type === 'proxmox') {
      initProxmoxRFB();
    } else if (type === 'vsphere') {
      const connectionDetails = rawConnectionDetails as VSphereConnectionDetails;
      if (wmksContainerRef.current && window.WMKS) {
        const { host, port, ticket, sslThumbprint } = connectionDetails;
        console.log(`vSphere WebMKS: Connecting to ${host}:${port} for VM ${vmName}`);

        try {
          if (!wmksContainerRef.current.id) {
            wmksContainerRef.current.id = 'wmks-container-' + Math.random().toString(36).substring(2, 15);
          }

          wmksInstance.current = window.WMKS.createWMKS(wmksContainerRef.current.id, {})
            .register<WMKSConnectionStateChangeData>(
              window.WMKS.Events.CONNECTION_STATE_CHANGE,
              (event, data) => {
                if (!isMounted) return;
                if (data.state === window.WMKS!.ConnectionState.CONNECTED) {
                  setConnectionStatus(`Connected to ${vmName} (vSphere)`);
                  console.log('vSphere WebMKS: Connected');
                } else if (data.state === window.WMKS!.ConnectionState.DISCONNECTED) {
                  setConnectionStatus(`Disconnected from ${vmName} (vSphere). ${data.error?.message ? data.error.message : ''}`);
                  console.log('vSphere WebMKS: Disconnected', data.error);
                  if (data.error) {
                    setError(`WebMKS disconnected: ${data.error.message || 'Unknown reason'}`);
                    if (onError) onError(`WebMKS disconnected: ${data.error.message || 'Unknown reason'}`);
                  }
                }
              }
            )
            .register<WMKSErrorData>(
              window.WMKS.Events.ERROR,
              (event, data) => {
                if (!isMounted) return;
                setConnectionStatus(`Error with ${vmName} (vSphere)`);
                console.error('vSphere WebMKS: Error', data);
                setError(`WebMKS Error: ${data.errorType || 'Unknown error'}`);
                if (onError) onError(`WebMKS Error: ${data.errorType || 'Unknown error'}`);
              }
            );

          wmksInstance.current.connect(`wss://${host}:${port}/ticket/${ticket}`, {
            useSSL: true,
            sslThumbprint: sslThumbprint,
          });
        } catch (e: unknown) {
          if (!isMounted) return;
          const message = e instanceof Error ? e.message : String(e);
          console.error('vSphere WebMKS: WMKS instantiation or connection error', e);
          setError(`Failed to initialize WebMKS client: ${message}`);
          if (onError) onError(`Failed to initialize WebMKS client: ${message}`);
          setConnectionStatus('Error initializing WebMKS');
        }
      } else if (!window.WMKS) {
        if (!isMounted) return;
        console.error('vSphere WebMKS: WMKS library not found. Ensure wmks.js is loaded.');
        setError('WMKS library not found. Please contact support.');
        if (onError) onError('WMKS library not found.');
        setConnectionStatus('Error: WMKS library missing');
      }
    }

    return () => {
      isMounted = false;

      if (rfbInstance.current) {
        console.log('Cleaning up Proxmox VNC connection');
        try {
          rfbInstance.current.disconnect();
        } catch (cleanupError) {
          console.warn('Error during RFB disconnect cleanup:', cleanupError);
        }
        rfbInstance.current = null;
      }
      if (wmksInstance.current) {
        console.log('Cleaning up vSphere WebMKS connection');
        wmksInstance.current.destroy();
        wmksInstance.current = null;
      }
    };
  }, [consoleDetails, onError, isLibraryLoading]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 p-2 rounded-lg shadow-xl w-full max-w-4xl h-[85vh] flex flex-col">
        <div className="flex justify-between items-center mb-2 text-white">
          <h3 className="text-lg font-semibold">
            Console: {consoleDetails.connectionDetails.vmName || consoleDetails.vmName || 'VM'}
          </h3>
          <button onClick={onClose} className="text-slate-300 hover:text-white">&times; Close</button>
        </div>
        <p className="text-xs text-slate-400 mb-2">Status: {connectionStatus}</p>
        {error && <p className="text-xs text-red-400 mb-2">Error: {error}</p>}
        <div className="flex-grow bg-black rounded overflow-hidden">
          {consoleDetails.type === 'proxmox' && (
            <canvas ref={rfbCanvasRef} className="w-full h-full" />
          )}
          {consoleDetails.type === 'vsphere' && (
            <div ref={wmksContainerRef} id="wmks-container" className="w-full h-full" />
          )}
        </div>
      </div>
    </div>
  );
};

export default VMConsoleView;