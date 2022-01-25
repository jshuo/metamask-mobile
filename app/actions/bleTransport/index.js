export function connectedDevice(device) {
	return {
		type: "CONNECTED_DEVICE",
		connectedDevice: device
	}
};

export function changeStatus(status) {
	return {
		type: "CHANGE_STATUS",
		status: status
	}
};

// export function addBLE(device) {
// 	return {
// 		type: "ADD_BLE",
// 		device
// 	}
// }

// export function changedColor(color) {
// 	return {
// 		type: "CHANGED_COLOR",
// 		newColor: color
// 	}
// }

