const { withEntitlementsPlist } = require('expo/config-plugins');

/** Only the anonymous simulator app may omit the Apple sign-in entitlement. */
module.exports = function withParityIOS(config) {
    if (config.extra?.appVariant !== 'parity'
        || config.ios?.bundleIdentifier !== 'com.yutakane.lifequest.parity') {
        throw new Error('with-parity-ios is only allowed for the isolated parity app');
    }
    return withEntitlementsPlist(config, (modConfig) => {
        delete modConfig.modResults['com.apple.developer.applesignin'];
        return modConfig;
    });
};
