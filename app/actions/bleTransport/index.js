export default function connectedDevice(device) {
	return {
		type: "CONNECTED_DEVICE",
		connectedDevice: device
	}
};

// export function addRecent(recent) {
// 	return {
// 		type: 'ADD_RECENT',
// 		recent,
// 	};
// }

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

export function changeStatus(status) {
	return {
		type: "CHANGE_STATUS",
		status: status
	}
};