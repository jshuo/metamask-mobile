import React, { PureComponent } from 'react';
import PropTypes from 'prop-types';
import {
	FlatList,
	ActivityIndicator,
	Alert,
	TouchableOpacity,
	Text,
	View,
	PermissionsAndroid,
	SafeAreaView,
	StyleSheet,
	RefreshControl
} from 'react-native';
import AsyncStorage from '@react-native-community/async-storage';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { getOnboardingNavbarOptions } from '../../UI/Navbar';
import { connect } from 'react-redux';
import { passwordSet, seedphraseBackedUp } from '../../../actions/user';
import { setLockTime } from '../../../actions/settings';
import StyledButton from '../../UI/StyledButton';
import Engine from '../../../core/Engine';
import { colors, fontStyles } from '../../../styles/common';
import { strings } from '../../../../locales/i18n';
import SecureKeychain from '../../../core/SecureKeychain';
import AppConstants from '../../../core/AppConstants';
import setOnboardingWizardStep from '../../../actions/wizard';
import DeviceItem from './DeviceItem'
import Device from '../../../util/device';
import {
	SEED_PHRASE_HINTS,
	BIOMETRY_CHOICE_DISABLED,
	NEXT_MAKER_REMINDER,
	ONBOARDING_WIZARD,
	EXISTING_USER,
	METRICS_OPT_IN,
	TRUE
} from '../../../constants/storage';
import Logger from '../../../util/Logger';
import { getPasswordStrengthWord, passwordRequirementsMet, MIN_PASSWORD_LENGTH } from '../../../util/password';
import importAdditionalAccounts from '../../../util/importAdditionalAccounts';
import TransportBLE from '../../../../secuX_Connect/dist/lib/connect/devices/BleTransport'
import SecuxConnect, { TRANSPORT } from '../../../../secuX_Connect/dist/native'

const styles = StyleSheet.create({
	mainWrapper: {
		backgroundColor: colors.white,
		flex: 1
	},
	wrapper: {
		flex: 1,
		paddingHorizontal: 32
	},
	title: {
		fontSize: Device.isAndroid() ? 20 : 25,
		marginTop: 20,
		marginBottom: 20,
		color: colors.fontPrimary,
		justifyContent: 'center',
		textAlign: 'center',
		...fontStyles.bold
	},
	field: {
		marginVertical: 5,
		position: 'relative'
	},
	fieldRow: {
		flexDirection: 'row',
		alignItems: 'flex-end'
	},
	fieldCol: {
		width: '70%'
	},
	fieldColRight: {
		flexDirection: 'row-reverse',
		width: '30%'
	},
	label: {
		color: colors.black,
		fontSize: 16,
		marginBottom: 12,
		...fontStyles.normal
	},
	ctaWrapper: {
		marginTop: 20
	},
	errorMsg: {
		color: colors.red,
		textAlign: 'center',
		...fontStyles.normal
	},
	padding: {
		paddingRight: 46
	},
	inputFocused: {
		borderColor: colors.blue,
		borderWidth: 2
	},
	input: {
		...fontStyles.normal,
		fontSize: 16,
		paddingTop: 2
	}
});

const PASSCODE_NOT_SET_ERROR = 'Error: Passcode not set.';

const strToBuffer = (str) => {
	const bufArray = [];
	for (let i = 0; i < str.length; i += 1) {
	  bufArray[i] = str.charCodeAt(i);
	}
	return Buffer.from(bufArray);
  };

const deviceAddition = (device) => ({ devices }) => {
	return {
	  devices: devices.some((i) => i.id === device.id)
		? devices
		: devices.concat(device),
	}
  }

/**
 * View where users can set restore their account
 * using a seed phrase
 */
class ScanConnectSecux extends PureComponent {
	static navigationOptions = ({ navigation, route }) => getOnboardingNavbarOptions(navigation, route);

	static propTypes = {
		/**
		 * The navigator object
		 */
		navigation: PropTypes.object,
		/**
		 * The action to update the password set flag
		 * in the redux store
		 */
		passwordSet: PropTypes.func,
		/**
		 * The action to set the locktime
		 * in the redux store
		 */
		setLockTime: PropTypes.func,
		/**
		 * The action to update the seedphrase backed up flag
		 * in the redux store
		 */
		seedphraseBackedUp: PropTypes.func,
		/**
		 * Action to set onboarding wizard step
		 */
		setOnboardingWizardStep: PropTypes.func
	};

