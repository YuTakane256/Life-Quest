import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { Keyboard, Platform, TextInput, type KeyboardEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

interface ScrollTarget { scrollToOffset(options: { offset: number; animated: boolean }): void }

/** KeyboardAvoidingView shrinks the list, but does not reveal its focused header input. */
export function useTaskKeyboardVisibility(list: RefObject<ScrollTarget | null>, bottomClearance: number) {
    const offset = useRef(0);
    const keyboardTop = useRef<number | null>(null);
    const focused = useRef<ReturnType<typeof TextInput.State.currentlyFocusedInput> | null>(null);
    const mounted = useRef(false);
    const measurement = useRef(0);
    const clearance = useRef(bottomClearance);
    clearance.current = bottomClearance;

    const reveal = useCallback(() => {
        if (Platform.OS !== 'ios' || !mounted.current || keyboardTop.current === null) return;
        const input = focused.current;
        if (!input || input !== TextInput.State.currentlyFocusedInput()) return;
        const token = ++measurement.current;
        const measuredOffset = offset.current;
        input.measureInWindow((_x, y, _width, height) => {
            if (!mounted.current || token !== measurement.current || keyboardTop.current === null
                || focused.current !== input || input !== TextInput.State.currentlyFocusedInput()
                || measuredOffset !== offset.current) return;
            const overlap = y + height + clearance.current - keyboardTop.current;
            if (overlap > 1) list.current?.scrollToOffset({ offset: Math.max(0, measuredOffset + overlap), animated: true });
        });
    }, [list]);

    useEffect(() => {
        mounted.current = true;
        if (Platform.OS !== 'ios') return () => { mounted.current = false; };
        const show = (event: KeyboardEvent) => { keyboardTop.current = event.endCoordinates.screenY; reveal(); };
        const subscriptions = [
            Keyboard.addListener('keyboardDidShow', show),
            Keyboard.addListener('keyboardDidChangeFrame', show),
            Keyboard.addListener('keyboardDidHide', () => { keyboardTop.current = null; measurement.current++; }),
        ];
        return () => { mounted.current = false; measurement.current++; subscriptions.forEach((subscription) => subscription.remove()); };
    }, [reveal]);

    return {
        onInputFocus: () => {
            focused.current = TextInput.State.currentlyFocusedInput();
            keyboardTop.current = Keyboard.metrics()?.screenY ?? null;
            reveal();
        },
        onInputBlur: () => { focused.current = null; measurement.current++; },
        onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => { offset.current = event.nativeEvent.contentOffset.y; },
        onLayout: reveal,
    };
}
