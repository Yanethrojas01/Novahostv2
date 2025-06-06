from flask import Flask, request, jsonify
from pyVim.connect import SmartConnect, Disconnect
from pyVmomi import vim, vmodl
import ssl
import atexit
import time
import datetime

app = Flask(__name__)

def get_obj(content, vimtype, name=None, uuid=None):
    """
    Devuelve un objeto vSphere.
    Busca por nombre si se proporciona, o por UUID si se proporciona.
    """
    obj = None
    container = content.viewManager.CreateContainerView(content.rootFolder, vimtype, True)
    if uuid:
        for c in container.view:
            if hasattr(c, 'config') and c.config is not None and c.config.uuid == uuid:
                obj = c
                break
    elif name:
         for c in container.view:
            if c.name == name:
                obj = c
                break
    else: # Devuelve todos los objetos si no se especifica nombre ni uuid
        obj = [c for c in container.view]

    container.Destroy()
    return obj

def wait_for_tasks(si, tasks, action_name="VM action"):
    """
    Espera a que una lista de tareas de vCenter se complete.
    """
    property_collector = si.content.propertyCollector
    task_list = [str(task) for task in tasks]

    # Crear un filtro para monitorizar las tareas
    obj_specs = [vim.PropertyCollector.ObjectSpec(obj=task) for task in tasks]
    prop_spec = vim.PropertyCollector.PropertySpec(type=vim.Task, pathSet=[], all=True)
    filter_spec = vim.PropertyCollector.FilterSpec(objectSet=obj_specs, propSet=[prop_spec])
    pcfilter = property_collector.CreateFilter(filter_spec, True)

    try:
        start_time = time.time()
        while len(task_list):
            update = property_collector.WaitForUpdates(None) # Espera indefinidamente por defecto
            if not update or not update.filterSet:
                continue

            for filter_set in update.filterSet:
                for obj_set in filter_set.objectSet:
                    task = obj_set.obj
                    for change in obj_set.changeSet:
                        if change.name == 'info':
                            state = change.val.state
                        elif change.name == 'key':
                            state = task.info.state
                        else:
                            continue

                        if str(task) in task_list:
                            if state == vim.TaskInfo.State.success:
                                # Eliminar tarea de la lista de monitorización
                                task_list.remove(str(task))
                                app.logger.info(f"Task {task} completed successfully for {action_name}.")
                            elif state == vim.TaskInfo.State.error:
                                task_list.remove(str(task))
                                error_msg = task.info.error.msg if task.info.error else "Unknown error"
                                app.logger.error(f"Task {task} failed for {action_name}: {error_msg}")
                                raise Exception(f"Task {task} for {action_name} failed: {error_msg}")
            # Timeout para evitar bucles infinitos si algo va mal con WaitForUpdates
            if time.time() - start_time > 300: # 5 minutos de timeout
                app.logger.error(f"Timeout waiting for tasks: {task_list} for {action_name}")
                raise Exception(f"Timeout waiting for tasks for {action_name}")
    finally:
        if pcfilter:
            pcfilter.Destroy()


