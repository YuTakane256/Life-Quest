import { spawnSync } from 'node:child_process';

const appId = 'com.yutakane.lifequest.parity';

function printSetup(message) {
    console.error(`\n${message}\n`);
    console.error('Mobile parity screenshots need a locally booted iOS simulator and a local Expo development build.');
    console.error('1. Start an iPhone 13 or iPhone 14 simulator (390 x 844 pt).');
    console.error('2. Build and open the fixed local development app: npm run mobile:ios');
    console.error('3. Keep Metro running, then run this command in another terminal.');
    console.error('\nSee docs/mobile-parity-checklist.md for the full local setup and comparison procedure.');
}

function commandExists(command, args = ['--version']) {
    const result = spawnSync(command, args, { stdio: 'ignore' });
    return !result.error && result.status === 0;
}

if (!commandExists('maestro')) {
    printSetup('Maestro is not installed or is not available on PATH. This command does not install it automatically.');
    process.exit(1);
}

const bootedDevices = spawnSync('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'], {
    encoding: 'utf8',
});

if (bootedDevices.error || bootedDevices.status !== 0) {
    printSetup('Unable to inspect iOS simulators with xcrun. Install Xcode command-line tools and boot a simulator.');
    process.exit(1);
}

try {
    const devices = JSON.parse(bootedDevices.stdout).devices;
    const hasBootedDevice = Object.values(devices).some((runtimeDevices) =>
        Array.isArray(runtimeDevices) && runtimeDevices.some((device) => device.state === 'Booted'));
    if (!hasBootedDevice) {
        printSetup('No booted iOS simulator was found.');
        process.exit(1);
    }
} catch {
    printSetup('Could not read the booted iOS simulator list.');
    process.exit(1);
}

const installedApp = spawnSync('xcrun', ['simctl', 'get_app_container', 'booted', appId, 'app'], {
    stdio: 'ignore',
});

if (installedApp.error || installedApp.status !== 0) {
    printSetup(`The fixed Life Quest development build (${appId}) is not installed on the booted simulator.`);
    process.exit(1);
}

const result = spawnSync('maestro', [
    'test',
    '.maestro/mobile-parity',
], { stdio: 'inherit' });

if (result.error) {
    console.error(`Could not start Maestro: ${result.error.message}`);
    process.exit(1);
}

process.exit(result.status ?? 1);
