'use strict';
const fs = require('node:fs');
const path = require('node:path');

module.exports = ({ config }) => {
  const realAppPath = path.join(__dirname, 'app.json');
  // The supplied hand-off contained no app.json/EAS identity. A local preview
  // remains runnable; adding the existing project's app.json restores its exact
  // package, project, version and signing identity instead of inventing them.
  const hasIdentity = fs.existsSync(realAppPath);
  const base = hasIdentity ? { ...config } : JSON.parse(fs.readFileSync(path.join(__dirname, 'config-examples/app.json.example'), 'utf8')).expo;
  if (!hasIdentity) {
    base.slug = 'bear-like-owpengram-preview';
    base.android = { ...base.android, package: 'com.bearlike.owpengram.preview' };
    if (process.env.EAS_BUILD === 'true') throw new Error('Restaure app.json et eas.json de ton projet Bear Like avant une compilation EAS. Le package de prévisualisation ne remplace pas ton application publiée.');
  }
  const plugins = [...(base.plugins || [])];
  for (const plugin of ['expo-secure-store', 'expo-audio', 'expo-video', './plugins/with-owpengram-network.cjs']) {
    if (!plugins.some(entry => (Array.isArray(entry) ? entry[0] : entry) === plugin)) plugins.push(plugin);
  }
  return { ...base, plugins, android: { ...base.android, softwareKeyboardLayoutMode: 'resize',
    permissions: [...new Set([...(base.android?.permissions || []), 'RECORD_AUDIO'])] } };
};
