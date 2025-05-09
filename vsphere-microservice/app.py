from flask import Flask, request, jsonify
from pyVim.connect import SmartConnect, Disconnect
from pyVmomi import vim
import ssl
import atexit

app = Flask(__name__)

def connect_vsphere(host, user, password, port=443):
    context = ssl._create_unverified_context()
    si = SmartConnect(host=host, user=user, pwd=password, port=port, sslContext=context)
    # atexit.register(Disconnect, si) # Remove this - manage connection per request
    return si

def disconnect_vsphere(si):
    Disconnect(si)

@app.route('/vms', methods=['GET'])
def list_vms():
    host = request.args.get('host')
    user = request.args.get('user')
    password = request.args.get('password')
    port = int(request.args.get('port', 443))

    if not host or not user or not password:
        app.logger.error("Listing VMs: Missing connection parameters")
        return jsonify({'error': 'Missing connection parameters'}), 400

    si = None
    try:
        si = connect_vsphere(host, user, password, port)
        content = si.RetrieveContent()
        app.logger.info(f"Listing VMs: Successfully connected to vSphere: {host}")
        
        container = content.rootFolder
        viewType = [vim.VirtualMachine]
        recursive = True
        containerView = content.viewManager.CreateContainerView(container, viewType, recursive)
        vms_objects = containerView.view
        app.logger.info(f"Listing VMs: Found {len(vms_objects)} total VM objects in view.")
        
        vm_list = []
        for vm_obj in vms_objects:
            summary = vm_obj.summary
            config = vm_obj.config # Necesario para algunos detalles de hardware y anotaciones
            guest = vm_obj.guest   # Necesario para hostname, toolsStatus, IP

            # Calcular el tamaño total del disco para la VM
            total_disk_gb = 0
            if hasattr(config, 'hardware') and config.hardware and hasattr(config.hardware, 'device'):
                for dev in config.hardware.device:
                    if isinstance(dev, vim.vm.device.VirtualDisk):
                        total_disk_gb += dev.capacityInKB
            # Convertir de KB a GB, redondear a 2 decimales si es mayor que 0
            total_disk_gb = round(total_disk_gb / (1024 * 1024), 2) if total_disk_gb > 0 else 0
            
            app.logger.debug(f"Processing VM for list: Name='{summary.config.name}', UUID='{summary.config.uuid}'")
            
            vm_info = {
                'name': summary.config.name,
                'power_state': summary.runtime.powerState,
                'guest_os': summary.config.guestFullName,
                'ip_address': guest.ipAddress if guest else None,
                'uuid': summary.config.uuid,
                'cpu_count': summary.config.numCpu,
                'memory_mb': summary.config.memorySizeMB,
                'disk_gb': total_disk_gb,
                'hostname': guest.hostName if guest else None,
                'vmware_tools_status': guest.toolsStatus if guest else 'toolsNotInstalled',
                # Opcional: si quieres una lista de todas las IPs
                # 'ip_addresses': [nic.ipAddress for nic in guest.net if hasattr(guest, 'net') and guest.net and nic.ipAddress] if guest else []
            }
            vm_list.append(vm_info)
            
        containerView.Destroy() # Importante para liberar recursos
        app.logger.info(f"Listing VMs: Successfully prepared list of {len(vm_list)} VMs.")
        return jsonify(vm_list)
        
    except vim.fault.InvalidLogin:
        app.logger.error(f"Listing VMs: vSphere login failed for user {user} on host {host}")
        return jsonify({'error': 'vSphere login failed. Check credentials.'}), 401
    except Exception as e:
        app.logger.error(f"Listing VMs: Error for host {host}: {str(e)}", exc_info=True)
        return jsonify({'error': f'An error occurred in Python service while listing VMs: {str(e)}'}), 500
    finally:
        if si:
            disconnect_vsphere(si)


