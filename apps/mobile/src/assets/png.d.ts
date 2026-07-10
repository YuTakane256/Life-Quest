// Metroが解決する画像モジュールの型（#499）。RNのImage sourceとして扱う。
declare module '*.png' {
    import type { ImageSourcePropType } from 'react-native';
    const source: ImageSourcePropType;
    export default source;
}
