const recentsLength = 3;

const INITIAL_STATE = {
	BLEList: [], //An Array of Discovered Devices
	color: '#800080', //the Current Color of the LED strip
	connectedDevice: {}, // the current connected BLE device
	status: 'disconnected' // the status of the BLE connection
};


const recentsReducer = (state = INITIAL_STATE, action) => {
	switch (action.type) {
		case 'ADD_RECENT':
			if (action.recent && !state.includes(action.recent)) {
				const recents = [action.recent, ...state];
				return Array.from({ length: recentsLength }, (_, index) => recents[index]);
			}
			return state;
		case 'ADD_BLE':
			if (state.BLEList.some(device => device.id === action.device.id) || !action.device.isConnectable || action.device.name === null) {
				return state;
			} else {
				const newBLE = [
					...state.BLEList,
					action.device
				]
				return {
					BLEList: newBLE,
					color: state.color,
					connectedDevice: state.connectedDevice,
					status: action.status
				};
			}
		case 'CHANGED_COLOR':
			return {
				BLEList: state.BLEList,
				color: action.newColor,
				connectedDevice: state.connectedDevice,
				status: action.status
			};
		case 'CONNECTED_DEVICE':
			console.log("Reducer connected device", action);
			return {
				...state,
				connectedDevice: action.connectedDevice,
			};
		case 'CHANGE_STATUS':
			console.log("change status:", action.status)
			return {
				BLEList: state.BLEList,
				color: state.color,
				connectedDevice: action.connectedDevice,
				status: action.status
			}
		default:
			return state;
	}
};
export default recentsReducer;
