import React, { useEffect, useRef, useState } from 'react';
import RFB from '@novnc/novnc/lib/rfb.js'; // For Proxmox VNC - Static Import

// Declare WMKS if it's loaded globally via script tag
declare global {
  interface Window {
    WMKS?: any; // VMware WebMKS library
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
export type ConsoleDetailsData = {
  type: 'proxmox' | 'vsphere';
  connectionDetails: ProxmoxConnectionDetails | VSphereConnectionDetails;
  vmName?: string;
};

export interface VSphereConnectionDetails {
  host: string;
  port: number;
  ticket: string; // WebMKS ticket
  sslThumbprint: string;
  vmName?: string;
}

interface VMConsoleViewProps {
  consoleDetails: ConsoleDetailsData; // Asegúrate de que esta línea esté presente

  onClose: () => void;
  onError?: (message: string) => void;
}

const VMConsoleView: React.FC<VMConsoleViewProps> = ({ consoleDetails, onClose, onError }) => {
  const rfbCanvasRef = useRef<HTMLCanvasElement>(null);
  const wmksContainerRef = useRef<HTMLDivElement>(null);
  const [connectionStatus, setConnectionStatus] = useState('Initializing...');
  const [error, setError] = useState<string | null>(null);

  const rfbInstance = useRef<RFB | null>(null);
  const wmksInstance = useRef<any>(null); // WMKS type is 'any' as official types are not standard

  useEffect(() => {
    let isMounted = true;
    setError(null);
    setConnectionStatus('Connecting...');

    const { type, connectionDetails: rawConnectionDetails } = consoleDetails;
    // Ensure vmName is derived correctly, prioritizing from connectionDetails if present
    const vmName = rawConnectionDetails.vmName || consoleDetails.vmName || 'VM';


    if (type === 'proxmox') {
      const connectionDetails = rawConnectionDetails as ProxmoxConnectionDetails;
      if (rfbCanvasRef.current) {
        const { host, port, ticket, node, vmid } = connectionDetails;
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const rfbUrl = `${protocol}://${host}:${port}`;

        console.log(`Proxmox VNC: Connecting to ${rfbUrl} for VM ${vmid} on node ${node}`);

        try {
          rfbInstance.current = new RFB(rfbCanvasRef.current, rfbUrl, {
            credentials: { password: ticket }, // 'ticket' is the VNC password for Proxmox
          });

          rfbInstance.current.addEventListener('connect', () => {
            if (!isMounted) return;
            setConnectionStatus(`Connected to ${vmName} (Proxmox)`);
            console.log('Proxmox VNC: Connected');
          });

          // Use specific event types from novnc__novnc.d.ts
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

        } catch (e: any) {
          if (!isMounted) return;
          console.error('Proxmox VNC: RFB instantiation error', e);
          setError(`Failed to initialize VNC client: ${e.message}`);
          if (onError) onError(`Failed to initialize VNC client: ${e.message}`);
          setConnectionStatus('Error initializing VNC');
        }
      }
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
            .register(window.WMKS.Events.CONNECTION_STATE_CHANGE, (event: any, data: any) => {
              if (!isMounted) return;
              if (data.state === window.WMKS.ConnectionState.CONNECTED) {
                setConnectionStatus(`Connected to ${vmName} (vSphere)`);
                console.log('vSphere WebMKS: Connected');
              } else if (data.state === window.WMKS.ConnectionState.DISCONNECTED) {
                setConnectionStatus(`Disconnected from ${vmName} (vSphere).`);
                console.log('vSphere WebMKS: Disconnected', data.error);
                if (data.error) {
                  setError(`WebMKS disconnected: ${data.error.message || 'Unknown reason'}`);
                  if (onError) onError(`WebMKS disconnected: ${data.error.message || 'Unknown reason'}`);
                }
              }
            })
            .register(window.WMKS.Events.ERROR, (event: any, data: any) => {
              if (!isMounted) return;
              setConnectionStatus(`Error with ${vmName} (vSphere)`);
              console.error('vSphere WebMKS: Error', data);
              setError(`WebMKS Error: ${data.errorType || 'Unknown error'}`);
              if (onError) onError(`WebMKS Error: ${data.errorType || 'Unknown error'}`);
            });

          wmksInstance.current.connect(`wss://${host}:${port}/ticket/${ticket}`, {
            useSSL: true,
            sslThumbprint: sslThumbprint,
          });
        } catch (e: any) {
          if (!isMounted) return;
          console.error('vSphere WebMKS: WMKS instantiation or connection error', e);
          setError(`Failed to initialize WebMKS client: ${e.message}`);
          if (onError) onError(`Failed to initialize WebMKS client: ${e.message}`);
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
        rfbInstance.current.disconnect();
        rfbInstance.current = null;
      }
      if (wmksInstance.current) {
        console.log('Cleaning up vSphere WebMKS connection');
        wmksInstance.current.destroy();
        wmksInstance.current = null;
      }
    };
  }, [consoleDetails, onError]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 p-2 rounded-lg shadow-xl w-full max-w-4xl h-[85vh] flex flex-col">
        <div className="flex justify-between items-center mb-2 text-white">
          {/* Display vmName from consoleDetails.connectionDetails or fallback */}
          <h3 className="text-lg font-semibold">Console: {consoleDetails.connectionDetails.vmName || consoleDetails.vmName || 'VM'}</h3>
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
