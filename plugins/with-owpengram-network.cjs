'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('@expo/config-plugins');

const RESOURCE = '@xml/owpengram_network_security_config';
const XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors><certificates src="system" /></trust-anchors>
  </base-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">152.89.254.50</domain>
  </domain-config>
</network-security-config>
`;

// OwpenGram exposes MTProto-over-WebSocket at ws:// on this exact host.
// MTProto authenticates/encrypts transport with the pinned RSA identity. This
// exception does not enable cleartext HTTP for every destination in the app.
function withOwpenGramNetwork(config) {
  config = withAndroidManifest(config, mod => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    const existing = app.$['android:networkSecurityConfig'];
    if (existing && existing !== RESOURCE) throw new Error('Une configuration réseau Android existe déjà. Intègre le domaine OwpenGram dans cette configuration avant de compiler.');
    app.$['android:networkSecurityConfig'] = RESOURCE;
    app.$['android:usesCleartextTraffic'] = 'false';
    return mod;
  });
  return withDangerousMod(config, ['android', async mod => {
    const folder = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, 'owpengram_network_security_config.xml'), XML, 'utf8');
    return mod;
  }]);
}
module.exports = withOwpenGramNetwork;
module.exports.NETWORK_XML = XML;
