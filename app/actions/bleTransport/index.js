export function connectedDevice(device) {
	return {
		type: "CONNECTED_DEVICE",
		connectedDevice: device
	}
};

export function changeStatus(bleStatus) {
	return {
		type: "CHANGE_STATUS",
		bleStatus: bleStatus
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

