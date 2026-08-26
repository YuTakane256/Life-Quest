import { useEffect, useState } from 'react';
import * as AppleAuthentication from 'expo-apple-authentication';

type Props = {
    disabled: boolean;
    onPress: () => void;
};

export function AppleSignInButton({ disabled, onPress }: Props) {
    const [available, setAvailable] = useState(false);

    useEffect(() => {
        let active = true;
        void AppleAuthentication.isAvailableAsync().then((value) => {
            if (active) setAvailable(value);
        }).catch(() => undefined);
        return () => { active = false; };
    }, []);

    if (!available) return null;
    return (
        <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE_OUTLINE}
            cornerRadius={8}
            onPress={() => { if (!disabled) onPress(); }}
            style={{ width: '100%', height: 44, opacity: disabled ? 0.5 : 1 }}
            accessibilityLabel="Appleで続ける"
        />
    );
}
