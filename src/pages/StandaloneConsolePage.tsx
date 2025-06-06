import React, { useEffect, useState, useCallback } from 'react';
import VMConsoleView, { type ConsoleDetailsData, type ConsoleOption } from '../components/VMConsoleView'; // Import ConsoleOption type
import { toast } from 'react-hot-toast'; // Assuming you have react-hot-toast installed

const StandaloneConsolePage: React.FC = () => {
  const [consoleDetails, setConsoleDetails] = useState<ConsoleDetailsData | null>(null);
  const [error, setError] = useState<string | null>(null);

 // Define all hooks at the top level of the component
 const handleErrorToast = useCallback((message: string) => {
    toast.error(`Console Error: ${message}`);
  }, []); // toast function from react-hot-toast is stable
  
  const handleCloseWindow = useCallback(() => {
    window.close();
  }, []);
  useEffect(() => {
    const detailsString = sessionStorage.getItem('vmConsoleDetails');
    if (detailsString) {
      try {
        const details = JSON.parse(detailsString) as ConsoleDetailsData;
        console.log("StandaloneConsolePage: Parsed data:", details); // Log parsed data

        // Validate the structure matches the new backend response
// Check if details is a plain object and has the expected properties
if (
    details &&
    typeof details === 'object' &&
    !Array.isArray(details) &&
    typeof details.vmName === 'string' &&
    Array.isArray(details.consoleOptions) &&
    details.consoleOptions.length > 0) {    // Also validate the types within the consoleOptions array
    const validConsoleTypes: ConsoleOption['type'][] = ['proxmox', 'vsphere_html5', 'vsphere_webmks', 'vsphere_mks'];
    const hasValidOptions = details.consoleOptions.every((option: any) =>
        option && typeof option === 'object' &&
        typeof option.type === 'string' &&
        validConsoleTypes.includes(option.type) &&
        typeof option.connectionDetails === 'object' // Ensure connectionDetails is an object
    );

    if (hasValidOptions) {             setConsoleDetails(details);
    } else {
        console.error("StandaloneConsolePage: Console options array contains invalid entries:", details.consoleOptions);
        setError("Invalid console options received. Please try opening the console again.");
        toast.error("Invalid console options.");
    }
} else { // Structure is fundamentally wrong
             console.error("Invalid console data structure from sessionStorage:", details);
             setError("Invalid console data structure. Please try opening the console again.");
             toast.error("Invalid console data structure.");
        }
        
      } catch (e) {
        console.error("Error parsing console details from sessionStorage:", e);
        setError("Invalid console data found. Please try opening the console again.");
        toast.error("Invalid console data.");
      }
    } else {
      setError("No console details found. This page should be opened from the VM details screen.");
      toast.error("Console details not available.");
    }
  }, []);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-100 dark:bg-slate-900 p-4">
        <div className="bg-white dark:bg-slate-800 p-8 rounded-lg shadow-xl text-center">
          <h1 className="text-2xl font-bold text-danger-600 dark:text-danger-400 mb-4">Console Error</h1>
          <p className="text-slate-700 dark:text-slate-300 mb-6">{error}</p>
          <button
            onClick={() => window.close()}
            className="btn btn-primary"
          >
            Close Window
          </button>
        </div>
      </div>
    );
  }

  if (!consoleDetails) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-100 dark:bg-slate-900">
        {/* Puedes agregar un spinner aquí si lo deseas */}
        <p className="text-slate-700 dark:text-slate-300 text-lg">Loading console...</p>
      </div>
    );
  }

  return (
    <VMConsoleView
      consoleDetails={consoleDetails} // Pass the entire object with vmName and consoleOptions
      onClose={handleCloseWindow}
      onError={handleErrorToast}

    />
  );
};

export default StandaloneConsolePage;