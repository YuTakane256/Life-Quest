import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
    return (
        <>
            <StatusBar style="light" />
            <Stack
                screenOptions={{
                    headerStyle: { backgroundColor: '#171923' },
                    headerTintColor: '#f7fafc',
                    headerTitleStyle: { fontWeight: '700' },
                    contentStyle: { backgroundColor: '#0f1118' },
                }}
            >
                <Stack.Screen name="index" options={{ title: 'Life Quest' }} />
            </Stack>
        </>
    );
}
