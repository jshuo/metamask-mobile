const recentsLength = 3;
const INITIAL_STATE = {
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
export default recentsReducer;