	state = {
		password: '',
		loading: false,
		error: null,
		devices: this.props.defaultDevices ? this.props.defaultDevices : [],
		deviceId: null,
		error: null,
		refreshing: false,
		waiting: false,
	};

	_subscriptions: ?{ unsubscribe: () => any } = null
	_bluetoothEnabled: ?boolean = null
	_transportLib: Object = null
	_isMounted: boolean = false

	

	startScan = () => {
		this.setState({ refreshing: true })
	
		this._subscriptions = this._transportLib.listen({
		  complete: () => {
			Logger.log('listen: subscription completed')
			this.setState({ refreshing: false })
		  },
		  next: (e) => {
			if (e.type === 'add') {
			  Logger.log('listen: new device detected')
	
			  // with bluetooth, new devices are appended in the screen
			  this.setState(deviceAddition(e.descriptor))
	
			}
		  },
		  error: (error) => {
			this.setState({ error, refreshing: false, devices: [] })
		  },
		})
	  }

	  _unsubscribe: () => void = () => {
		if (this._subscriptions != null) {
		  this._subscriptions.unsubscribe()
		  this._subscriptions = null
		}
	  }
	  _setStateSafe: (InexactSubset<State>) => void = (newState) => {
    if (this._isMounted) this.setState(newState)
  }
	  reload = () => {
		this._unsubscribe()
		this._setStateSafe({
		  devices: this.props.defaultDevices ? this.props.defaultDevices : [],
		  deviceId: null,
		  error: null,
		  refreshing: false,
		})
		this.startScan()
	  }
	
	  _onSelectDevice = async (device) => {
		if (this.state.deviceId != null) return
		this._unsubscribe()
		const { onConnectBLE } = this.props
		try {
		  if (device.id == null) {
			// should never happen
			throw new Error('device id is null')
		  }
		  this.secuxConnect = await SecuxConnect.connectDevice(TRANSPORT.REACT_NATIVE_BLE, { deviceId: device.id.toString() })
		  this.setState({
			deviceId: device.id.toString(),
			refreshing: false,
			waiting: true,
		  })
		  await this.secuxConnect.send(strToBuffer("42960705"));
		  this.props.onConnectBLE(true)
		  this.setState({ refreshing: false })

		} catch (e) {
		  Logger.log(e)
		  if (e instanceof RejectedByUserError) {
			this.reload()
			return
		  }
		  this._setStateSafe({ error: e })
		} finally {
		  this._setStateSafe({ waiting: false })
		}
	  }
	
	  renderItem = ({item}: {item: Device}) => (
		<DeviceItem device={item} onSelect={() => this._onSelectDevice(item)} />
	  )
	
	  ListHeader = () => {
		const { error, waiting } = this.state
		const { intl, onWaitingMessage } = this.props
	
		const ListHeaderWrapper = ({ msg, err }: { msg: string, err: ?string }) => (
		  <View style={styles.listHeader}>
			<Text style={[styles.paragraph, styles.paragraphText]}>{msg}</Text>
			{err != null && (
			  <Text style={[styles.error, styles.paragraphText]}>{err}</Text>
			)}
		  </View>
		)
		let msg, errMsg
		if (error != null) {
		  msg = intl.formatMessage(messages.error)
		  if (error instanceof LocalizableError) {
			errMsg = intl.formatMessage({
			  id: error.id,
			  defaultMessage: error.defaultMessage,
			})
		  } else {
			errMsg = String(error.message)
		  }
		} else {
		  if (waiting && typeof onWaitingMessage !== 'undefined') {
			msg = onWaitingMessage
		  }
		}
		if (msg == null) return null
		return <ListHeaderWrapper msg={msg} err={errMsg} />
	  }
	

