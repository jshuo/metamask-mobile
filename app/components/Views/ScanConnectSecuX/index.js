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
import { SecuxReactNativeBLE } from "@secux/transport-reactnative";
import Dialog from 'react-native-dialog';


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


/**
 * View where users can set restore their account
 * using a seed phrase
 */
class ScanConnectSecux extends PureComponent {

    state = {
        password: '',
        loading: false,
        error: null,
        devices: this.props.defaultDevices ? this.props.defaultDevices : [],
        deviceId: null,
        error: null,
        refreshing: false,
        waiting: false,
        transport: null,
        otp: '',
        showDialog: false,
    };

    _isMounted: boolean = false

    _setStateSafe: (InexactSubset<State>) => void = (newState) => {
        if (this._isMounted) this.setState(newState)
    }

    reload = () => {
        this._setStateSafe({
            devices: this.props.defaultDevices ? this.props.defaultDevices : [],
            deviceId: null,
            error: null,
            refreshing: false,
        })
        SecuxReactNativeBLE.StartScan(this._AddDevice, this._DeleteDevice);
    }

    _onSelectDevice = async (device) => {
        SecuxReactNativeBLE.StopScan();
        if (this.state.deviceId != null) return

        const { onConnectBLE } = this.props
        try {
            if (device.id == null) {
                // should never happen
                throw new Error('device id is null')
            }
            const transport = await SecuxReactNativeBLE.Create(device.id);
            await transport.Connect();
            this.setState({
                deviceId: device.id,
                refreshing: false,
                waiting: true,
                transport
            })
            // let otp = '42960705'
            // console.log(otp)
            // await transport.SendOTP(otp);

            // show otp dialog
            this.setState({ showDialog: true });

            this.setState({ refreshing: false })
            // this.onConnectBLE();

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

    renderItem = ({ item }: { item: Device }) => (
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
        this._isMounted = true
        if (Platform.OS === 'android') {
            await PermissionsAndroid.request(
                PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
            )
        }

        this.setState(this.state);
        SecuxReactNativeBLE.StartScan(this._AddDevice, this._DeleteDevice);
    }

    onConnectBLE = async () => {
        const { loading, seed, password, confirmPassword } = this.state;

        try {
            this.setState({ loading: true });

            const { KeyringController } = Engine.context;
            await Engine.resetState();
            await AsyncStorage.removeItem(NEXT_MAKER_REMINDER);
            await KeyringController.useSecuXHardwareWallet(this.state.deviceId, this.state.transport);
            // Check if user passed through metrics opt-in screen
            // const metricsOptIn = await AsyncStorage.getItem(METRICS_OPT_IN);
            // mark the user as existing so it doesn't see the create password screen again
            await AsyncStorage.setItem(EXISTING_USER, TRUE);
            console.log("ScanConnectSecux Setting Existing User")
            // await AsyncStorage.removeItem(SEED_PHRASE_HINTS);
            this.setState({ loading: false });

            this.props.navigation.navigate('HomeNav', {
                screen: 'WalletView', params: {
                    secuxDeviceHandle: this.state.transport
                }
            });
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

    otp_processing = async () => {
        const success = await this.state.transport.SendOTP(this.state.otp);

        if (success) {
            this.setState({ showDialog: false });
            await this.onConnectBLE();
        }
    };


    _AddDevice = (device) => {
        this.setState({ devices: [...this.state.devices, device] });
    };

    _DeleteDevice = (device) => {
        this.setState({ devices: this.state.devices.filter(x => x.id !== device.id) });
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
                    {/* <View testID={'import-from-seed-screen'}>
						<Text style={styles.title}>{'Scan Connect Secux'}</Text>

						<View style={styles.ctaWrapper}>
							<StyledButton
								type={'blue'}
								onPress={this.onConnectBLE}
								testID={'submit'}
							>
								{loading ? (
									<ActivityIndicator size="small" color="white" />
								) : ('On Connect BLE ')}
							</StyledButton>
						</View>
					</View> */}
                </KeyboardAwareScrollView>


                <FlatList
                    extraData={[error, deviceId]}
                    style={styles.flatList}
                    contentContainerStyle={styles.flatListContentContainer}
                    data={devices}
                    renderItem={this.renderItem}
                    keyExtractor={(item) => item.id.toString()}
                />

                <View>
                    <Dialog.Container visible={this.state.showDialog}>
                        <Dialog.Title style={{ color: "black" }}>OTP Authentication</Dialog.Title>
                        <Dialog.Input style={{ color: "black" }} onChangeText={(otp) => this.setState({ otp })} />
                        <Dialog.Button label="OK" onPress={this.otp_processing} />
                    </Dialog.Container>
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
