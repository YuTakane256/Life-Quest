import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useMobileSettingsStore } from '../stores/useMobileSettingsStore';

export function useReducedMotion() {
    const mode = useMobileSettingsStore((state) => state.motionMode);
    const [systemReduced, setSystemReduced] = useState(false);
    useEffect(() => {
        let mounted = true;
        let changed = false;
        const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
            changed = true;
            if (mounted) setSystemReduced(value);
        });
        void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
            if (mounted && !changed) setSystemReduced(value);
        }, () => {});
        return () => { mounted = false; subscription.remove(); };
    }, []);
    return mode === 'reduced' || (mode === 'system' && systemReduced);
}
