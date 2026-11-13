'use strict';

// Validate names and formats only. Never print an app credential or session.
function invalidSettings(env) {
  const id = String(env.EXPO_PUBLIC_OWPENGRAM_API_ID || '').trim();
  const hash = String(env.EXPO_PUBLIC_OWPENGRAM_API_HASH || '').trim();
  const invalid = [];
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) > 2147483647) {
    invalid.push('EXPO_PUBLIC_OWPENGRAM_API_ID');
  }
  if (!/^[a-f0-9]{32}$/i.test(hash)) invalid.push('EXPO_PUBLIC_OWPENGRAM_API_HASH');
  return invalid;
}

if (require.main === module) {
  const invalid = invalidSettings(process.env);
  if (invalid.length) {
    console.error('::error::Paramètres OwpenGram absents ou invalides : ' + invalid.join(', ') + '.');
    console.error('Ajoute ces valeurs dans Settings > Secrets and variables > Actions > Repository secrets, puis relance le workflow.');
    process.exitCode = 1;
  } else {
    console.log('Paramètres de l’application OwpenGram vérifiés. Aucune valeur affichée.');
  }
}

module.exports = { invalidSettings };
