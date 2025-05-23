import { Hypervisor, HypervisorCredentials } from '../types/hypervisor';
import axios from 'axios';
const createProxmoxClient = (hypervisor: Hypervisor) => {
  const baseURL = `https://${hypervisor.host}:${hypervisor.port}/api2/json`;
  
  const client = axios.create({
    baseURL,
    headers: {
      'Content-Type': 'application/json',
    },
    withCredentials: true,
  });

  // Add request interceptor for authentication
  client.interceptors.request.use(async (config) => {
    try {
      // Get authentication ticket
      const authResponse = await axios.post(`${baseURL}/access/ticket`, {
        username: hypervisor.username,
        password: HypervisorCredentials.password,
      });

      const { ticket, CSRFPreventionToken } = authResponse.data.data;
      
      config.headers['Cookie'] = `PVEAuthCookie=${ticket}`;
      config.headers['CSRFPreventionToken'] = CSRFPreventionToken;
      
      return config;
    } catch (error) {
      console.error('Authentication failed:', error);
      throw error;
    }
  });

  return client;
};

export const getVMConsole = async (
  hypervisor: Hypervisor,
  vmId: string
): Promise<string> => {
  const client = createProxmoxClient(hypervisor);
  
  try {
    const response = await client.post(`/nodes/${hypervisor.node}/qemu/${vmId}/vncproxy`);
    const { port, ticket } = response.data.data;
    
    return `wss://${hypervisor.host}:${port}/api2/json/vncproxy?ticket=${ticket}`;
  } catch (error) {
    console.error('Failed to get VM console:', error);
    throw error;
  }
};