from flask import Flask, request, jsonify
from pyVim.connect import SmartConnect, Disconnect
from pyVmomi import vim
import ssl
import atexit

app = Flask(__name__)

def connect_vsphere(host, user, password, port=443):
    context = ssl._create_unverified_context()
    si = SmartConnect(host=host, user=user, pwd=password, port=port, sslContext=context)
    atexit.register(Disconnect, si)
    return si

@app.route('/vms', methods=['GET'])
def list_vms():
    host = request.args.get('host')
    user = request.args.get('user')
    password = request.args.get('password')

    if not host or not user or not password:
        return jsonify({'error': 'Missing connection parameters'}), 400

    try:
        si = connect_vsphere(host, user, password)
        content = si.RetrieveContent()
        container = content.rootFolder
        viewType = [vim.VirtualMachine]
        recursive = True
        containerView = content.viewManager.CreateContainerView(container, viewType, recursive)
        vms = containerView.view
        vm_list = []
        for vm in vms:
            summary = vm.summary
            vm_info = {
                'name': summary.config.name,
                'power_state': summary.runtime.powerState,
                'guest_os': summary.config.guestFullName,
                'ip_address': summary.guest.ipAddress,
                'uuid': summary.config.uuid
            }
            vm_list.append(vm_info)
        return jsonify(vm_list)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/vm/<vm_uuid>/power', methods=['POST'])
def power_vm(vm_uuid):
    host = request.json.get('host')
    user = request.json.get('user')
    password = request.json.get('password')
    action = request.json.get('action')  # 'on' or 'off'

    if not host or not user or not password or not action:
        return jsonify({'error': 'Missing parameters'}), 400

    try:
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

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