	async componentDidMount() {
		this._transportLib = TransportBLE
		this._isMounted = true
		if (Platform.OS === 'android') {
		  await PermissionsAndroid.request(
			PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
		  )
		}
		// check if bluetooth is available
		// no need to save a reference to this subscription's unsubscribe func
		// as it's just an empty method. Rather, we make sure sate is only
		// modified when component is mounted
		let previousAvailable = false
		TransportBLE.observeState({
		  next: (e) => {
			if (this._isMounted) {
			  Logger.log('BLE observeState event', e)
			  if (this._bluetoothEnabled == null && !e.available) {
				this.setState({
				  error: new BluetoothDisabledError(),
				  refreshing: false,
				})
			  }
			  if (e.available !== previousAvailable) {
				previousAvailable = e.available
				this._bluetoothEnabled = e.available
				if (e.available) {
				  this.reload()
				} else {
				  this.setState({
					error: new BluetoothDisabledError(),
					refreshing: false,
					devices: [],
				  })
				}
			  }
			}
		  },
		})
		this.startScan()
	}

	onPressImport = async () => {
		const { loading, seed, password, confirmPassword } = this.state;

		try {
			this.setState({ loading: true });

			const { KeyringController } = Engine.context;
			await Engine.resetState();
			await AsyncStorage.removeItem(NEXT_MAKER_REMINDER);
			await KeyringController.useSecuXHardwareWallet(this.secuxConnect);

			const onboardingWizard = await AsyncStorage.getItem(ONBOARDING_WIZARD);
			// Check if user passed through metrics opt-in screen
			// const metricsOptIn = await AsyncStorage.getItem(METRICS_OPT_IN);
			// mark the user as existing so it doesn't see the create password screen again
			await AsyncStorage.setItem(EXISTING_USER, TRUE);
			console.log("ScanConnectSecux Setting Existing User")
			// await AsyncStorage.removeItem(SEED_PHRASE_HINTS);
			this.setState({ loading: false });

			console.log("ScanConnectSecux: setOnboardingWizardStep(1)")
			this.props.setOnboardingWizardStep(1);
			this.props.navigation.navigate('HomeNav', { screen: 'WalletView' });
			console.log("ScanConnectSecux: this.props.navigation.navigate('HomeNav', { screen: 'WalletView' })")

			console.log("ScanConnectSecux: importAdditionalAccounts")
			await importAdditionalAccounts();
		} catch (error) {
			// Should we force people to enable passcode / biometrics?
			if (error.toString() === PASSCODE_NOT_SET_ERROR) {
				Alert.alert(
					'Security Alert',
					'In order to proceed, you need to turn Passcode on or any biometrics authentication method supported in your device (FaceID, TouchID or Fingerprint)'
				);
				this.setState({ loading: false });
			} else {
				this.setState({ loading: false, error: error.toString() });
				Logger.log('Error with seed phrase import', error);
			}
		}
	};


	render() {
		const {
			loading,
			error,
			devices,
			refreshing,
			deviceId,
			waiting,
		} = this.state;


		return (
			<SafeAreaView style={styles.mainWrapper}>
				<KeyboardAwareScrollView style={styles.wrapper} resetScrollToCoords={{ x: 0, y: 0 }}>
					<View testID={'import-from-seed-screen'}>
						<Text style={styles.title}>{'Scan Connect Secux'}</Text>

						<View style={styles.ctaWrapper}>
							<StyledButton
								type={'blue'}
								onPress={this.onPressImport}
								testID={'submit'}
							>
								{loading ? (
									<ActivityIndicator size="small" color="white" />
								) : (
									strings('import_from_seed.import_button')
								)}
							</StyledButton>
						</View>
					</View>
				</KeyboardAwareScrollView>


				<FlatList
					extraData={[error, deviceId]}
					style={styles.flatList}
					contentContainerStyle={styles.flatListContentContainer}
					data={devices}
					renderItem={this.renderItem}
					ListHeaderComponent={this.ListHeader}
					keyExtractor={(item) => item.id.toString()}
					refreshControl={
						<RefreshControl
							onRefresh={this.reload}
							refreshing={refreshing}
							progressViewOffset={74 /* approx. the size of one elem */}
						/>
					}
				/>

			</SafeAreaView>
		);
	}
}

const mapDispatchToProps = dispatch => ({
	setLockTime: time => dispatch(setLockTime(time)),
	setOnboardingWizardStep: step => dispatch(setOnboardingWizardStep(step)),
	passwordSet: () => dispatch(passwordSet()),
	seedphraseBackedUp: () => dispatch(seedphraseBackedUp())
});

export default connect(
	null,
	mapDispatchToProps
)(ScanConnectSecux);
