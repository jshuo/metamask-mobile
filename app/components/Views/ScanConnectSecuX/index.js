import React, { PureComponent } from 'react';
import PropTypes from 'prop-types';
import {
	Switch,
	ActivityIndicator,
	Alert,
	TouchableOpacity,
	Text,
	View,
	TextInput,
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

	async componentDidMount() {
		const biometryType = await SecureKeychain.getSupportedBiometryType();
		if (biometryType) {
			let enabled = true;
			const previouslyDisabled = await AsyncStorage.removeItem(BIOMETRY_CHOICE_DISABLED);
			if (previouslyDisabled && previouslyDisabled === TRUE) {
				enabled = false;
			}
			this.setState({ biometryType: Device.isAndroid() ? 'biometrics' : biometryType, biometryChoice: enabled });
		}
		// Workaround https://github.com/facebook/react-native/issues/9958
		setTimeout(() => {
			this.setState({ inputWidth: { width: '100%' } });
		}, 100);
	}

	onPressImport = async () => {
		const { loading, seed, password, confirmPassword } = this.state;

			try {
				this.setState({ loading: true });

				const { KeyringController } = Engine.context;
				await Engine.resetState();
				await AsyncStorage.removeItem(NEXT_MAKER_REMINDER);
				await KeyringController.useSecuXHardwareWallet(password);


				if (this.state.biometryType && this.state.biometryChoice) {
					await SecureKeychain.setGenericPassword(password, SecureKeychain.TYPES.BIOMETRICS);
				} else if (this.state.rememberMe) {
					await SecureKeychain.setGenericPassword(password, SecureKeychain.TYPES.REMEMBER_ME);
				} else {
					await SecureKeychain.resetGenericPassword();
				}
				// Get onboarding wizard state
				const onboardingWizard = await AsyncStorage.getItem(ONBOARDING_WIZARD);
				// Check if user passed through metrics opt-in screen
				const metricsOptIn = await AsyncStorage.getItem(METRICS_OPT_IN);
				// mark the user as existing so it doesn't see the create password screen again
				await AsyncStorage.setItem(EXISTING_USER, TRUE);
				console.log ("ScanConnectSecux Setting Existing User")
				await AsyncStorage.removeItem(SEED_PHRASE_HINTS);
				this.setState({ loading: false });
				if (!metricsOptIn) {
					this.props.navigation.navigate('OptinMetrics');
					console.log ("this.props.navigation.navigate('OptinMetrics')")
				} else if (onboardingWizard) {
					this.props.navigation.navigate('HomeNav');
					console.log ("this.props.navigation.navigate('HomeNav'")
				} else {
					console.log ("ScanConnectSecux: setOnboardingWizardStep(1)")
					this.props.setOnboardingWizardStep(1);
					this.props.navigation.navigate('HomeNav', { screen: 'WalletView' });
					console.log ("ScanConnectSecux: this.props.navigation.navigate('HomeNav', { screen: 'WalletView' })")
				}
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

	onBiometryChoiceChange = value => {
		this.setState({ biometryChoice: value });
	};


	onPasswordChange = val => {
		const passInfo = zxcvbn(val);

		this.setState({ password: val, passwordStrength: passInfo.score });
	};

	onPasswordConfirmChange = val => {
		this.setState({ confirmPassword: val });
	};

	jumpToPassword = () => {
		const { current } = this.passwordInput;
		current && current.focus();
	};

	jumpToConfirmPassword = () => {
		const { current } = this.confirmPasswordInput;
		current && current.focus();
	};

	updateBiometryChoice = async biometryChoice => {
		if (!biometryChoice) {
			await AsyncStorage.setItem(BIOMETRY_CHOICE_DISABLED, TRUE);
		} else {
			await AsyncStorage.removeItem(BIOMETRY_CHOICE_DISABLED);
		}
		this.setState({ biometryChoice });
	};

	renderSwitch = () => {
		if (this.state.biometryType) {
			return (
				<View style={styles.biometrics}>
					<Text style={styles.biometryLabel}>
						{strings(`biometrics.enable_${this.state.biometryType.toLowerCase()}`)}
					</Text>
					<Switch
						onValueChange={this.updateBiometryChoice}
						value={this.state.biometryChoice}
						style={styles.biometrySwitch}
						trackColor={Device.isIos() ? { true: colors.green300, false: colors.grey300 } : null}
						ios_backgroundColor={colors.grey300}
					/>
				</View>
			);
		}

		return (
			<View style={styles.biometrics}>
				<Text style={styles.biometryLabel}>{strings(`choose_password.remember_me`)}</Text>
				<Switch
					onValueChange={rememberMe => this.setState({ rememberMe })} // eslint-disable-line react/jsx-no-bind
					value={this.state.rememberMe}
					style={styles.biometrySwitch}
					trackColor={Device.isIos() ? { true: colors.green300, false: colors.grey300 } : null}
					ios_backgroundColor={colors.grey300}
				/>
			</View>
		);
	};

	toggleShowHide = () => {
		this.setState({ secureTextEntry: !this.state.secureTextEntry });
	};

	toggleHideSeedPhraseInput = () => {
		this.setState(({ hideSeedPhraseInput }) => ({ hideSeedPhraseInput: !hideSeedPhraseInput }));
	};

	onQrCodePress = () => {
		setTimeout(this.toggleHideSeedPhraseInput, 100);
		this.props.navigation.navigate('QRScanner', {
			onScanSuccess: ({ seed = undefined }) => {
				if (seed) {
					this.setState({ seed });
				} else {
					Alert.alert(
						strings('import_from_seed.invalid_qr_code_title'),
						strings('import_from_seed.invalid_qr_code_message')
					);
				}
				this.toggleHideSeedPhraseInput();
			},
			onScanError: error => {
				this.toggleHideSeedPhraseInput();
			}
		});
	};

	seedphraseInputFocused = () => this.setState({ seedphraseInputFocused: !this.state.seedphraseInputFocused });

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

		const passwordStrengthWord = getPasswordStrengthWord(passwordStrength);

		return (
			<SafeAreaView style={styles.mainWrapper}>
				<KeyboardAwareScrollView style={styles.wrapper} resetScrollToCoords={{ x: 0, y: 0 }}>
					<View testID={'import-from-seed-screen'}>
						<Text style={styles.title}>{'Scan Connect Secux'}</Text>
						<View style={styles.fieldRow}>
							<View style={styles.fieldCol}>
								<Text style={styles.label}>{strings('choose_password.seed_phrase')}</Text>
							</View>
							<View style={[styles.fieldCol, styles.fieldColRight]}>
								<TouchableOpacity onPress={this.toggleHideSeedPhraseInput}>
									<Text style={styles.label}>
										{strings(`choose_password.${hideSeedPhraseInput ? 'show' : 'hide'}`)}
									</Text>
								</TouchableOpacity>
							</View>
						</View>
						<View style={styles.field}>
							<View style={styles.fieldRow}>
								<View style={styles.fieldCol}>
									<Text style={styles.label}>{strings('import_from_seed.new_password')}</Text>
								</View>
								<View style={[styles.fieldCol, styles.fieldColRight]}>
									<TouchableOpacity onPress={this.toggleShowHide}>
										<Text style={styles.label}>
											{strings(`choose_password.${secureTextEntry ? 'show' : 'hide'}`)}
										</Text>
									</TouchableOpacity>
								</View>
							</View>

						</View>

						<View style={styles.field}>
							<Text style={styles.label}>{strings('import_from_seed.confirm_password')}</Text>
							<OutlinedTextField
								style={styles.input}
								containerStyle={inputWidth}
								ref={this.confirmPasswordInput}
								testID={'input-password-field-confirm'}
								onChangeText={this.onPasswordConfirmChange}
								returnKeyType={'next'}
								autoCapitalize="none"
								secureTextEntry={secureTextEntry}
								placeholder={strings('import_from_seed.confirm_password')}
								value='secux4296'
								baseColor={colors.grey500}
								tintColor={colors.blue}
								onSubmitEditing={this.onPressImport}
							/>

						</View>

						{this.renderSwitch()}


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
				<View style={styles.termsAndConditions}>
					<TermsAndConditions
						navigation={this.props.navigation}
						action={strings('import_from_seed.import_button')}
					/>
				</View>
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
