import React, { PureComponent } from 'react';
import PropTypes from 'prop-types';
import {
	Switch,
	ActivityIndicator,
	Alert,
	TouchableOpacity,
	Text,
	View,
	PermissionsAndroid,
	SafeAreaView,
	StyleSheet
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
import TermsAndConditions from '../TermsAndConditions';
import zxcvbn from 'zxcvbn';
import Icon from 'react-native-vector-icons/FontAwesome';
import Device from '../../../util/device';
import { failedSeedPhraseRequirements, isValidMnemonic, parseSeedPhrase } from '../../../util/validators';
import { OutlinedTextField } from 'react-native-material-textfield';
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
// import SecuxConnect, { TRANSPORT } from '../../../../secuX_Connect/dist/native'r

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
	seedPhrase: {
		marginBottom: 10,
		paddingTop: 20,
		paddingBottom: 20,
		paddingHorizontal: 20,
		fontSize: 20,
		borderRadius: 10,
		minHeight: 110,
		height: 'auto',
		borderWidth: 1,
		borderColor: colors.grey500,
		backgroundColor: colors.white,
		...fontStyles.normal
	},
	padding: {
		paddingRight: 46
	},
	biometrics: {
		alignItems: 'flex-start',
		marginTop: 10
	},
	biometryLabel: {
		flex: 1,
		fontSize: 16,
		color: colors.black,
		...fontStyles.normal
	},
	biometrySwitch: {
		marginTop: 10,
		flex: 0
	},
	termsAndConditions: {
		paddingVertical: 10
	},
	passwordStrengthLabel: {
		height: 20,
		fontSize: 15,
		color: colors.black,
		...fontStyles.normal
	},
	// eslint-disable-next-line react-native/no-unused-styles
	strength_weak: {
		color: colors.red
	},
	// eslint-disable-next-line react-native/no-unused-styles
	strength_good: {
		color: colors.blue
	},
	// eslint-disable-next-line react-native/no-unused-styles
	strength_strong: {
		color: colors.green300
	},
	showMatchingPasswords: {
		position: 'absolute',
		top: 52,
		right: 17,
		alignSelf: 'flex-end'
	},
	qrCode: {
		marginRight: 10,
		borderWidth: 1,
		borderRadius: 6,
		borderColor: colors.grey100,
		paddingVertical: 4,
		paddingHorizontal: 6,
		marginTop: -50,
		marginBottom: 30,
		alignSelf: 'flex-end'
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
		confirmPassword: '',
		seed: '',
		biometryType: null,
		rememberMe: false,
		secureTextEntry: true,
		biometryChoice: false,
		loading: false,
		error: null,
		seedphraseInputFocused: false,
		inputWidth: { width: '99%' },
		hideSeedPhraseInput: true
	};

	passwordInput = React.createRef();
	confirmPasswordInput = React.createRef();

	startScan = () => {
		this.setState({ refreshing: true })
	
		this._subscriptions = this._transportLib.listen({
		  complete: () => {
			Logger.debug('listen: subscription completed')
			this.setState({ refreshing: false })
		  },
		  next: (e) => {
			if (e.type === 'add') {
			  Logger.debug('listen: new device detected')
	
			  // with bluetooth, new devices are appended in the screen
			  this.setState(deviceAddition(e.descriptor))
	
			}
		  },
		  error: (error) => {
			this.setState({ error, refreshing: false, devices: [] })
		  },
		})
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
			  Logger.debug('BLE observeState event', e)
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
				await KeyringController.useSecuXHardwareWallet(password);


				// if (this.state.biometryType && this.state.biometryChoice) {
				// 	await SecureKeychain.setGenericPassword(password, SecureKeychain.TYPES.BIOMETRICS);
				// } else if (this.state.rememberMe) {
				// 	await SecureKeychain.setGenericPassword(password, SecureKeychain.TYPES.REMEMBER_ME);
				// } else {
				// 	await SecureKeychain.resetGenericPassword();
				// }
				// Get onboarding wizard state
				const onboardingWizard = await AsyncStorage.getItem(ONBOARDING_WIZARD);
				// Check if user passed through metrics opt-in screen
				// const metricsOptIn = await AsyncStorage.getItem(METRICS_OPT_IN);
				// mark the user as existing so it doesn't see the create password screen again
				await AsyncStorage.setItem(EXISTING_USER, TRUE);
				console.log ("ScanConnectSecux Setting Existing User")
				// await AsyncStorage.removeItem(SEED_PHRASE_HINTS);
				this.setState({ loading: false });

					console.log ("ScanConnectSecux: setOnboardingWizardStep(1)")
					this.props.setOnboardingWizardStep(1);
					this.props.navigation.navigate('HomeNav', { screen: 'WalletView' });
					console.log ("ScanConnectSecux: this.props.navigation.navigate('HomeNav', { screen: 'WalletView' })")

				console.log ("ScanConnectSecux: importAdditionalAccounts")
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
			password,
			passwordStrength,
			confirmPassword,
			inputWidth,
			secureTextEntry,
			error,
			loading,
			hideSeedPhraseInput
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
