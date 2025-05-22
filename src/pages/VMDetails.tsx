import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { motion } from 'framer-motion';
import RFB from '@novnc/novnc/core/rfb'; // Import RFB

export interface ConsoleDetailsData {
  type: 'proxmox' | 'vsphere' | 'proxmox-ws-proxy'; // Added new type for proxied connection
  connectionDetails: {
    // For direct Proxmox connection (old way, can be kept for fallback)
    host?: string;
    port?: number;
    // For proxmox-ws-proxy (new way)
    proxyWsUrl?: string;      // e.g., wss://backend.example.com/ws/vnc/proxmox/hypervisorId/nodeId/vmId
    ticket?: string;        // VNC password (ticket) for RFB to send
    // Common details
    vmid?: string; // Still useful for display or context
    node?: string; // Still useful for display or context
    vmName: string;
    // For vSphere MKS (future)
    sslThumbprint?: string;
    path?: string; // Generally not needed for Proxmox vncproxy or our ws proxy
  };
}

interface VMConsoleViewProps {
  consoleDetails: ConsoleDetailsData;
  onClose: () => void;
  onError: (message: string) => void; // For general errors or setup issues
}

export default function VMConsoleView({ consoleDetails, onClose, onError }: VMConsoleViewProps) {
  const screenRef = useRef<HTMLDivElement>(null);
  const rfbInstanceRef = useRef<RFB | null>(null);
  const [vncStatus, setVncStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [vncError, setVncError] = useState<string | null>(null);

  useEffect(() => {
    if (!consoleDetails || !screenRef.current) {
      return;
    }

    // Cleanup previous instance if any
    if (rfbInstanceRef.current) {
      rfbInstanceRef.current.disconnect();
      rfbInstanceRef.current = null;
    }
    setVncError(null); // Clear previous errors

    if (consoleDetails.type === 'proxmox-ws-proxy') {
      const { proxyWsUrl, ticket } = consoleDetails.connectionDetails;
      if (!proxyWsUrl || ticket === undefined) {
        onError("Detalles de conexión Proxmox (proxy) incompletos.");
        setVncStatus('error');
        setVncError("Detalles de conexión Proxmox (proxy) incompletos.");
        return;
      }

      console.log(`[RFB] Conectando al proxy: ${proxyWsUrl}`);
      const rfb = new RFB(screenRef.current, proxyWsUrl, {
        credentials: { password: ticket }, // 'ticket' es la contraseña para VNC
        shared: true, // Recomendado para mejor rendimiento con proxies
      });
      rfbInstanceRef.current = rfb;

      rfb.addEventListener("connect", () => {
        setVncStatus('connected');
        setVncError(null);
        console.log("VNC Conectado vía Proxy");
      });

      rfb.addEventListener("disconnect", (event: any) => {
        setVncStatus('disconnected');
        const reason = event.detail?.reason || "Desconexión inesperada del proxy.";
        console.log("VNC Desconectado del Proxy:", reason, event.detail);
        if (!event.detail?.clean) {
          setVncError(`VNC Desconectado: ${reason}`);
        }
      });

      rfb.addEventListener("securityfailure", (event: any) => {
        setVncStatus('error');
        const reason = event.detail?.reason || "Fallo de seguridad VNC vía proxy.";
        setVncError(`Error de seguridad VNC: ${reason}`);
        onError(`Error de seguridad VNC: ${reason}`);
        console.error("Fallo de seguridad VNC (Proxy):", event.detail);
      });
      
      rfb.addEventListener("networkerror", (event: any) => {
        setVncStatus('error');
        const reason = event.detail?.reason || "Error de red VNC.";
        setVncError(`Error de red VNC: ${reason}`);
        onError(`Error de red VNC: ${reason}`);
        console.error("Error de red VNC (Proxy):", event.detail);
      });


      setVncStatus('connecting');

    } else if (consoleDetails.type === 'proxmox') { // Fallback to direct connection (old way)
      console.warn("[RFB] Usando conexión VNC directa a Proxmox (modo antiguo/fallback)");
      const { host, port, ticket } = consoleDetails.connectionDetails;
      if (!host || !port || ticket === undefined) {
        onError("Detalles de conexión Proxmox (directa) incompletos.");
        setVncStatus('error');
        setVncError("Detalles de conexión Proxmox (directa) incompletos.");
        return;
      }
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const rfb = new RFB(screenRef.current, `${protocol}://${host}:${port}`, {
        credentials: { password: ticket },
      });
      rfbInstanceRef.current = rfb;

      rfb.addEventListener("connect", () => {
        setVncStatus('connected');
        setVncError(null);
        console.log("VNC Conectado (Directo)");
      });
      rfb.addEventListener("disconnect", (event: any) => {
        setVncStatus('disconnected');
        const reason = event.detail?.reason || "Desconexión inesperada (directa).";
        console.log("VNC Desconectado (Directo):", reason);
        if (!event.detail?.clean) {
          setVncError(`VNC Desconectado: ${reason}`);
        }
      });
      rfb.addEventListener("securityfailure", (event: any) => {
        setVncStatus('error');
        const reason = event.detail?.reason || "Fallo de seguridad VNC (directo).";
        setVncError(`Error de seguridad VNC: ${reason}`);
        onError(`Error de seguridad VNC: ${reason}`);
        console.error("Fallo de seguridad VNC (Directo):", event.detail);
      });
      rfb.addEventListener("networkerror", (event: any) => {
        setVncStatus('error');
        const reason = event.detail?.reason || "Error de red VNC (directo).";
        setVncError(`Error de red VNC: ${reason}`);
        onError(`Error de red VNC: ${reason}`);
        console.error("Error de red VNC (Directo):", event.detail);
      });

      setVncStatus('connecting');

    } else if (consoleDetails.type === 'vsphere') {
      setVncStatus('disconnected');
      setVncError("La consola vSphere (WebMKS) aún no está implementada.");
      onError("La consola vSphere (WebMKS) aún no está implementada.");
    }

    return () => { // Cleanup function
      if (rfbInstanceRef.current) {
        rfbInstanceRef.current.disconnect();
        rfbInstanceRef.current = null;
        console.log("VNC Desconectado al limpiar el componente");
      }
    };
  }, [consoleDetails, onError]); // Dependencies for useEffect

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-[100]">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className="bg-slate-900 rounded-lg shadow-2xl w-full h-full max-w-4xl max-h-[80vh] flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between p-3 bg-slate-800 border-b border-slate-700">
          <h3 className="text-lg font-medium text-white">
            Consola: {consoleDetails.connectionDetails.vmName}
            <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
              vncStatus === 'connected' ? 'bg-success-500 text-white' :
              vncStatus === 'connecting' ? 'bg-blue-500 text-white' :
              vncStatus === 'disconnected' ? 'bg-slate-600 text-slate-200' :
              'bg-danger-500 text-white'
            }`}>
              {vncStatus.charAt(0).toUpperCase() + vncStatus.slice(1)}
            </span>
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
            aria-label="Cerrar consola"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
        {/* VNC screen div. noVNC will attach its canvas here. */}
        <div className="flex-grow bg-black relative cursor-none" ref={screenRef}>
          {/* Overlay status messages */}
          {vncStatus === 'connecting' && (
            <div className="absolute inset-0 flex items-center justify-center text-white bg-black/50">
              Conectando a la consola...
            </div>
          )}
          {vncError && (
            <div className="absolute inset-0 flex items-center justify-center text-red-400 bg-black/80 p-4 text-center">
              {vncError}
            </div>
          )}
          {(vncStatus === 'disconnected' && !vncError && (consoleDetails.type === 'proxmox' || consoleDetails.type === 'proxmox-ws-proxy')) && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-400 bg-black/50">
              Consola desconectada.
            </div>
          )}
        </div>
        {/* Optional: Status bar or additional controls can go here */}
      </motion.div>
    </div>
  );
}
