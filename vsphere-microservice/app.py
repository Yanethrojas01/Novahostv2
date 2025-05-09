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
    port = int(request.args.get('port', 443)) # Consistent port handling

    if not host or not user or not password:
        return jsonify({'error': 'Missing connection parameters'}), 400

    si = None # Define si here for the finally block
    try:
        si = connect_vsphere(host, user, password, port) # Pass port
        content = si.RetrieveContent()
        container = content.rootFolder
        viewType = [vim.VirtualMachine]
        recursive = True
        containerView = content.viewManager.CreateContainerView(container, viewType, recursive)
        vms_objects = containerView.view # Renamed to avoid confusion with 'vms' module/package
        app.logger.info(f"Listing VMs: Found {len(vms_objects)} total VM objects in view.")
        vm_list = []
        for vm_obj in vms_objects:
            summary = vm_obj.summary
            # Ensure guest property exists before trying to access ipAddress
            guest_ip = summary.guest.ipAddress if hasattr(summary, 'guest') and summary.guest else None
            
            app.logger.info(f"Listing VM: Name='{summary.config.name}', UUID='{summary.config.uuid}'")
            vm_info = {
                'name': summary.config.name,
                'power_state': summary.runtime.powerState,
                'guest_os': summary.config.guestFullName,
                'ip_address': guest_ip,
                'uuid': summary.config.uuid
                # Note: This version does not include cpu_count, memory_mb, disk_gb, hostname, vmware_tools_status
                # which were discussed for VirtualMachineCard.tsx.
                # If those are needed for the card directly from this list endpoint,
                # they would need to be added here similar to how they are in the /details endpoint.
            }
            vm_list.append(vm_info)
        containerView.Destroy() # Important to destroy views
        return jsonify(vm_list)
    except vim.fault.InvalidLogin:
        app.logger.error(f"Listing VMs: vSphere login failed for user {user} on host {host}")
        return jsonify({'error': 'vSphere login failed. Check credentials.'}), 401
    except Exception as e:
        app.logger.error(f"Listing VMs: Error for host {host}: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500
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

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True) # Added debug=True for development