@app.route('/vm/<vm_uuid>/power', methods=['POST'])
def power_vm(vm_uuid):
    host = request.json.get('host')
    user = request.json.get('user')
    password = request.json.get('password')
    action = request.json.get('action')  # 'on' or 'off'

    if not host or not user or not password or not action:
        return jsonify({'error': 'Missing parameters'}), 400

    try:
        # Note: For a long-running app, consider if si should be disconnected in a finally block here too
        si = connect_vsphere(host, user, password)
        content = si.RetrieveContent()
        vm = None
        container = content.rootFolder
        viewType = [vim.VirtualMachine]
        recursive = True
        containerView = content.viewManager.CreateContainerView(container, viewType, recursive)
        for v in containerView.view:
            if v.config.uuid == vm_uuid:
                vm = v
                break
        if not vm:
            return jsonify({'error': 'VM not found'}), 404

        if action == 'on':
            task = vm.PowerOnVM_Task()
        elif action == 'off':
            task = vm.PowerOffVM_Task()
        else:
            return jsonify({'error': 'Invalid action'}), 400

        # Wait for task to complete
        while task.info.state not in [vim.TaskInfo.State.success, vim.TaskInfo.State.error]:
            pass

        if task.info.state == vim.TaskInfo.State.success:
            return jsonify({'status': 'success'})
        else:
            return jsonify({'error': task.info.error.msg}), 500

    except Exception as e:
        return jsonify({'error': str(e)}), 500
    # finally:
    #     if si:
    #         disconnect_vsphere(si) # Add if you want to ensure disconnection for this route

# --- Helper para determinar si es vCenter o ESXi ---
def get_vsphere_subtype(si_content):
    if si_content.about.apiType == "VirtualCenter":
        return "vcenter"
    return "esxi"

@app.route('/connect', methods=['POST'])
def test_connection():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Request body must be JSON'}), 400

    host = data.get('host')
    user = data.get('user')
    password = data.get('password')
    # El puerto puede venir en el host (e.g., "host:port") o como parámetro separado.
    # callPyvmomiService en index.js envía el host sin puerto y espera que el microservicio maneje el puerto.
    # Por ahora, asumimos que el puerto es 443 si no se especifica en el host.
    # Si el host incluye un puerto, connect_vsphere debería manejarlo.
    # Para ser explícito, podríamos añadir un parámetro de puerto opcional.
    port = int(data.get('port', 443))

    app.logger.info(f"Connect attempt to vSphere: host={host}, user={user}, port={port}")

    if not all([host, user, password]):
        return jsonify({'error': 'Missing host, user, or password in request body'}), 400

    si = None
    try:
        si = connect_vsphere(host, user, password, port) # Asegúrate que connect_vsphere acepte y use el puerto
        content = si.RetrieveContent()
        subtype = get_vsphere_subtype(content)
        api_version = content.about.apiVersion
        app.logger.info(f"Successfully connected to {host}. Type: {subtype}, API Version: {api_version}")
        return jsonify({'status': 'success', 'message': 'Connection successful', 'vsphere_subtype': subtype, 'api_version': api_version}), 200
    except vim.fault.InvalidLogin:
        return jsonify({'error': 'Invalid vSphere credentials'}), 401
    except Exception as e:
        app.logger.error(f"Connection to {host} failed: {str(e)}", exc_info=True)
        return jsonify({'error': f'Connection failed: {str(e)}'}), 500
    finally:
        if si:
            disconnect_vsphere(si)


