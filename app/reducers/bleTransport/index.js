const INITIAL_STATE = {
	connectedDevice: {}, // the current connected BLE device
	status: 'disconnected' // the status of the BLE connection
};

const bleTransportReducer = (state = INITIAL_STATE, action) => {
	switch (action.type) {
		case 'CONNECTED_DEVICE':
			console.log("Reducer connected device", action);
			return {
				...state,
				connectedDevice: action.connectedDevice,
			};
		case 'CHANGE_STATUS':
			console.log("change status:", action.status)
			return {
				...state,
				status: action.status
			}
		default:
			return state;
	}
};
export default bleTransportReducer;


