import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appId = 'com.yutakane.lifequest.parity';

// Keep the executable suite names in source control. In particular, do not
// accept a flow path or app identifier from the shell: both smoke flows may
// clear local state, and must only ever address the isolated parity build.
export const mobileParityFlows = Object.freeze({
    screenshots: '.maestro/mobile-parity/capture-major-screens.yaml',
    smoke: '.maestro/mobile-parity/anonymous-critical-path.yaml',
});

export function getMobileParityFlow(name = 'screenshots') {
    const path = mobileParityFlows[name];
    if (!path) {
        return {
            ok: false,
            message: `Unknown Mobile parity flow "${name}". Use one of: ${Object.keys(mobileParityFlows).join(', ')}.`,
        };
    }
    return { ok: true, name, path };
}

export function getMaestroTestCommand(flow) {
    return ['test', flow.path];
}

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
    console.error('Mobile parity flows need a locally booted iOS simulator and a local Expo development build.');
    console.error('1. Start an iPhone 13 or iPhone 14 simulator (390 x 844 pt).');
    console.error('2. Build and open the fixed local development app: npm run mobile:ios');
    console.error('3. Keep Metro running, then run this command in another terminal.');
    console.error('\nSee docs/mobile-parity-checklist.md for the full local setup and comparison procedure.');
}

function commandExists(command, args = ['--version'], environment, spawn = spawnSync) {
    const result = spawn(command, args, { stdio: 'ignore', env: environment });
    return !result.error && result.status === 0;
}

/**
 * Check every prerequisite before running Maestro. Kept pure enough for unit
 * tests so a missing simulator or parity build demonstrably fails before an
 * automation command can mutate any app state.
 */
export function getMobileParityPreflight({
    environment = process.env,
    spawn = spawnSync,
    hasCommand = commandExists,
} = {}) {
    if (!hasCommand('maestro', ['--version'], environment, spawn)) {
        return { ok: false, message: 'Maestro is not installed or is not available on PATH. This command does not install it automatically.' };
    }

    const bootedDevices = spawn('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'], {
        encoding: 'utf8',
        env: environment,
    });

    if (bootedDevices.error || bootedDevices.status !== 0) {
        return { ok: false, message: 'Unable to inspect iOS simulators with xcrun. Install Xcode command-line tools and boot a simulator.' };
    }

    try {
        const devices = JSON.parse(bootedDevices.stdout).devices;
        const hasBootedDevice = Object.values(devices).some((runtimeDevices) =>
            Array.isArray(runtimeDevices) && runtimeDevices.some((device) => device.state === 'Booted'));
        if (!hasBootedDevice) {
            return { ok: false, message: 'No booted iOS simulator was found.' };
        }
    } catch {
        return { ok: false, message: 'Could not read the booted iOS simulator list.' };
    }

    const installedApp = spawn('xcrun', ['simctl', 'get_app_container', 'booted', appId, 'app'], {
        stdio: 'ignore',
        env: environment,
    });

    if (installedApp.error || installedApp.status !== 0) {
        return { ok: false, message: `The fixed Life Quest development build (${appId}) is not installed on the booted simulator.` };
    }

    return { ok: true };
}

function main(flowName = process.argv[2] ?? 'screenshots') {
    const flow = getMobileParityFlow(flowName);
    if (!flow.ok) {
        printSetup(flow.message);
        process.exit(1);
    }

    const java = getMaestroEnvironment();
    if (!java.ok) {
        printJavaSetup(java.message);
        process.exit(1);
    }

    const preflight = getMobileParityPreflight({ environment: java.environment });
    if (!preflight.ok) {
        printSetup(preflight.message);
        process.exit(1);
    }

    const result = spawnSync('maestro', getMaestroTestCommand(flow), { stdio: 'inherit', env: java.environment });

    if (result.error) {
        console.error(`Could not start Maestro: ${result.error.message}`);
        process.exit(1);
    }

    process.exit(result.status ?? 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main();
}
