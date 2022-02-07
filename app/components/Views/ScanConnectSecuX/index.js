import React, { PureComponent } from 'react';
import { logOut } from '../../../actions/user';
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
} from 'react-native';
import AsyncStorage from '@react-native-community/async-storage';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { connect } from 'react-redux';
import Engine from '../../../core/Engine';
import { colors, fontStyles } from '../../../styles/common';
import DeviceItem from './DeviceItem'
import Device from '../../../util/device';
import {
    SECUX_DEVICE_ID,
    NEXT_MAKER_REMINDER,
    EXISTING_USER,
    TRUE
} from '../../../constants/storage';
import Logger from '../../../util/Logger';
import { SecuxReactNativeBLE } from "@secux/transport-reactnative";
import Dialog from 'react-native-dialog';
import { changeBLEStatus, connectedDevice } from '../../../actions/bleTransport';
import setOnboardingWizardStep from '../../../actions/wizard';


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
    },
    activityIndicator: {
        paddingVertical: 64,
    },
});


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
        transport: this.props.transport,
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

    handleDisconnected = async () => {
        Logger.log('BLE device disconnected')
        this.props.changeBLEStatus('disconnected')
        const { KeyringController } = Engine.context;
        // don't comment out setLocked() or disconnected from 
        // from device will cause hang between device and app data
        // transfer or reset EngineState
		await KeyringController.setLocked();
        await Engine.resetState();
        this.props.navigation.navigate('OnboardingRootNav', {
            screen: 'OnboardingNav',
            params: { screen: 'Onboarding' },
        });
    }
    handleConnected = () => {
        Logger.log('BLE device connected')
    }
    _onSelectDevice = async (device) => {
        SecuxReactNativeBLE.StopScan();
        if (this.state.deviceId != null) return
        try {
            if (device.id == null) {
                // should never happen
                throw new Error('device id is null')
            }
            const transport = await SecuxReactNativeBLE.Create(device.id, this.handleConnected, this.handleDisconnected);
            await transport.Connect();
            this.setState({
                deviceId: device.id,
                refreshing: false,
                waiting: true,
                transport: transport
            })
            // secux hack
            let otp = '42960705'
            console.log(otp)
            await transport.SendOTP(otp);

            // show otp dialog
            // this.setState({ showDialog: true });

            // this.setState({ refreshing: false })
            this.onConnectBLE();

        } catch (e) {
            Logger.log(e)
        } finally {
            Logger.log('_onSelectDevice done')
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
        this.props.changeBLEStatus('disconnected')
        if (Platform.OS === 'android') {
            await PermissionsAndroid.request(
                PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
            )
        }

        this.setState(this.state);
        SecuxReactNativeBLE.StartScan(this._AddDevice, this._DeleteDevice);
    }

    onConnectBLE = async () => {

        try {
            this.setState({ loading: true });

            const { KeyringController } = Engine.context;
            await Engine.resetState();

            await AsyncStorage.removeItem(NEXT_MAKER_REMINDER);
            this.props.changeBLEStatus('locked')
            this.props.changeBLEStatus('connected')
            await KeyringController.useSecuXHardwareWallet(this.state.deviceId, this.state.transport);
            await AsyncStorage.setItem(SECUX_DEVICE_ID, this.state.deviceId);
            await AsyncStorage.setItem(EXISTING_USER, TRUE);
            this.setState({ loading: false });
            this.props.setOnboardingWizardStep(0);
            this.props.navigation.replace('HomeNav', { 
                screen: 'WalletView'});
            this.props.connectedDevice(this.state.transport)
            // await importAdditionalAccounts();
        } catch (error) {
            console.log('onConnectBLE Error: ', error)

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
                    <Text style={styles.title}>{'Scan and Connect Secux Device over Bluetooth'}</Text>
                    <Text style={styles.label}>{'Before continuing, please make sure that:'}</Text>
                    <Text style={styles.label}>{'- Bluetooth is enabled on your Smartphone'}</Text>
                    <Text style={styles.label}>{'- SecuX Device is turned on'}</Text>
                    <Text style={styles.label}>{'- Upon turning on bluetooth on smartphone and device, the device name should appear on the screen to click for pairing connection'}</Text>
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
                <View style={styles.activityIndicator}>
                {waiting && <ActivityIndicator size="large" color="#0000ff" />}
                </View>
            </SafeAreaView>
        );
    }
}

const mapDispatchToProps = (dispatch) => ({
    setOnboardingWizardStep: (step) => dispatch(setOnboardingWizardStep(step)),
    connectedDevice: (transport) => dispatch(connectedDevice(transport)),
    changeBLEStatus: (status) => dispatch(changeBLEStatus(status)),
    logOut: () => dispatch(logOut()),
});
export default connect(
    null,
    mapDispatchToProps
)(ScanConnectSecux);