@app.route('/vm/<vm_uuid>/details', methods=['GET'])
def vm_details(vm_uuid): # El parámetro de la función ahora coincide con la variable de la ruta
    host = request.args.get('host')
    user = request.args.get('user')
    password = request.args.get('password')
    port = int(request.args.get('port', 443)) # Añadir port para consistencia
    
    original_vm_uuid_param = vm_uuid # Guardar el original para el log si quieres
    vm_uuid = vm_uuid.strip() # Strip whitespace del parámetro vm_uuid recibido
    app.logger.info(f"Details: Received raw UUID param: '{original_vm_uuid_param}', Stripped UUID for search: '{vm_uuid}'")

    if not host or not user or not password:
        return jsonify({'error': 'Missing connection parameters'}), 400

    si = None # Definir si fuera del try para el finally
    try:
        si = connect_vsphere(host, user, password, port) # Usar port
        content = si.RetrieveContent()
        
        app.logger.info(f"Details: Attempting to find VM by iterating. Target UUID: {vm_uuid}")
        vm = None
        container = content.rootFolder
        viewType = [vim.VirtualMachine]
        recursive = True
        containerView = content.viewManager.CreateContainerView(container, viewType, recursive)
        
        for v_obj in containerView.view:
            if hasattr(v_obj, 'config') and v_obj.config is not None and v_obj.config.uuid == vm_uuid:
                vm = v_obj
                app.logger.info(f"Details: VM with UUID {vm_uuid} found by iteration: {vm.name}")
                break
        containerView.Destroy() # No olvides destruir la vista
            
        if not vm:
            app.logger.error(f"Details: VM with UUID {vm_uuid} not found after iteration.")
            return jsonify({'error': f'VM with UUID {vm_uuid} not found in vSphere'}), 404
            
        # app.logger.info(f"Details: VM with UUID {vm_uuid} found: {vm.name}") # Ya se loguea arriba si se encuentra

        summary = vm.summary
        config = vm.config
        runtime = vm.runtime
        guest = vm.guest

        vm_info = {
            'name': summary.config.name,
            'power_state': summary.runtime.powerState,
            'guest_os': summary.config.guestFullName,
            'ip_address': summary.guest.ipAddress,
            'uuid': summary.config.uuid,
            'cpu_count': summary.config.numCpu,
            'memory_mb': summary.config.memorySizeMB,
            'disk_gb': sum([dev.capacityInKB for dev in vm.config.hardware.device if isinstance(dev, vim.vm.device.VirtualDisk)]) / 1024 / 1024,
            'host_name': runtime.host.name if runtime.host else None,
            'vmware_tools_status': guest.toolsStatus if guest else 'toolsNotInstalled',
            'annotation': config.annotation if config.annotation else '',
            'moid': vm._moId,
            'hostname': guest.hostName if guest else None,
            'boot_time': runtime.bootTime.isoformat() if runtime.bootTime else None,
        }
        return jsonify(vm_info)
    except Exception as e:
        app.logger.error(f"Details: Error for VM {vm_uuid}: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500
    finally:
        if si:
            disconnect_vsphere(si)


@app.route('/vm/<string:vm_uuid>/metrics', methods=['GET'])
def vm_metrics_route(vm_uuid): # El parámetro de la función ahora coincide con la variable de la ruta
    host = request.args.get('host')
    user = request.args.get('user')
    password = request.args.get('password')
    port = int(request.args.get('port', 443))
    
    original_vm_uuid_param = vm_uuid # Guardar el original para el log
    vm_uuid = vm_uuid.strip() # Aplicar strip al parámetro vm_uuid recibido
    app.logger.info(f"Metrics: Received raw UUID param: '{original_vm_uuid_param}', Stripped UUID for search: '{vm_uuid}' on host: {host}")

    if not all([host, user, password]):
        app.logger.error("Metrics: Missing connection parameters")
        return jsonify({'error': 'Missing connection parameters'}), 400

    si = None
    try:
        si = connect_vsphere(host, user, password, port)
        content = si.RetrieveContent()
        app.logger.info(f"Metrics: Successfully connected to vSphere: {host}")

        app.logger.info(f"Metrics: Attempting to find VM by iterating. Target UUID: {vm_uuid}")
        vm = None
        container = content.rootFolder
        viewType = [vim.VirtualMachine]
        recursive = True
        containerView = content.viewManager.CreateContainerView(container, viewType, recursive)
        
        for v_obj in containerView.view:
            if hasattr(v_obj, 'config') and v_obj.config is not None and v_obj.config.uuid == vm_uuid:
                vm = v_obj
                app.logger.info(f"Metrics: VM with UUID {vm_uuid} found by iteration: {vm.name}")
                break
        containerView.Destroy() # No olvides destruir la vista
        
        if not vm:
            app.logger.error(f"Metrics: VM with UUID {vm_uuid} not found after iteration.")
            return jsonify({'error': f'VM with UUID {vm_uuid} not found in vSphere for metrics'}), 404

        summary = vm.summary
        quick_stats = summary.quickStats
        config = vm.config # Necesario para numCPU y memoryMB

        # Calcula CPU usage percentage: (overallCpuUsageMHz / (numCPU * cpuSpeedMHz)) * 100
        # cpuSpeedMHz no está fácilmente en quickStats, así que es una aproximación.
        # O, si overallCpuUsage es un porcentaje de la capacidad total del host, es diferente.
        # Para una VM, overallCpuUsage es el consumo en MHz.
        # Si un core tiene, por ejemplo, 2000 MHz, y la VM tiene 2 cores, su capacidad es 4000 MHz.
        # El porcentaje sería (quick_stats.overallCpuUsage / (config.hardware.numCPU * HOST_CPU_SPEED_MHZ)) * 100
        # HOST_CPU_SPEED_MHZ es difícil de obtener sin más queries.
        # Una aproximación muy cruda si overallCpuUsage es pequeño:
        cpu_usage_percent = (quick_stats.overallCpuUsage / 1000) if quick_stats.overallCpuUsage is not None else 0 # Esto es solo un placeholder, no un % real.

        metrics_data = {
            'cpu_usage_percent': cpu_usage_percent, # Placeholder, necesita cálculo real
            'memory_usage_percent': (quick_stats.guestMemoryUsage / config.hardware.memoryMB) * 100 if config.hardware.memoryMB and quick_stats.guestMemoryUsage is not None else 0,
            'disk_usage_percent': 0, # Placeholder, disk I/O es más complejo
            'network_rx_bytes': 0, # Placeholder, network I/O es más complejo
            'network_tx_bytes': 0, # Placeholder
            'uptime_seconds': quick_stats.uptimeSeconds if quick_stats.uptimeSeconds is not None else 0,
        }
        
        app.logger.info(f"Metrics: Returning for VM: {vm.name}")
        return jsonify(metrics_data)
    except vim.fault.InvalidLogin:
        app.logger.error(f"Metrics: vSphere login failed for user {user} on host {host}")
        return jsonify({'error': 'vSphere login failed. Check credentials.'}), 401
    except Exception as e:
        app.logger.error(f"Metrics: Error getting VM metrics for {vm_uuid} on {host}: {str(e)}", exc_info=True)
        return jsonify({'error': f'An error occurred in Python service while fetching metrics: {str(e)}'}), 500
    finally:
        if si:
            disconnect_vsphere(si)

@app.route('/hosts', methods=['GET'])
def list_hosts():
    host_param = request.args.get('host')
    user_param = request.args.get('user')
    password_param = request.args.get('password')
    port_param = int(request.args.get('port', 443))

    app.logger.info(f"Hosts: Attempting for vSphere: {host_param}")
    if not all([host_param, user_param, password_param]):
        return jsonify({'error': 'Missing connection parameters'}), 400

    si = None
    try:
        si = connect_vsphere(host_param, user_param, password_param, port_param)
        content = si.RetrieveContent()
        
        host_view = content.viewManager.CreateContainerView(content.rootFolder, [vim.HostSystem], True)
        esxi_hosts = []
        for esxi_host in host_view.view:
            summary = esxi_host.summary
            overall_status = summary.overallStatus
            # Quick stats for CPU and Memory (overallCpuUsage is in MHz, memory is in MB)
            # For a more accurate percentage, you'd need host's total CPU capacity.
            # This is a simplified representation.
            cpu_usage_mhz = summary.quickStats.overallCpuUsage if summary.quickStats else 0
            total_cpu_mhz = summary.hardware.cpuMhz * summary.hardware.numCpuCores if summary.hardware else 0
            cpu_usage_percent = (cpu_usage_mhz / total_cpu_mhz) * 100 if total_cpu_mhz > 0 else 0
            
            memory_total_bytes = summary.hardware.memorySize if summary.hardware else 0
            memory_used_mb = summary.quickStats.overallMemoryUsage if summary.quickStats else 0
            memory_used_bytes = memory_used_mb * 1024 * 1024 if memory_used_mb is not None else 0

            esxi_hosts.append({
                'moid': esxi_host._moId,
                'name': esxi_host.name,
                'overall_status': str(overall_status), # e.g., 'green', 'yellow', 'red'
                'connection_state': str(esxi_host.runtime.connectionState), # e.g., 'connected', 'disconnected'
                'power_state': str(esxi_host.runtime.powerState), # e.g., 'poweredOn'
                'cpu_cores': summary.hardware.numCpuCores if summary.hardware else 0,
                'cpu_usage_percent': round(cpu_usage_percent, 2),
                'memory_total_bytes': memory_total_bytes,
                'memory_used_bytes': memory_used_bytes,
                'vm_count': len(esxi_host.vm)
            })
        host_view.Destroy()
        app.logger.info(f"Hosts: Found {len(esxi_hosts)} ESXi hosts for {host_param}")
        return jsonify(esxi_hosts)
    except vim.fault.InvalidLogin:
        return jsonify({'error': 'vSphere login failed'}), 401
    except Exception as e:
        app.logger.error(f"Hosts: Error for {host_param}: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500
    finally:
        if si:
            disconnect_vsphere(si)

@app.route('/datastores', methods=['GET'])
def list_datastores():
    host_param = request.args.get('host')
    user_param = request.args.get('user')
    password_param = request.args.get('password')
    port_param = int(request.args.get('port', 443))

    app.logger.info(f"Datastores: Attempting for vSphere: {host_param}")
    if not all([host_param, user_param, password_param]):
        return jsonify({'error': 'Missing connection parameters'}), 400

    si = None
    try:
        si = connect_vsphere(host_param, user_param, password_param, port_param)
        content = si.RetrieveContent()
        
        datastore_view = content.viewManager.CreateContainerView(content.rootFolder, [vim.Datastore], True)
        datastores_info = []
        for ds in datastore_view.view:
            summary = ds.summary
            datastores_info.append({
                'moid': ds._moId,
                'name': summary.name,
                'type': summary.type, # e.g., VMFS, NFS, vSAN
                'capacity_bytes': summary.capacity,
                'free_space_bytes': summary.freeSpace,
                'url': summary.url, # e.g., ds:///vmfs/volumes/xxxxxxxx-xxxxxxx-xxxx-xxxxxxxxxxxx/
                'accessible': summary.accessible
            })
        datastore_view.Destroy()
        app.logger.info(f"Datastores: Found {len(datastores_info)} datastores for {host_param}")
        return jsonify(datastores_info)
    except vim.fault.InvalidLogin:
        return jsonify({'error': 'vSphere login failed'}), 401
    except Exception as e:
        app.logger.error(f"Datastores: Error for {host_param}: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500
    finally:
        if si:
            disconnect_vsphere(si)

@app.route('/templates', methods=['GET'])
def list_templates():
    host_param = request.args.get('host')
    user_param = request.args.get('user')
    password_param = request.args.get('password')
    port_param = int(request.args.get('port', 443))

    app.logger.info(f"Templates: Attempting for vSphere: {host_param}")
    if not all([host_param, user_param, password_param]):
        return jsonify({'error': 'Missing connection parameters'}), 400

    si = None
    try:
        si = connect_vsphere(host_param, user_param, password_param, port_param)
        content = si.RetrieveContent()
        
        vm_view = content.viewManager.CreateContainerView(content.rootFolder, [vim.VirtualMachine], True)
        templates_info = []
        for vm_obj in vm_view.view:
            if vm_obj.config.template: # Check if the VM is a template
                summary = vm_obj.summary
                config = vm_obj.config
                # Calculate total disk size for the template
                disk_capacity_bytes = sum([dev.capacityInBytes for dev in config.hardware.device if isinstance(dev, vim.vm.device.VirtualDisk)])

                templates_info.append({
                    'uuid': config.uuid,
                    'name': config.name,
                    'guest_os': config.guestFullName,
                    'disk_capacity_bytes': disk_capacity_bytes,
                    'datastore_name': vm_obj.datastore[0].name if vm_obj.datastore else None # Primary datastore
                })
        vm_view.Destroy()
        app.logger.info(f"Templates: Found {len(templates_info)} templates for {host_param}")
        return jsonify(templates_info)
    except vim.fault.InvalidLogin:
        return jsonify({'error': 'vSphere login failed'}), 401
    except Exception as e:
        app.logger.error(f"Templates: Error for {host_param}: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500
    finally:
        if si:
            disconnect_vsphere(si)

# La ruta /isos es más compleja y requiere navegar por datastores.
# Por ahora, la dejaremos pendiente o con una respuesta vacía.
@app.route('/isos', methods=['GET'])
def list_isos():
    app.logger.warn("ISO listing endpoint called, but not fully implemented. Returning empty list.")
    # Implementar la lógica de búsqueda de ISOs aquí si es necesario.
    # Esto implicaría usar DatastoreBrowser.SearchDatastoreSubFolders_Task y SearchDatastore_Task
    return jsonify([])


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True) # Added debug=True for development
