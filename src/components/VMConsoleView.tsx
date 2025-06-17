import React, { useEffect, useState } from 'react';

// Define types here as they are imported from this file by StandaloneConsolePage.tsx
// and potentially VMDetails.tsx.

export interface ProxmoxConnectionDetails {
  host: string;
  port: number | string;
  node: string;
  vmid: number | string;
  ticket: string;
  // ssl?: boolean; // Optional: to determine http vs https, though Proxmox typically uses https
}

export interface VSphereHtml5ConnectionDetails {
  url: string; // Typically a full URL for the HTML5 console
}

export interface VSphereWebMKSConnectionDetails {
  host: string;
  port?: number; // Port might be implicit in host or ticket for some SDKs
  ticket: string;
  thumbprint?: string; // SSL thumbprint
  vmId?: string; // VM MoRef ID or similar identifier
  // Add other fields required by the WMKS library
}

// Add other specific connection detail types as needed (e.g., for MKS)

export type ConsoleType = 'proxmox' | 'vsphere_html5' | 'vsphere_webmks' | 'vsphere_mks' | string; // Allow string for future/custom types

export interface ConsoleOption {
  type: ConsoleType;
  name?: string; // e.g., "noVNC (Proxmox)", "HTML5 Console (vSphere)"
  connectionDetails:
    | ProxmoxConnectionDetails
    | VSphereHtml5ConnectionDetails
    | VSphereWebMKSConnectionDetails
    | Record<string, any>; // Fallback for other/unknown structures
  vmName?: string; // Optional: if the option itself carries a specific VM name
}

export interface ConsoleDetailsData {
  vmName: string;
  consoleOptions: ConsoleOption[];
}

interface VMConsoleViewProps {
  consoleDetails: ConsoleDetailsData;
  onClose: () => void;
  onError: (message: string) => void;
}

const VMConsoleView: React.FC<VMConsoleViewProps> = ({ consoleDetails, onClose, onError }) => {
  const [selectedOption, setSelectedOption] = useState<ConsoleOption | null>(null);
  const [consoleUrl, setConsoleUrl] = useState<string | null>(null);

  useEffect(() => {
    if (consoleDetails && consoleDetails.consoleOptions && consoleDetails.consoleOptions.length > 0) {
      // Prioritize Proxmox, then vSphere HTML5, then first available.
      let optionToUse = consoleDetails.consoleOptions.find(opt => opt.type === 'proxmox');

      if (!optionToUse) {
        optionToUse = consoleDetails.consoleOptions.find(opt => opt.type === 'vsphere_html5' && (opt.connectionDetails as VSphereHtml5ConnectionDetails)?.url);
      }
      if (!optionToUse && consoleDetails.consoleOptions.length > 0) {
        // Fallback to the first option if no preferred type is found yet
        // This part might need more sophisticated logic if the first option isn't directly usable
        // optionToUse = consoleDetails.consoleOptions[0];
      }

      if (optionToUse) {
        setSelectedOption(optionToUse);
        try {
          if (optionToUse.type === 'proxmox') {
            const details = optionToUse.connectionDetails as ProxmoxConnectionDetails;
            // Log the ticket for debugging to see what value is being received
            console.log("VMConsoleView: Proxmox ticket received by frontend:", details.ticket);
            if (!details.host || !details.port || !details.node || !details.vmid || !details.ticket || typeof details.ticket !== 'string' || details.ticket.trim() === '') {
              const errorMessage = `Incomplete or invalid Proxmox connection details. Host: ${details.host}, Port: ${details.port}, Node: ${details.node}, VMID: ${details.vmid}, Ticket: '${details.ticket}' (Type: ${typeof details.ticket})`;
              onError(errorMessage);
              throw new Error(errorMessage);
            }

            const protocol = (Number(details.port) === 443 || Number(details.port) === 8006 || String(details.port).includes('443') || String(details.port).includes('8006')) ? 'https' : 'http';
            const encodedTicket = encodeURIComponent(details.ticket);
            // URL estándar de noVNC para Proxmox. El manejador noVNC del servidor Proxmox utiliza el ticket, node y vmid
            // para establecer internamente la conexión WebSocket al puerto vncproxy correcto.
            const url = `${protocol}://${details.host}:${details.port}/?console=kvm&novnc=1&vmid=${details.vmid}&node=${details.node}&ticket=${encodedTicket}&resize=scale`;
            setConsoleUrl(url);
          } else if (optionToUse.type === 'vsphere_html5') {
            const details = optionToUse.connectionDetails as VSphereHtml5ConnectionDetails;
            if (!details.url) {
              throw new Error("vSphere HTML5 console URL is missing.");
            }
            setConsoleUrl(details.url);
          } else {
            // Handle other types or prepare for them
            onError(`Console type '${optionToUse.type}' is recognized but not yet fully renderable in this view.`);
            setConsoleUrl(null); // No direct URL for these yet
          }
        } catch (e: any) {
          onError(`Error processing console details for type '${optionToUse.type}': ${e.message}`);
          setConsoleUrl(null);
        }
      } else {
        onError(`No supported console option found. Available types: ${consoleDetails.consoleOptions.map(o => o.type).join(', ')}`);
        setConsoleUrl(null);
      }
    } else {
      onError("No console options available in consoleDetails.");
      setConsoleUrl(null);
    }
  }, [consoleDetails, onError]);

  const renderConsoleContent = () => {
    if (!selectedOption) {
      return <div className="p-4 text-center">Loading console or no option selected...</div>;
    }
    if (!consoleUrl && (selectedOption.type === 'proxmox' || selectedOption.type === 'vsphere_html5')) {
        return <div className="p-4 text-center">Preparing console URL... If this persists, an error might have occurred.</div>;
    }

    if ((selectedOption.type === 'proxmox' || selectedOption.type === 'vsphere_html5') && consoleUrl) {
      return (
        <iframe
          src={consoleUrl}
          title={`${consoleDetails.vmName} Console (${selectedOption.name || selectedOption.type})`}
          className="w-full h-full border-0"
          allowFullScreen
        />
      );
    }
    // Placeholder for other console types like WebMKS which require SDKs
    return <div className="p-4 text-center">Console type '{selectedOption.type}' is not yet renderable with a direct URL. Further implementation needed.</div>;
  };

  return (
    <div className="flex flex-col w-screen h-screen bg-slate-900 text-white">
      <header className="bg-slate-800 p-3 flex justify-between items-center shadow-md flex-shrink-0">
        <h1 className="text-lg font-semibold truncate pr-2" title={consoleDetails.vmName}>
          Console: {consoleDetails.vmName}
          {selectedOption && <span className="text-sm text-slate-400 ml-2">({selectedOption.name || selectedOption.type})</span>}
        </h1>
        <button
          onClick={onClose}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-md transition-colors"
          title="Close Console Window"
        >
          Close
        </button>
      </header>
      <main className="flex-grow overflow-hidden bg-black">
        {renderConsoleContent()}
      </main>
    </div>
  );
};

export default VMConsoleView;
