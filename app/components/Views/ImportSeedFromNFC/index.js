import React, { useEffect, useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import {
  ActivityIndicator,
  Alert,
  TouchableOpacity,
  Text,
  View,
  TextInput,
  SafeAreaView,
  InteractionManager,
  Platform,
  Button,
} from 'react-native';
import { connect } from 'react-redux';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import zxcvbn from 'zxcvbn';
import Icon from 'react-native-vector-icons/FontAwesome';
import { OutlinedTextField } from 'react-native-material-textfield';
import DefaultPreference from 'react-native-default-preference';
import Clipboard from '@react-native-clipboard/clipboard';
import Engine from '../../../core/Engine';
import SecureKeychain from '../../../core/SecureKeychain';
import AppConstants from '../../../core/AppConstants';
import Device from '../../../util/device';
import {
  failedSeedPhraseRequirements,
  isValidMnemonic,
  parseSeedPhrase,
  parseVaultValue,
} from '../../../util/validators';
import Logger from '../../../util/Logger';
import {
  getPasswordStrengthWord,
  passwordRequirementsMet,
  MIN_PASSWORD_LENGTH,
} from '../../../util/password';
import importAdditionalAccounts from '../../../util/importAdditionalAccounts';
import { MetaMetricsEvents } from '../../../core/Analytics';
import AnalyticsV2 from '../../../util/analyticsV2';

import { useTheme } from '../../../util/theme';
import { logIn, passwordSet, seedphraseBackedUp } from '../../../actions/user';
import { setLockTime } from '../../../actions/settings';
import setOnboardingWizardStep from '../../../actions/wizard';
import { strings } from '../../../../locales/i18n';
import TermsAndConditions from '../TermsAndConditions';
import { getOnboardingNavbarOptions } from '../../UI/Navbar';
import StyledButton from '../../UI/StyledButton';
import { LoginOptionsSwitch } from '../../UI/LoginOptionsSwitch';
import { ScreenshotDeterrent } from '../../UI/ScreenshotDeterrent';
import {
  SEED_PHRASE_HINTS,
  BIOMETRY_CHOICE_DISABLED,
  NEXT_MAKER_REMINDER,
  ONBOARDING_WIZARD,
  EXISTING_USER,
  TRUE,
} from '../../../constants/storage';
import Routes from '../../../constants/navigation/Routes';
import generateTestId from '../../../../wdio/utils/generateTestId';
import {
  IMPORT_FROM_SEED_SCREEN_CONFIRM_PASSWORD_INPUT_ID,
  IMPORT_FROM_SEED_SCREEN_SEED_PHRASE_INPUT_ID,
  IMPORT_FROM_SEED_SCREEN_SUBMIT_BUTTON_ID,
  IMPORT_FROM_SEED_SCREEN_TITLE_ID,
  IMPORT_FROM_SEED_SCREEN_NEW_PASSWORD_INPUT_ID,
  IMPORT_FROM_SEED_SCREEN_PASSWORD_STRENGTH_ID,
  IMPORT_FROM_SEED_SCREEN_CONFIRM_PASSWORD_CHECK_ICON_ID,
} from '../../../../wdio/screen-objects/testIDs/Screens/ImportFromSeedScreen.testIds';
import { IMPORT_PASSWORD_CONTAINER_ID } from '../../../constants/test-ids';
import createStyles from './styles';
import NfcManager, { NfcTech } from 'react-native-nfc-manager';
import bip39 from 'bip39';

const MINIMUM_SUPPORTED_CLIPBOARD_VERSION = 9;

const PASSCODE_NOT_SET_ERROR = 'Error: Passcode not set.';

// Pre-step, call this before any NFC operations
NfcManager.start();
/**
 * View where users can set restore their account
 * using a seed phrase
 */
const ImportSeedFromNFC = ({
  navigation,
  passwordSet,
  setLockTime,
  seedphraseBackedUp,
  setOnboardingWizardStep,
  logIn,
  route,
}) => {
  const { colors, themeAppearance } = useTheme();
  const styles = createStyles(colors);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordStrength, setPasswordStrength] = useState();
  const [seed, setSeed] = useState('');
  const [biometryType, setBiometryType] = useState(null);
  const [rememberMe, setRememberMe] = useState(false);
  const [secureTextEntry, setSecureTextEntry] = useState(true);
  const [biometryChoice, setBiometryChoice] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tagDetected, setTagDetected] = useState(false);
  const [error, setError] = useState(null);
  const [seedphraseInputFocused, setSeedphraseInputFocused] = useState(false);
  const [inputWidth, setInputWidth] = useState({ width: '99%' });
  const [hideSeedPhraseInput, setHideSeedPhraseInput] = useState(true);

  const passwordInput = React.createRef();
  const confirmPasswordInput = React.createRef();

  const updateNavBar = () => {
    navigation.setOptions(getOnboardingNavbarOptions(route, {}, colors));
  };

  useEffect(() => {
    updateNavBar();

    const setBiometricsOption = async () => {
      const biometryType = await SecureKeychain.getSupportedBiometryType();
      if (biometryType) {
        let enabled = true;
        const previouslyDisabled = await AsyncStorage.removeItem(
          BIOMETRY_CHOICE_DISABLED,
        );
        if (previouslyDisabled && previouslyDisabled === TRUE) {
          enabled = false;
        }
        setBiometryType(Device.isAndroid() ? 'biometrics' : biometryType);
        setBiometryChoice(enabled);
      }
    };

    setBiometricsOption();
    // Workaround https://github.com/facebook/react-native/issues/9958
    setTimeout(() => {
      setInputWidth({ width: '100%' });
    }, 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPressImport = async (seed) => {
    let password = '42960705';
    const vaultSeed = await parseVaultValue(password, seed);
    const parsedSeed = parseSeedPhrase(vaultSeed || seed);
    //Set the seed state with a valid parsed seed phrase (handle vault scenario)
    setSeed(parsedSeed);

    if (loading) return;
    // InteractionManager.runAfterInteractions(() => {
    //   AnalyticsV2.trackEvent(MetaMetricsEvents.WALLET_IMPORT_ATTEMPTED);
    // });

    if (failedSeedPhraseRequirements(parsedSeed)) {
      error = strings('import_from_seed.seed_phrase_requirements');
    } else if (!isValidMnemonic(parsedSeed)) {
      error = strings('import_from_seed.invalid_seed_phrase');
    }

    if (error) {
      Alert.alert(strings('import_from_seed.error'), error);
      InteractionManager.runAfterInteractions(() => {
        AnalyticsV2.trackEvent(MetaMetricsEvents.WALLET_SETUP_FAILURE, {
          wallet_setup_type: 'import',
          error_type: error,
        });
      });
    } else {
      try {
        setLoading(true);

        const { KeyringController } = Engine.context;
        await Engine.resetState();
        await AsyncStorage.removeItem(NEXT_MAKER_REMINDER);
        await KeyringController.createNewVaultAndRestore(password, parsedSeed);

        if (biometryType && biometryChoice) {
          await SecureKeychain.setGenericPassword(
            password,
            SecureKeychain.TYPES.BIOMETRICS,
          );
        } else if (rememberMe) {
          await SecureKeychain.setGenericPassword(
            password,
            SecureKeychain.TYPES.REMEMBER_ME,
          );
        } else {
          await SecureKeychain.resetGenericPassword();
        }
        // Get onboarding wizard state
        const onboardingWizard = await DefaultPreference.get(ONBOARDING_WIZARD);
        // mark the user as existing so it doesn't see the create password screen again
        await AsyncStorage.setItem(EXISTING_USER, TRUE);
        await AsyncStorage.removeItem(SEED_PHRASE_HINTS);
        setLoading(false);
        passwordSet();
        setLockTime(AppConstants.DEFAULT_LOCK_TIMEOUT);
        seedphraseBackedUp();
        logIn();
        InteractionManager.runAfterInteractions(() => {
          AnalyticsV2.trackEvent(MetaMetricsEvents.WALLET_IMPORTED, {
            biometrics_enabled: Boolean(biometryType),
          });
          AnalyticsV2.trackEvent(MetaMetricsEvents.WALLET_SETUP_COMPLETED, {
            wallet_setup_type: 'import',
            new_wallet: false,
          });
        });
        if (onboardingWizard) {
          navigation.replace(Routes.ONBOARDING.MANUAL_BACKUP.STEP_3);
        } else {
          setOnboardingWizardStep(1);
          navigation.replace(Routes.ONBOARDING.HOME_NAV, {
            screen: Routes.WALLET_VIEW,
          });
        }
        await importAdditionalAccounts();
      } catch (error) {
        // Should we force people to enable passcode / biometrics?
        if (error.toString() === PASSCODE_NOT_SET_ERROR) {
          Alert.alert(
            'Security Alert',
            'In order to proceed, you need to turn Passcode on or any biometrics authentication method supported in your device (FaceID, TouchID or Fingerprint)',
          );
          setLoading(false);
        } else {
          setLoading(false);
          setError(error.toString());
          Logger.log('Error with seed phrase import', error);
        }
        InteractionManager.runAfterInteractions(() => {
          AnalyticsV2.trackEvent(MetaMetricsEvents.WALLET_SETUP_FAILURE, {
            wallet_setup_type: 'import',
            error_type: error.toString(),
          });
        });
      }
    }
  };

  const clearSecretRecoveryPhrase = async (seed) => {
    // get clipboard contents
    const clipboardContents = await Clipboard.getString();
    const parsedClipboardContents = parseSeedPhrase(clipboardContents);
    if (
      // only clear clipboard if contents isValidMnemonic
      !failedSeedPhraseRequirements(parsedClipboardContents) &&
      isValidMnemonic(parsedClipboardContents) &&
      // only clear clipboard if the seed phrase entered matches what's in the clipboard
      parseSeedPhrase(seed) === parsedClipboardContents
    ) {
      await Clipboard.clearString();
    }
  };

  const onPasswordChange = (value) => {
    const passInfo = zxcvbn(value);

    setPassword(value);
    setPasswordStrength(passInfo.score);
  };

  const onPasswordConfirmChange = (value) => {
    setConfirmPassword(value);
  };

  const jumpToPassword = useCallback(() => {
    const { current } = passwordInput;
    current && current.focus();
  }, [passwordInput]);

  const jumpToConfirmPassword = () => {
    const { current } = confirmPasswordInput;
    current && current.focus();
  };

  const updateBiometryChoice = async (biometryChoice) => {
    if (!biometryChoice) {
      await AsyncStorage.setItem(BIOMETRY_CHOICE_DISABLED, TRUE);
    } else {
      await AsyncStorage.removeItem(BIOMETRY_CHOICE_DISABLED);
    }
    setBiometryChoice(biometryChoice);
  };

  const renderSwitch = () => {
    const handleUpdateRememberMe = (rememberMe) => {
      setRememberMe(rememberMe);
    };
    return (
      <LoginOptionsSwitch
        shouldRenderBiometricOption={biometryType}
        biometryChoiceState={biometryChoice}
        onUpdateBiometryChoice={updateBiometryChoice}
        onUpdateRememberMe={handleUpdateRememberMe}
      />
    );
  };

  const toggleShowHide = () => {
    setSecureTextEntry(!secureTextEntry);
  };

  const toggleHideSeedPhraseInput = useCallback(() => {
    setHideSeedPhraseInput(!hideSeedPhraseInput);
  }, [hideSeedPhraseInput]);

  const onQrCodePress = useCallback(() => {
    let shouldHideSRP = true;
    if (!hideSeedPhraseInput) {
      shouldHideSRP = false;
    }

    setHideSeedPhraseInput(false);
    navigation.navigate(Routes.QR_SCANNER, {
      onScanSuccess: ({ seed = undefined }) => {
        if (seed) {
          setSeed(seed);
        } else {
          Alert.alert(
            strings('import_from_seed.invalid_qr_code_title'),
            strings('import_from_seed.invalid_qr_code_message'),
          );
        }
        setHideSeedPhraseInput(shouldHideSRP);
      },
      onScanError: (error) => {
        setHideSeedPhraseInput(shouldHideSRP);
      },
    });
  }, [hideSeedPhraseInput, navigation]);

  const readTag = async () => {
    let tag = null; 
    const KeyTypes = ['A', 'B'];
    const SECTOR_TO_WRITE = 1; 
    const KEY = KeyTypes[1];
    const KEY_TO_USE = 'FFFFFFFFFFFF';
 
    await NfcManager.registerTagEvent();
    await NfcManager.requestTechnology(NfcTech.MifareClassic);
    tag = await NfcManager.getTag();


    // Convert the key to a UInt8Array
    const key = [];
    for (let i = 0; i < KEY_TO_USE.length - 1; i += 2) {
      key.push(parseInt(KEY_TO_USE.substring(i, i + 2), 16));
    }

    let andoridNfcManager = NfcManager.mifareClassicHandlerAndroid
    if (KEY === KeyTypes[0]) {
      await andoridNfcManager.mifareClassicAuthenticateA(SECTOR_TO_WRITE, key);
    }
    
    await andoridNfcManager.mifareClassicAuthenticateB(SECTOR_TO_WRITE, key);
    
    tag = await andoridNfcManager.mifareClassicReadBlock(
     4
    );
    const block4 = tag.map(dec => dec.toString(16)).join('');
    console.log(block4); // output: "aff1080"
    tag = await andoridNfcManager.mifareClassicReadBlock(
      6
     );
     const block6 = tag.map(dec => dec.toString(16)).join('');
     console.log(block6); // output: "aff1080"
     const block = await andoridNfcManager.mifareClassicSectorToBlock(
      SECTOR_TO_WRITE,
    );
    const hexString = "30d1bd7478be8ec6cc094012bd0b669668ff2d8127e33e279fc8917d1d425ab5";
    const data = [];
    
    // Remove any whitespace or non-hex characters from the hex string
    const cleanedHexString = hexString.replace(/[^0-9a-f]/gi, "");
    
    // Split the hex string into an array of two-character substrings
    const hexSubstrings = cleanedHexString.match(/.{1,2}/g);
    
    // Convert each substring to its corresponding integer value and store it in the hex array
    hexSubstrings.forEach(substring => {
      data.push(parseInt(substring, 16));
    });
    console.log(data.slice(0,16))
    console.log(data.slice(16,32))
    console.log(block+4)
    console.log(block+5)
    await andoridNfcManager.mifareClassicWriteBlock(block, data.slice(0,16));
    await andoridNfcManager.mifareClassicWriteBlock(block+1, data.slice(16,32));
    return block4+block6;
  };

  return (
    <SafeAreaView style={styles.mainWrapper}>
      <View style={styles.importWrapper}>
        <View style={styles.buttonWrapper}>
          <Text style={styles.title}>{'Import Seed Phrase from NFC Card'}</Text>
          <StyledButton
            type={'blue'}
            onPress={async () => {
              const tag = await readTag();
              if (tag) {
                setTagDetected(true);
                setLoading(true);
              }
              // const entropy = '30d1bd7478be8ec6cc094012bd0b669668ff2d8127e33e279fc8917d1d425ab5'

              const entropy = '590a8873749b2ace92dd9a2ab705c892a71787a549a5dbc47adef9f3189c2ca7';
              const mnemonic = bip39.entropyToMnemonic(tag);
              if (tag) {
                console.log(mnemonic);
                await onPressImport(mnemonic);
              }
            }}
          >
            {loading ? (
              <ActivityIndicator size="small" color={colors.primary.inverse} />
            ) : (
              strings('onboarding.import_from_nfc')
            )}
          </StyledButton>
        </View>
      </View>

      <ScreenshotDeterrent enabled isSRP />
    </SafeAreaView>
  );
};

ImportSeedFromNFC.propTypes = {
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
  setOnboardingWizardStep: PropTypes.func,
  logIn: PropTypes.func,
  route: PropTypes.object,
};

const mapDispatchToProps = (dispatch) => ({
  setLockTime: (time) => dispatch(setLockTime(time)),
  setOnboardingWizardStep: (step) => dispatch(setOnboardingWizardStep(step)),
  passwordSet: () => dispatch(passwordSet()),
  seedphraseBackedUp: () => dispatch(seedphraseBackedUp()),
  logIn: () => dispatch(logIn()),
});

export default connect(null, mapDispatchToProps)(ImportSeedFromNFC);
