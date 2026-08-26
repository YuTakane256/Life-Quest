import { useEffect, useState, type ComponentType } from 'react';

type Props = {
    disabled: boolean;
    onPress: () => void;
};

/** Renders the official Apple control only on iOS; Android has no Apple action. */
export function AppleSignInButton(props: Props) {
    const [IosAppleSignInButton, setIosAppleSignInButton] = useState<ComponentType<Props> | null>(null);

    useEffect(() => {
        if (process.env.EXPO_OS !== 'ios') return;
        void import('./AppleSignInButton.ios').then(({ AppleSignInButton: Component }) => {
            setIosAppleSignInButton(() => Component);
        }).catch(() => undefined);
    }, []);

    if (!IosAppleSignInButton) return null;
    return <IosAppleSignInButton {...props} />;
}
