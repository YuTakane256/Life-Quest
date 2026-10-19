/** Expo modules follow their SDK's module major; this does not claim full native compatibility. */
export function getExpoModuleMajorMismatches(dependencies, bundled, installed) {
    const major = (version) => typeof version === 'string' ? version.match(/^(?:[~^])?(\d+)\./)?.[1] : undefined;
    return Object.keys(dependencies)
        .filter((name) => name.startsWith('expo-') && typeof bundled[name] === 'string')
        .filter((name) => !major(installed[name]) || major(installed[name]) !== major(bundled[name]))
        .map((name) => ({ name, installed: installed[name] ?? 'missing', expected: bundled[name] }));
}
