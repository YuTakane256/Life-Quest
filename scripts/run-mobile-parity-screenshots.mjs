import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appId = 'com.yutakane.lifequest.parity';

function isExecutable(filePath) {
    try {
        accessSync(filePath, constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

/**
 * Returns an environment for every Maestro subprocess without changing the
 * caller's shell configuration. A configured JAVA_HOME is intentional, so an
 * invalid value must be fixed explicitly instead of silently choosing another
 * JDK.
 */
export function getMaestroEnvironment({
    environment = process.env,
    spawn = spawnSync,
    executable = isExecutable,
} = {}) {
    const configuredJavaHome = environment.JAVA_HOME?.trim();
    let javaHome = configuredJavaHome;

    if (javaHome) {
        const javaPath = join(javaHome, 'bin', 'java');
        if (!executable(javaPath)) {
            return {
                ok: false,
                message: `JAVA_HOME is set to "${javaHome}", but ${javaPath} does not exist or is not executable. Fix or unset JAVA_HOME and run the command again.`,
            };
        }
    } else {
        const brew = spawn('brew', ['--prefix', 'openjdk'], {
            encoding: 'utf8',
            stdio: 'pipe',
        });
        const brewPrefix = brew.error || brew.status !== 0 ? '' : brew.stdout.trim();
        if (!brewPrefix) {
            return {
                ok: false,
                message: 'A Java runtime is required by Maestro, but JAVA_HOME is not set and Homebrew OpenJDK was not found.',
            };
        }

        javaHome = join(brewPrefix, 'libexec', 'openjdk.jdk', 'Contents', 'Home');
        const javaPath = join(javaHome, 'bin', 'java');
        if (!executable(javaPath)) {
            return {
                ok: false,
                message: `Homebrew OpenJDK was found at "${javaHome}", but ${javaPath} does not exist or is not executable.`,
            };
        }
    }

    const javaBin = join(javaHome, 'bin');
    return {
        ok: true,
        environment: {
            ...environment,
            JAVA_HOME: javaHome,
            PATH: environment.PATH ? `${javaBin}${delimiter}${environment.PATH}` : javaBin,
        },
    };
}

function printJavaSetup(message) {
    console.error(`\n${message}\n`);
    console.error('Set Java for this terminal, then run the command again:');
    console.error('  export JAVA_HOME="$(brew --prefix openjdk)/libexec/openjdk.jdk/Contents/Home"');
    console.error('  export PATH="$JAVA_HOME/bin:$PATH"');
    console.error('\nIf Homebrew OpenJDK is not installed, install it first: brew install openjdk');
}

function printSetup(message) {
    console.error(`\n${message}\n`);
    console.error('Mobile parity screenshots need a locally booted iOS simulator and a local Expo development build.');
    console.error('1. Start an iPhone 13 or iPhone 14 simulator (390 x 844 pt).');
    console.error('2. Build and open the fixed local development app: npm run mobile:ios');
    console.error('3. Keep Metro running, then run this command in another terminal.');
    console.error('\nSee docs/mobile-parity-checklist.md for the full local setup and comparison procedure.');
}

function commandExists(command, args = ['--version'], environment) {
    const result = spawnSync(command, args, { stdio: 'ignore', env: environment });
    return !result.error && result.status === 0;
}

function main() {
    const java = getMaestroEnvironment();
    if (!java.ok) {
        printJavaSetup(java.message);
        process.exit(1);
    }

    if (!commandExists('maestro', ['--version'], java.environment)) {
    printSetup('Maestro is not installed or is not available on PATH. This command does not install it automatically.');
    process.exit(1);
    }

    const bootedDevices = spawnSync('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'], {
        encoding: 'utf8',
        env: java.environment,
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
        env: java.environment,
    });

    if (installedApp.error || installedApp.status !== 0) {
        printSetup(`The fixed Life Quest development build (${appId}) is not installed on the booted simulator.`);
        process.exit(1);
    }

    const result = spawnSync('maestro', [
        'test',
        '.maestro/mobile-parity',
    ], { stdio: 'inherit', env: java.environment });

    if (result.error) {
        console.error(`Could not start Maestro: ${result.error.message}`);
        process.exit(1);
    }

    process.exit(result.status ?? 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main();
}