@app.route('/vms/create', methods=['POST'])
def create_vm():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Request body must be JSON'}), 400

    # Credenciales del hypervisor
    host_param = data.get('host')
    user_param = data.get('user')
    password_param = data.get('password')
    port_param = int(data.get('port', 443))

    # Parámetros de la VM
    vm_name = data.get('name')
    template_uuid = data.get('template_uuid') # Para clonar
    iso_path = data.get('iso_path')           # Para creación desde ISO, ej: "[Datastore1] ISOs/ubuntu.iso"
    
    specs = data.get('specs', {})
    guest_os_identifier = specs.get('os')     # ej: "ubuntu64Guest", necesario para ISO. El frontend debe enviarlo.
    cpu_count = specs.get('cpu')
    memory_mb = specs.get('memory')
    disk_gb = specs.get('disk', 20) # Default a 20GB si no se especifica
    
    power_on_after_creation = data.get('start_vm', False)
    target_datastore_name = data.get('datastore_name') # Datastore para el disco de la VM

    app.logger.info(f"Create VM request: Name='{vm_name}', TemplateUUID='{template_uuid}', ISOPath='{iso_path}', GuestOS='{guest_os_identifier}', CPU={cpu_count}, MemMB={memory_mb}, DiskGB={disk_gb}, PowerOn={power_on_after_creation}, Datastore='{target_datastore_name}'")

    if not all([host_param, user_param, password_param, vm_name, cpu_count, memory_mb]):
        missing_params = [p for p, v in {
            "host": host_param, "user": user_param, "password": password_param,
            "name": vm_name, "specs.cpu": cpu_count, "specs.memory": memory_mb
        }.items() if not v]
        app.logger.error(f"Create VM: Missing basic parameters: {', '.join(missing_params)}")
        return jsonify({'error': f"Missing basic parameters: {', '.join(missing_params)}"}), 400

    si = None
    try:
        si = connect_vsphere(host_param, user_param, password_param, port_param)
        content = si.RetrieveContent()
        app.logger.info(f"Create VM: Connected to vSphere {host_param}")

        if iso_path and not template_uuid: # Priorizar creación desde ISO
            app.logger.info(f"Create VM: Initiating creation from ISO '{iso_path}'")
            if not guest_os_identifier:
                app.logger.error("Create VM from ISO: Missing guest OS identifier (specs.os)")
                return jsonify({'error': "Missing guest OS identifier (specs.os) for ISO creation"}), 400
            if not target_datastore_name:
                app.logger.error("Create VM from ISO: Missing target datastore for VM disk")
                return jsonify({'error': "Missing target datastore for VM disk for ISO creation"}), 400

            # --- Lógica para crear VM desde ISO ---
            vm_datastore = get_obj(content, [vim.Datastore], name=target_datastore_name)
            if not vm_datastore:
                app.logger.error(f"Create VM from ISO: Target datastore '{target_datastore_name}' for VM disk not found.")
                return jsonify({'error': f"Target datastore '{target_datastore_name}' for VM disk not found"}), 404

            # Encontrar un resource pool y carpeta de destino (simplificado)
            # Esto debería ser más robusto, permitiendo al usuario seleccionar o usando valores predeterminados configurables.
            datacenter = content.rootFolder.childEntity[0] # Asume el primer Datacenter
            dest_folder = datacenter.vmFolder
            resource_pool = datacenter.hostFolder.childEntity[0].resourcePool # RP del primer Cluster/Host

            config_spec = vim.vm.ConfigSpec(
                name=vm_name,
                guestId=guest_os_identifier,
                numCPUs=int(cpu_count),
                memoryMB=int(memory_mb),
                files=vim.vm.FileInfo(vmPathName=f"[{vm_datastore.name}]")
            )

            devices = []
            # Controlador SCSI
            scsi_controller = vim.vm.device.VirtualLsiLogicController(key=1000, busNumber=0, sharedBus=vim.vm.device.VirtualSCSIController.Sharing.noSharing)
            scsi_spec = vim.vm.device.VirtualDeviceSpec(device=scsi_controller, operation=vim.vm.device.VirtualDeviceSpec.Operation.add)
            devices.append(scsi_spec)

            # Disco Virtual
            disk_kb = int(disk_gb) * 1024 * 1024
            disk_backing = vim.vm.device.VirtualDisk.FlatVer2BackingInfo(
                datastore=vm_datastore,
                diskMode=vim.vm.device.VirtualDiskOption.DiskMode.persistent,
                thinProvisioned=True,
                fileName=f"[{vm_datastore.name}] {vm_name}/{vm_name}.vmdk" # Crea una carpeta para la VM
            )
            disk_device = vim.vm.device.VirtualDisk(key=2000, controllerKey=1000, unitNumber=0, capacityInKB=disk_kb, backing=disk_backing)
            disk_spec = vim.vm.device.VirtualDeviceSpec(device=disk_device, operation=vim.vm.device.VirtualDeviceSpec.Operation.add, fileOperation=vim.vm.device.VirtualDeviceSpec.FileOperation.create)
            devices.append(disk_spec)
            
            # Unidad de CD/DVD con ISO
            # Asumimos que iso_path es como "[DatastoreName] path/to/iso.iso"
            # El controlador IDE se suele añadir por defecto o se puede crear uno.
            # Para simplificar, intentaremos añadirlo a un controlador IDE existente o crear uno nuevo.
            # Esta parte puede necesitar ajustes según la configuración de vCenter.
            cdrom_backing = vim.vm.device.VirtualCdrom.IsoBackingInfo(fileName=iso_path)
            # Encontrar o crear controlador IDE
            # Esto es una simplificación. Una implementación robusta buscaría un controlador IDE disponible
            # o crearía uno si no existe. Por ahora, asumimos que vCenter puede manejarlo o
            # que un controlador IDE (ej. key=200) ya existe o se crea implícitamente.
            # Si se necesita crear explícitamente:
            # ide_controller = vim.vm.device.VirtualIDEController(key=200, busNumber=0) # o 1 
            # ide_spec = vim.vm.device.VirtualDeviceSpec(device=ide_controller, operation=vim.vm.device.VirtualDeviceSpec.Operation.add)
            # devices.append(ide_spec)
            # cd_controller_key = ide_controller.key

            cdrom = vim.vm.device.VirtualCdrom(
                key=-101, # Clave temporal, vCenter asignará una real
                controllerKey=200, # Asume un controlador IDE con key 200 (IDE 0)
                unitNumber=0,
                backing=cdrom_backing,
                connectable=vim.vm.device.VirtualDevice.ConnectInfo(
                    startConnected=True,
                    allowGuestControl=True,
                    connected=True
                )
            )
            cdrom_spec = vim.vm.device.VirtualDeviceSpec(device=cdrom, operation=vim.vm.device.VirtualDeviceSpec.Operation.add)
            devices.append(cdrom_spec)

            # Adaptador de Red (ej. VMXNET3)
            # Asume una red llamada "VM Network". Esto debe ser configurable.
            network_name_to_use = "VM Network" 
            network_obj = get_obj(content, [vim.Network], name=network_name_to_use)
            if not network_obj: # Intentar con DistributedVirtualPortgroup
                 network_obj = get_obj(content, [vim.dvs.DistributedVirtualPortgroup], name=network_name_to_use)
            
            if not network_obj:
                app.logger.error(f"Create VM from ISO: Network '{network_name_to_use}' not found.")
                return jsonify({'error': f"Network '{network_name_to_use}' not found"}), 404

            nic = vim.vm.device.VirtualVmxnet3() # O VirtualE1000
            if isinstance(network_obj, vim.dvs.DistributedVirtualPortgroup):
                dvs_port_connection = vim.dvs.PortConnection(portgroupKey=network_obj.key, switchUuid=network_obj.config.distributedVirtualSwitch.uuid)
                nic.backing = vim.vm.device.VirtualEthernetCard.DistributedVirtualPortBackingInfo(port=dvs_port_connection)
            else: # Standard Switch
                nic.backing = vim.vm.device.VirtualEthernetCard.NetworkBackingInfo(deviceName=network_name_to_use, network=network_obj)
            
            nic.connectable = vim.vm.device.VirtualDevice.ConnectInfo(startConnected=True, allowGuestControl=True, connected=True)
            nic.addressType = 'assigned'
            nic_spec = vim.vm.device.VirtualDeviceSpec(device=nic, operation=vim.vm.device.VirtualDeviceSpec.Operation.add)
            devices.append(nic_spec)
            
            config_spec.deviceChange = devices
            config_spec.bootOptions = vim.vm.BootOptions(bootOrder=[vim.vm.BootOptions.BootableCdromDevice()])

            app.logger.info(f"Create VM from ISO: Creating VM '{vm_name}' with spec...")
            create_task = dest_folder.CreateVM_Task(config=config_spec, pool=resource_pool)
            wait_for_tasks(si, [create_task], action_name=f"Creating new VM {vm_name} from ISO")
            
            new_vm = create_task.info.result
            if not new_vm:
                app.logger.error("Create VM from ISO: Create task completed but new VM object is null.")
                raise Exception("Failed to get new VM object after creation from ISO.")
            app.logger.info(f"Create VM from ISO: VM '{vm_name}' created successfully. MOID: {new_vm._moId}, UUID: {new_vm.config.uuid}")

        elif template_uuid and not iso_path: # Lógica de clonación existente
            app.logger.info(f"Create VM: Initiating clone from template UUID '{template_uuid}'")
            template_vm = get_obj(content, [vim.VirtualMachine], uuid=template_uuid)
            if not template_vm:
                app.logger.error(f"Create VM: Template with UUID '{template_uuid}' not found.")
                return jsonify({'error': f"Template with UUID '{template_uuid}' not found"}), 404
            app.logger.info(f"Create VM: Found template '{template_vm.name}'")

            dest_folder = template_vm.parent
            if not isinstance(dest_folder, vim.Folder):
                datacenter = get_obj(content, [vim.Datacenter], name=template_vm.summary.runtime.host.parent.name)
                dest_folder = datacenter.vmFolder if datacenter else content.rootFolder
            
            resource_pool = template_vm.resourcePool
            if not resource_pool:
                resource_pool = template_vm.summary.runtime.host.parent.resourcePool

            relocate_spec = vim.vm.RelocateSpec(pool=resource_pool)
            if target_datastore_name:
                target_ds_obj = get_obj(content, [vim.Datastore], name=target_datastore_name)
                if not target_ds_obj:
                    return jsonify({'error': f"Datastore '{target_datastore_name}' not found"}), 404
                relocate_spec.datastore = target_ds_obj
            elif template_vm.datastore: # Usar el datastore de la plantilla si no se especifica uno nuevo
                 relocate_spec.datastore = template_vm.datastore[0]


            clone_spec = vim.vm.CloneSpec(location=relocate_spec, powerOn=False, template=False)
            
            app.logger.info(f"Create VM: Cloning '{template_vm.name}' to '{vm_name}'...")
            clone_task = template_vm.CloneVM_Task(folder=dest_folder, name=vm_name, spec=clone_spec)
            wait_for_tasks(si, [clone_task], action_name=f"Cloning VM {vm_name}")
            new_vm = clone_task.info.result
            if not new_vm:
                 app.logger.error("Create VM: Clone task completed but new VM object is null.")
                 raise Exception("Failed to get new VM object after cloning.")
            app.logger.info(f"Create VM: VM '{vm_name}' cloned. MOID: {new_vm._moId}, UUID: {new_vm.config.uuid}")

            # Reconfigurar CPU y Memoria para la VM clonada
            reconfig_spec = vim.vm.ConfigSpec(numCPUs=int(cpu_count), memoryMB=int(memory_mb))
            app.logger.info(f"Create VM: Reconfiguring cloned VM '{vm_name}'...")
            reconfig_task = new_vm.ReconfigureVM_Task(spec=reconfig_spec)
            wait_for_tasks(si, [reconfig_task], action_name=f"Reconfiguring VM {vm_name}")
            app.logger.info(f"Create VM: Cloned VM '{vm_name}' reconfigured.")
        else:
            app.logger.error("Create VM: Must provide either template_uuid (for clone) or iso_path (for new from ISO).")
            return jsonify({'error': "Invalid parameters: Provide either template_uuid or iso_path."}), 400

        # Encender la VM si se solicita (común para ambas lógicas)
        if power_on_after_creation and new_vm:
            if new_vm.runtime.powerState != vim.VirtualMachinePowerState.poweredOn:
                app.logger.info(f"Create VM: Powering on VM '{vm_name}'...")
                poweron_task = new_vm.PowerOnVM_Task()
                wait_for_tasks(si, [poweron_task], action_name=f"Powering on VM {vm_name}")
                app.logger.info(f"Create VM: VM '{vm_name}' powered on.")
            else:
                app.logger.info(f"Create VM: VM '{vm_name}' is already powered on.")

        return jsonify({
            'status': 'success',
            'message': f"VM '{vm_name}' processed successfully.",
            'vm_uuid': new_vm.config.uuid if new_vm else None,
            'vm_name': new_vm.name if new_vm else None,
            'vm_moid': new_vm._moId if new_vm else None
        }), 201

    except vim.fault.InvalidLogin:
        app.logger.error(f"Create VM: vSphere login failed for user {user_param} on host {host_param}")
        return jsonify({'error': 'vSphere login failed. Check credentials.'}), 401
    except Exception as e:
        app.logger.error(f"Create VM: Error for host {host_param}: {str(e)}", exc_info=True)
        return jsonify({'error': f'An error occurred in Python service while creating VM: {str(e)}'}), 500
    finally:
        if si:
            disconnect_vsphere(si)

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
                'boot_time': summary.runtime.bootTime.isoformat() if hasattr(summary.runtime, 'bootTime') and summary.runtime.bootTime else None,
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
    original_vm_uuid_param = vm_uuid # Guardar el original para el log
    app.logger.info(f"Power action: >>> Entering power_vm handler. Raw UUID param: '{original_vm_uuid_param}' <<<")
    vm_uuid = vm_uuid.strip() # Limpiar espacios

    host = request.json.get('host')
    user = request.json.get('user')
    password = request.json.get('password')
    action = request.json.get('action')  # 'on', 'off', 'suspend', 'resume', 'shutdown_guest', 'reboot_guest'
    port = int(request.json.get('port', 443)) # Asumir puerto si no se provee

    app.logger.info(f"Power action: Received raw UUID param: '{original_vm_uuid_param}', Stripped UUID for search: '{vm_uuid}', Action: '{action}', Host: {host}")

    if not all([host, user, password, action, vm_uuid]):
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
            if hasattr(v, 'config') and v.config and v.config.uuid == vm_uuid:
                vm = v
                app.logger.info(f"Power action: Found VM '{vm.name}' with UUID '{vm_uuid}'")
                break
        containerView.Destroy() # Destruir vista después de usarla

        if not vm:
            app.logger.error(f"Power action: VM with UUID '{vm_uuid}' not found on host '{host}'.")
            return jsonify({'error': 'VM not found'}), 404
        
        task = None
        if action == 'on':
            # PowerOnVM_Task is used for starting and resuming
            if vm.runtime.powerState == vim.VirtualMachinePowerState.poweredOff or vm.runtime.powerState == vim.VirtualMachinePowerState.suspended:
                task = vm.PowerOnVM_Task()
            else:
                app.logger.info(f"Power action: VM '{vm.name}' is already on or in an unsuitable state for 'on' action.")
                return jsonify({'status': 'success', 'message': 'VM already powered on or not in a state to be powered on.'})
        elif action == 'off':
            task = vm.PowerOffVM_Task()
        elif action == 'suspend':
            task = vm.SuspendVM_Task()
        elif action == 'shutdown_guest': # Graceful shutdown
            if vm.guest.toolsRunningStatus == 'guestToolsRunning':
                task = vm.ShutdownGuest()
            else: # Fallback to hard power off if tools are not running
                task = vm.PowerOffVM_Task()
        elif action == 'reboot_guest': # Graceful reboot
            task = vm.RebootGuest() # This will fail if tools not running, wait_for_tasks will catch it.
        else:
            return jsonify({'error': 'Invalid action'}), 400

        app.logger.info(f"Power action: Initiated task '{task}' for VM '{vm.name}' (action: {action}). Waiting for completion...")
        wait_for_tasks(si, [task], action_name=f"Powering {action} VM {vm.name}") # Usar wait_for_tasks
        
        if task.info.state == vim.TaskInfo.State.success:
            app.logger.info(f"Power action: Task for VM '{vm.name}' (action: {action}) completed successfully.")
            return jsonify({'status': 'success'})
        else:
            error_msg = task.info.error.msg if task.info.error else "Unknown task error"
            app.logger.error(f"Power action: Task for VM '{vm.name}' (action: {action}) failed: {error_msg}")
            return jsonify({'error': task.info.error.msg}), 500
    except vim.fault.InvalidLogin:
        app.logger.error(f"Power action: vSphere login failed for user {user} on host {host}")
        return jsonify({'error': 'vSphere login failed. Check credentials.'}), 401
    except Exception as e:
        app.logger.error(f"Power action: Error for VM '{vm_uuid}' on host '{host}': {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500

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
    #app.logger.info(f"Metrics: Received raw UUID param: '{original_vm_uuid_param}', Stripped UUID for search: '{vm_uuid}' on host: {host}")

    if not all([host, user, password]):
        #app.logger.error("Metrics: Missing connection parameters")
        return jsonify({'error': 'Missing connection parameters'}), 400

    si = None
    try:
        si = connect_vsphere(host, user, password, port)
        content = si.RetrieveContent()
       # app.logger.info(f"Metrics: Successfully connected to vSphere: {host}")

       # app.logger.info(f"Metrics: Attempting to find VM by iterating. Target UUID: {vm_uuid}")
        vm = None
        container = content.rootFolder
        viewType = [vim.VirtualMachine]
        recursive = True
        containerView = content.viewManager.CreateContainerView(container, viewType, recursive)
        
        for v_obj in containerView.view:
            if hasattr(v_obj, 'config') and v_obj.config is not None and v_obj.config.uuid == vm_uuid:
                vm = v_obj
                #app.logger.info(f"Metrics: VM with UUID {vm_uuid} found by iteration: {vm.name}")
                break
        containerView.Destroy() # No olvides destruir la vista
        
        if not vm:
            #app.logger.error(f"Metrics: VM with UUID {vm_uuid} not found after iteration.")
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
        
       # app.logger.info(f"Metrics: Returning for VM: {vm.name}")
        return jsonify(metrics_data)
    except vim.fault.InvalidLogin:
        #app.logger.error(f"Metrics: vSphere login failed for user {user} on host {host}")
        return jsonify({'error': 'vSphere login failed. Check credentials.'}), 401
    except Exception as e:
        #app.logger.error(f"Metrics: Error getting VM metrics for {vm_uuid} on {host}: {str(e)}", exc_info=True)
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

def search_datastore_for_isos(datastore, si):
    """
    Busca archivos .iso en un datastore específico.
        :param datastore: The datastore object to search.
    :param si: The ServiceInstance object.

    """
    isos_found = []
    search_spec = vim.host.DatastoreBrowser.SearchSpec()
    search_spec.matchPattern = ["*.iso"] # Buscar solo archivos .iso
    # search_spec.details = vim.host.DatastoreBrowser.FileInfo.Details(fileType=True, fileSize=True, modification=True) # Obtener detalles

    # Para obtener todos los detalles, incluyendo el tamaño del archivo, necesitamos especificarlo.
    details = vim.host.DatastoreBrowser.FileInfo.Details()
    details.fileType = True
    details.fileSize = True
    details.modification = True # Opcional, si quieres la fecha de modificación
    search_spec.details = details


    # Iniciar la búsqueda en la raíz del datastore "[datastore_name] /"
    # El path para el datastore browser es como "[DatastoreName] path/to/file"
    search_path = f"[{datastore.name}]" 
    
    try:
        # Usar el DatastoreBrowser del datastore
        ds_browser = datastore.browser
        if not ds_browser:
            app.logger.warning(f"No browser available for datastore {datastore.name}")
            return isos_found # Use warning() instead of warn()

        search_task = ds_browser.SearchDatastoreSubFolders_Task(datastorePath=search_path, searchSpec=search_spec)
        wait_for_tasks(si, [search_task], action_name=f"Searching ISOs in {datastore.name}")

        if search_task.info.state == vim.TaskInfo.State.success:
            results = search_task.info.result
            for folder_result in results:
                # folder_result es un HostDatastoreBrowserSearchResults
                # folder_result.folderPath es el path de la carpeta donde se encontraron los archivos
                # folder_result.file es una lista de FileInfo
                for file_info in folder_result.file:
                    if isinstance(file_info, vim.host.DatastoreBrowser.FileInfo) and file_info.path.lower().endswith('.iso'):
                        isos_found.append({
                            'name': file_info.path, # El nombre del archivo .iso
                            'path': f"{folder_result.folderPath}{file_info.path}", # Path completo incluyendo el datastore y la carpeta
                            'datastore_name': datastore.name,
                            'datastore_moid': datastore._moId,
                            'size_bytes': file_info.fileSize if hasattr(file_info, 'fileSize') else 0,
                            # 'modification': file_info.modification.isoformat() if hasattr(file_info, 'modification') else None
                        })
        else:
            app.logger.error(f"Failed to search datastore {datastore.name}: {search_task.info.error.msg if search_task.info.error else 'Unknown error'}")
    except Exception as e:
        app.logger.error(f"Exception while searching datastore {datastore.name} for ISOs: {str(e)}", exc_info=True)
        
    return isos_found

@app.route('/isos', methods=['GET'])
def list_isos():
    host_param = request.args.get('host')
    user_param = request.args.get('user')
    password_param = request.args.get('password')
    port_param = int(request.args.get('port', 443))

    app.logger.info(f"ISOs: Attempting for vSphere: {host_param}")
    if not all([host_param, user_param, password_param]):
        return jsonify({'error': 'Missing connection parameters'}), 400

    si = None
    all_isos = []
    try:
        si = connect_vsphere(host_param, user_param, password_param, port_param)
        content = si.RetrieveContent()
        
        datastore_view = content.viewManager.CreateContainerView(content.rootFolder, [vim.Datastore], True)
        for ds in datastore_view.view:
            if ds.summary.accessible: # Solo buscar en datastores accesibles
                app.logger.info(f"ISOs: Searching in datastore '{ds.name}'")
                isos_in_ds = search_datastore_for_isos(ds, si) # Pasar el ServiceInstance (si)
                all_isos.extend(isos_in_ds)
            else:
                app.logger.warning(f"ISOs: Datastore '{ds.name}' is not accessible, skipping.")
        datastore_view.Destroy()
        
        app.logger.info(f"ISOs: Found a total of {len(all_isos)} ISO files for {host_param}")
        return jsonify(all_isos)
    except vim.fault.InvalidLogin:
        return jsonify({'error': 'vSphere login failed'}), 401
    except Exception as e:
        app.logger.error(f"ISOs: Error for {host_param}: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500
    finally:
        if si:
            disconnect_vsphere(si)

@app.route('/vm/<string:vm_uuid>/console', methods=['POST'])
def vm_console_ticket(vm_uuid):
    data = request.get_json()
    if not data:
        app.logger.error("Console Ticket: Request body must be JSON")
        return jsonify({'error': 'Request body must be JSON'}), 400

    host_param = data.get('host')
    user_param = data.get('user')
    password_param = data.get('password')
    port_param = int(data.get('port', 443))
    # vm_name_param = data.get('vm_name') # Optional VM name hint from frontend

    original_vm_uuid_param = vm_uuid
    vm_uuid = vm_uuid.strip() # Clean up UUID
    app.logger.info(f"Console Ticket: Request for VM UUID '{original_vm_uuid_param}' (stripped: '{vm_uuid}') on vSphere {host_param}")

    if not all([host_param, user_param, password_param]):
        app.logger.error("Console Ticket: Missing connection parameters in request body")
        return jsonify({'error': 'Missing vSphere connection parameters in request body'}), 400

    si = None
    try:
        si = connect_vsphere(host_param, user_param, password_param, port_param)
        content = si.RetrieveContent()
        app.logger.info(f"Console Ticket: Connected to vSphere {host_param}")

        vm = get_obj(content, [vim.VirtualMachine], uuid=vm_uuid)
        if not vm:
            app.logger.error(f"Console Ticket: VM with UUID '{vm_uuid}' not found.")
            return jsonify({'error': f'VM with UUID {vm_uuid} not found'}), 404

        app.logger.info(f"Console Ticket: Found VM '{vm.name}'. Acquiring console details...")

        console_options = []
        vm_name = vm.name # Use the actual VM name from vSphere

        # 1. HTML5 Console (Requires vCenter and Session Ticket)
        # This is the preferred method for modern vSphere versions (6.5+)
        if get_vsphere_subtype(content) == "vcenter":
            try:
                app.logger.info(f"Console Ticket: Attempting to acquire Session Ticket for HTML5 console...")
                # AcquireCloneTicket is often used for session tickets for web consoles
                session_ticket = content.sessionManager.AcquireCloneTicket()
                server_guid = content.about.instanceUuid
                vm_moid = vm._moId

                # Construct the HTML5 console URL
                # Format: https://<vcenter_host>/ui/webconsole.html?vmId=<moid>&vmName=<name>&serverGuid=<guid>&host=<vcenter_host>&sessionTicket=<ticket>
                # Note: The 'host' parameter in the URL should be the vCenter host itself.
                vcenter_host_only = host_param.split(':')[0]
                html5_url = f"https://{vcenter_host_only}/ui/webconsole.html?vmId={vm_moid}&vmName={vm_name}&serverGuid={server_guid}&host={vcenter_host_only}&sessionTicket={session_ticket}"

                console_options.append({
                    'type': 'vsphere_html5', # New type for frontend
                    'vmName': vm_name,
                    'connectionDetails': { 'url': html5_url } # Just the URL needed for iframe
                })
                app.logger.info(f"Console Ticket: HTML5 console option added.")

            except Exception as e_html5:
                app.logger.warning(f"Console Ticket: Error acquiring Session Ticket for HTML5 console for VM '{vm.name}': {str(e_html5)}")
                # Continue to try other methods even if HTML5 fails

        # Intento 2: MKS Ticket
        try:
            app.logger.info(f"Console Ticket: Attempting to acquire MKS ticket for VM '{vm.name}'...")
            mks_ticket_obj = vm.AcquireMksTicket()
            app.logger.info(f"Console Ticket: MKS ticket acquired. ESXi Host: {mks_ticket_obj.host}, CfgFile: {mks_ticket_obj.cfgFile}")
            ticket_details = {
                'mksTicket': mks_ticket_obj.ticket,
                'esxiHost': mks_ticket_obj.host,
                'esxiPort': mks_ticket_obj.port,
                'cfgFile': mks_ticket_obj.cfgFile,
                'sslThumbprint': mks_ticket_obj.sslThumbprint, # ESXi host's thumbprint
                'vcenterHost': host_param.split(':')[0]
            }
            console_options.append({'type': 'vsphere_mks', 'vmName': vm_name, 'connectionDetails': ticket_details})
            app.logger.info(f"Console Ticket: MKS console option added.")

        except vmodl.fault.NotSupported:
            app.logger.warning(f"Console Ticket: AcquireMksTicket is not supported for VM '{vm.name}'.")
        except Exception as e_mks:
            app.logger.warning(f"Console Ticket: Error acquiring MKS ticket for VM '{vm.name}': {str(e_mks)}.")

        # Intento 3: WebMKS Ticket
        try:
            app.logger.info(f"Console Ticket: Attempting to acquire WebMKS ticket for VM '{vm.name}'...")
            webmks_ticket_obj = vm.AcquireTicket('webmks')
            app.logger.info(f"Console Ticket: WebMKS ticket acquired. Host: {webmks_ticket_obj.host}, Port: {webmks_ticket_obj.port}")
            ticket_details = {
                'ticket': webmks_ticket_obj.ticket,
                'host': webmks_ticket_obj.host, # ESXi host or vCenter proxy
                'port': webmks_ticket_obj.port, # Typically 9443 for vCenter proxy, 443 for direct ESXi
                'sslThumbprint': webmks_ticket_obj.sslThumbprint # Thumbprint of 'host'
            }
            console_options.append({'type': 'vsphere_webmks', 'vmName': vm_name, 'connectionDetails': ticket_details})
            app.logger.info(f"Console Ticket: WebMKS console option added.")

        except Exception as e_webmks:
            app.logger.warning(f"Console Ticket: Error acquiring WebMKS ticket for VM '{vm.name}': {str(e_webmks)}.")


        # Check if any console option was successfully acquired
        if not console_options:
             app.logger.error(f"Console Ticket: Failed to acquire any console ticket (HTML5, MKS, WebMKS) for VM '{vm.name}' ({vm_uuid}).")
             return jsonify({'error': f'Failed to acquire any console ticket for VM {vm_uuid}.'}), 500


        # Return the list of available console options
        return jsonify({'vmName': vm_name, 'consoleOptions': console_options}), 200


    except vim.fault.InvalidLogin:
        app.logger.error(f"Console Ticket: vSphere login failed for {user_param}@{host_param}")
        return jsonify({'error': 'vSphere login failed. Check credentials.'}), 401

    except AttributeError as ae:
        # This might catch cases where vm is None before calling a method on it
        if "'NoneType' object has no attribute" in str(ae):
             app.logger.error(f"Console Ticket: VM object was None when trying to acquire ticket for UUID '{vm_uuid}'.")
             return jsonify({'error': f'VM with UUID {vm_uuid} not found or accessible.'}), 404
        else:
             # Re-raise if it's a different AttributeError
             app.logger.error(f"Console Ticket: Unexpected AttributeError for VM {vm_uuid} on {host_param}: {str(ae)}", exc_info=True)
             return jsonify({'error': f'An unexpected error occurred: {str(ae)}'}), 500

    except Exception as e:
        app.logger.error(f"Console Ticket: Error acquiring console ticket for VM {vm_uuid} on {host_param}: {str(e)}", exc_info=True)
        return jsonify({'error': f'An error occurred: {str(e)}'}), 500
    finally:
        if si:
            disconnect_vsphere(si)



@app.route('/vm/<string:vm_uuid>/historical_metrics', methods=['GET'])
def vm_historical_metrics_route(vm_uuid):
    host = request.args.get('host')
    user = request.args.get('user')
    password = request.args.get('password')
    port = int(request.args.get('port', 443))
    timeframe = request.args.get('timeframe', 'hour') # Default to hour

    vm_uuid = vm_uuid.strip()
   # app.logger.info(f"Historical Metrics: Request for VM UUID '{vm_uuid}' on host: {host}, timeframe: {timeframe}")

    if not all([host, user, password]):
        #app.logger.error("Historical Metrics: Missing connection parameters")
        return jsonify({'error': 'Missing connection parameters'}), 400

    si = None
    try:
        si = connect_vsphere(host, user, password, port)
        content = si.RetrieveContent()
        #app.logger.info(f"Historical Metrics: Successfully connected to vSphere: {host}")

        vm = get_obj(content, [vim.VirtualMachine], uuid=vm_uuid)
        if not vm:
           # app.logger.error(f"Historical Metrics: VM with UUID {vm_uuid} not found.")
            return jsonify({'error': f'VM with UUID {vm_uuid} not found in vSphere'}), 404

        perf_manager = content.perfManager

        # --- Determine time range and preferred interval based on timeframe ---
        end_time = datetime.datetime.now()
        start_time = None
        # Common interval IDs (may vary based on vCenter/ESXi config)
        # 20s (20), 5min (300), 30min (1800), 2hr (7200), 1day (86400)
        # We'll try to find the best available interval later, but start with a default
        preferred_interval_id = 20 # Default to 20s interval (for 'hour')

        if timeframe == 'hour':
            start_time = end_time - datetime.timedelta(hours=1)
            preferred_interval_id = 20 # 20 seconds interval
        elif timeframe == 'day':
            start_time = end_time - datetime.timedelta(days=1)
            preferred_interval_id = 300 # 5 minutes interval
        elif timeframe == 'week':
            start_time = end_time - datetime.timedelta(weeks=1)
            preferred_interval_id = 1800 # 30 minutes interval
        elif timeframe == 'month':
            start_time = end_time - datetime.timedelta(days=30) # Approx month
            preferred_interval_id = 7200 # 2 hours interval
        elif timeframe == 'year':
            start_time = end_time - datetime.timedelta(days=365) # Approx year
            preferred_interval_id = 86400 # 1 day interval
        else:
            app.logger.warning(f"Historical Metrics: Invalid timeframe '{timeframe}', defaulting to 'hour'.")
            start_time = end_time - datetime.timedelta(hours=1)
            preferred_interval_id = 20

        # --- Find metric IDs ---
        # Get available counters and map their names to keys
        counters_map = {c.groupInfo.key + '.' + c.nameInfo.key + '.' + c.rollupType: c.key for c in perf_manager.perfCounter}

        # Define desired metrics and their corresponding frontend keys
        desired_metrics = {
            'cpu.usage.average': 'cpuUsagePercent',
            'mem.usage.average': 'memoryUsagePercent',
            'disk.read.average': 'diskReadBps', # KBps -> Bps
            'disk.write.average': 'diskWriteBps', # KBps -> Bps
            'net.received.average': 'netInBps', # KBps -> Bps
            'net.transmitted.average': 'netOutBps', # KBps -> Bps
        }

        metric_ids = []
        for name in desired_metrics:
            if name in counters_map:
                # Use "*" instance for aggregation across all instances (e.g., all vCPUs, all NICs)
                metric_ids.append(vim.PerformanceManager.MetricId(counterId=counters_map[name], instance="*"))
            else:
                app.logger.warning(f"Historical Metrics: Metric counter '{name}' not found on this vSphere instance.")

        if not metric_ids:
             app.logger.error("Historical Metrics: No desired performance counters found for query.")
             return jsonify({'error': 'No desired performance counters found for query.'}), 500

        # --- Create Query Spec ---
        query_spec = vim.PerformanceManager.QuerySpec(
            entity=vm,
            metricId=metric_ids,
            startTime=start_time,
            endTime=end_time,
            intervalId=preferred_interval_id # Use the preferred interval
        )

        # --- Query Performance Data ---
        app.logger.info(f"Historical Metrics: Querying perf data for VM {vm.name} ({vm_uuid}) from {start_time} to {end_time} with interval {preferred_interval_id}")
        results = perf_manager.QueryPerf(querySpec=[query_spec])

        # --- Process Results ---
        formatted_data = []
        if results:
            # results is a list of EntityMetricBase (one per entity, so one for our VM)
            vm_metrics = results[0] # Get metrics for our VM
            # vm_metrics.sampleInfo is a list of timestamps
            # vm_metrics.value is a list of MetricSeries (one per metricId)

            # Map counterId to frontend key for processing
            counter_id_to_frontend_key = {counters_map[name]: key for name, key in desired_metrics.items() if name in counters_map}

            # Get VM's total memory for percentage calculation (fetch once)
            # Note: This requires the VM object to have the config property loaded.
            # The get_obj function should ensure this if it fetches the full object.
            total_memory_mb = vm.config.hardware.memoryMB if hasattr(vm, 'config') and hasattr(vm.config, 'hardware') else 0
            total_memory_kb = total_memory_mb * 1024

            for i, sample in enumerate(vm_metrics.sampleInfo):
                # Use sample.timestamp directly as it's a datetime object
                data_point = {'time': int(sample.timestamp.timestamp() * 1000)} # Timestamp in milliseconds for frontend

                for metric_series in vm_metrics.value:
                    counter_id = metric_series.id.counterId
                    frontend_key = counter_id_to_frontend_key.get(counter_id)

                    if frontend_key and i < len(metric_series.value):
                         value = metric_series.value[i]

                         processed_value = None
                         # Determine how to process the value based on the frontend key
                         if frontend_key == 'cpuUsagePercent':
                             # Value is in hundredths of a percent, convert to percent
                             processed_value = value / 100.0 if value is not None else 0
                         elif frontend_key == 'memoryUsagePercent':
                             # Value is in KB. Convert to percentage of total VM memory.
                             processed_value = (value / total_memory_kb) * 100.0 if value is not None and total_memory_kb > 0 else 0
                         elif frontend_key in ['diskReadBps', 'diskWriteBps', 'netInBps', 'netOutBps']:
                             # Value is in KBps. Convert to Bps.
                             processed_value = value * 1024 if value is not None else 0
                         # Add other metrics if needed

                         if processed_value is not None:
                             data_point[frontend_key] = processed_value

                # Only add data points that have at least one metric value (besides time)
                if len(data_point) > 1:
                    formatted_data.append(data_point)

        app.logger.info(f"Historical Metrics: Returning {len(formatted_data)} data points for VM: {vm.name}")
        return jsonify(formatted_data)

    except vim.fault.InvalidLogin:
        app.logger.error(f"Historical Metrics: vSphere login failed for user {user} on host {host}")
        return jsonify({'error': 'vSphere login failed. Check credentials.'}), 401
    except Exception as e:
        app.logger.error(f"Historical Metrics: Error getting VM historical metrics for {vm_uuid} on {host}: {str(e)}", exc_info=True)
        return jsonify({'error': f'An error occurred in Python service while fetching historical metrics: {str(e)}'}), 500
    finally:
        if si:
            disconnect_vsphere(si)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True) # Added debug=True for development
