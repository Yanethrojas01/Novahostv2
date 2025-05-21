import React, { useEffect, useRef, useState } from 'react';
import RFB from '@novnc/novnc'; // Importar RFB desde el paquete npm

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

// Type for noVNC event listeners.
// The actual event objects are often CustomEvents with specific 'detail' payloads.
type RFBEventListener = (e: CustomEvent<any>) => void;

declare global {
  interface Window {
    WMKS?: WMKSStatic; // VMware WebMKS library
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

const VMConsoleView: React.FC<VMConsoleViewProps> = ({ consoleDetails, onClose, onError }) => {
  const rfbCanvasRef = useRef<HTMLCanvasElement>(null);
  const wmksContainerRef = useRef<HTMLDivElement>(null);
  const [connectionStatus, setConnectionStatus] = useState('Initializing...');
  const [error, setError] = useState<string | null>(null);

  // rfbInstance.current will be an instance of the imported RFB class
  const rfbInstance = useRef<InstanceType<typeof RFB> | null>(null);
  const wmksInstance = useRef<WMKSInstance | null>(null);

  // Destructure consoleDetails for stable dependencies
  const { type: consoleType, connectionDetails: consoleConnectionDetails, vmName: consoleVmNameProp } = consoleDetails;
  // Generate a unique ID for the WMKS container if needed, once per component instance.
  const [uniqueWmksId] = useState(() => `wmks-container-${Math.random().toString(36).substring(2, 9)}`);

  // Create a stable key from connectionDetails to use as a dependency
  const connectionDetailsKey = JSON.stringify(consoleConnectionDetails);

  useEffect(() => {
    let isMounted = true;
    setError(null);
    setConnectionStatus('Connecting...');

    const vmName = consoleConnectionDetails.vmName || consoleVmNameProp || 'VM';

    async function initProxmoxRFB() {
      if (!rfbCanvasRef.current) {
        setError('RFB canvas element not found.');
        setConnectionStatus('Error: Canvas missing');
        if (onError) onError('RFB canvas element not found.');
        return;
      }
      
      const connectionDetails = consoleConnectionDetails as ProxmoxConnectionDetails;
      const { host, port, ticket, node, vmid } = connectionDetails;
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const rfbUrl = `${protocol}://${host}:${port}`;

      console.log(`Proxmox VNC: Connecting to ${rfbUrl} for VM ${vmid} on node ${node}`);
      setConnectionStatus('Connecting to VNC...');

      try {
        if (!RFB) { // RFB should be available from import
          throw new Error("RFB module not available. Check import.");
        }
        rfbInstance.current = new RFB(rfbCanvasRef.current, rfbUrl, {
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
        console.error('Proxmox VNC: RFB instantiation or event setup error', e);
        const message = e instanceof Error ? e.message : String(e);
        setError(`Failed to initialize VNC client: ${message}`);
        if (onError) onError(`Failed to initialize VNC client: ${message}`);
        setConnectionStatus('Error initializing VNC');
      }
    }

    if (consoleType === 'proxmox') {
      initProxmoxRFB();
    } else if (consoleType === 'vsphere') {
      const connectionDetails = consoleConnectionDetails as VSphereConnectionDetails;
      if (wmksContainerRef.current && window.WMKS) {
        const { host, port, ticket, sslThumbprint } = connectionDetails;
        console.log(`vSphere WebMKS: Connecting to ${host}:${port} for VM ${vmName}`);

        try {
          // Ensure the container has the unique ID before creating WMKS instance
          if (wmksContainerRef.current) wmksContainerRef.current.id = uniqueWmksId;

          wmksInstance.current = window.WMKS.createWMKS(uniqueWmksId, {})
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
          // These errors are often symptomatic of rapid useEffect re-runs or noVNC internal state issues.
          // Logging them is important, but the primary fix is stabilizing the effect's execution.
          console.warn('Error during RFB disconnect cleanup (may indicate noVNC internal state issue or rapid re-render):', cleanupError);
        }
        rfbInstance.current = null;
      }
      if (wmksInstance.current) {
        console.log('Cleaning up vSphere WebMKS connection');
        wmksInstance.current.destroy();
        wmksInstance.current = null;
      }
    };
  }, [consoleType, connectionDetailsKey, consoleVmNameProp, onError]); // Use stable dependencies

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
            <div ref={wmksContainerRef} id={uniqueWmksId} className="w-full h-full" />
          )}
        </div>
      </div>
    </div>
  );
};

export default VMConsoleView;