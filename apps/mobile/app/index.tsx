import { getHpDisplayState } from '@life-quest/core';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const previewHp = getHpDisplayState(72, 100);

export default function HomeScreen() {
    return (
        <SafeAreaView style={styles.safeArea} edges={['bottom']}>
            <View style={styles.container}>
                <Text style={styles.eyebrow}>MOBILE FOUNDATION</Text>
                <Text style={styles.title}>今日の冒険</Text>
                <Text style={styles.body}>
                    Web版と同じ共有ロジックを使う、Life Questモバイル版の土台です。
                </Text>

                <View style={styles.statusPanel}>
                    <View style={styles.statusHeader}>
                        <Text style={styles.statusLabel}>冒険者 HP</Text>
                        <Text style={styles.statusValue}>
                            {previewHp.current} / {previewHp.max}
                        </Text>
                    </View>
                    <View style={styles.track}>
                        <View style={[styles.fill, { width: `${previewHp.ratio * 100}%` as `${number}%` }]} />
                    </View>
                </View>

                <View style={styles.nextPanel}>
                    <Text style={styles.nextTitle}>次の段階</Text>
                    <Text style={styles.nextBody}>
                        共通ストアと端末ストレージを接続し、タスク画面から順に移植します。
                    </Text>
                </View>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: '#0f1118',
    },
    container: {
        flex: 1,
        paddingHorizontal: 24,
        paddingTop: 36,
        gap: 16,
    },
    eyebrow: {
        color: '#63d7b0',
        fontSize: 12,
        fontWeight: '800',
        letterSpacing: 1.4,
    },
    title: {
        color: '#f7fafc',
        fontSize: 32,
        fontWeight: '800',
    },
    body: {
        color: '#aeb7c7',
        fontSize: 16,
        lineHeight: 25,
    },
    statusPanel: {
        marginTop: 12,
        padding: 18,
        gap: 14,
        borderWidth: 1,
        borderColor: '#333947',
        borderRadius: 8,
        backgroundColor: '#1a1e28',
    },
    statusHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    statusLabel: {
        color: '#d9dfeb',
        fontSize: 15,
        fontWeight: '700',
    },
    statusValue: {
        color: '#63d7b0',
        fontSize: 14,
        fontWeight: '800',
    },
    track: {
        height: 10,
        overflow: 'hidden',
        borderRadius: 5,
        backgroundColor: '#303645',
    },
    fill: {
        height: '100%',
        borderRadius: 5,
        backgroundColor: '#28b987',
    },
    nextPanel: {
        paddingTop: 12,
        gap: 8,
    },
    nextTitle: {
        color: '#f7fafc',
        fontSize: 18,
        fontWeight: '700',
    },
    nextBody: {
        color: '#8791a3',
        fontSize: 14,
        lineHeight: 22,
    },
});
