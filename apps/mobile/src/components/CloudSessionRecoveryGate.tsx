import { useSyncExternalStore } from 'react';
import { ActivityIndicator, Modal, Text, View } from 'react-native';
import { getPasswordRecoveryState, subscribePasswordRecoveryState } from '../platform/auth';
import { getMobileCloudRecoveryState, subscribeMobileCloudRecovery } from '../platform/cloudSessionRecovery';
import SettingsScreen from '../screens/SettingsScreen';

/** A native modal also blocks tabs, gestures and the accessibility tree underneath. */
export function CloudSessionRecoveryGate() {
    const state = useSyncExternalStore(subscribeMobileCloudRecovery, getMobileCloudRecoveryState);
    const passwordRecovery = useSyncExternalStore(subscribePasswordRecoveryState, getPasswordRecoveryState);
    return <Modal visible={state !== 'ready'} animationType="none" onRequestClose={() => {}}>
        {state === 'checking' && passwordRecovery === 'idle'
            ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}><ActivityIndicator /><Text>アカウントを確認しています</Text></View>
            : state !== 'ready' && <SettingsScreen recoveryOnly />}
    </Modal>;
}
