const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
test('Build configuration preserves deployed identity, versionCode and credentials settings',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bear-v52-config-'));
 try{
 const expo={name:'Bear Like',owner:'existing-owner',slug:'existing-slug',scheme:'existing',android:{package:'com.existing.app',versionCode:52,permissions:['CAMERA']},extra:{eas:{projectId:'existing-project'},other:'preserved'},plugins:['expo-image']};
 const eas={build:{preview:{credentialsSource:'remote',env:{KEEP:'value'},android:{image:'latest'}},production:{android:{buildType:'app-bundle'}}}};
 fs.writeFileSync(path.join(dir,'app.json'),JSON.stringify({expo}));fs.writeFileSync(path.join(dir,'eas.json'),JSON.stringify(eas));
 execFileSync(process.execPath,[path.resolve(__dirname,'../scripts/configure-owpengram.cjs')],{cwd:dir});
 const a=JSON.parse(fs.readFileSync(path.join(dir,'app.json'))).expo,b=JSON.parse(fs.readFileSync(path.join(dir,'eas.json')));
 for(const key of ['owner','slug','scheme','extra'])assert.deepEqual(a[key],expo[key]);assert.equal(a.android.versionCode,52);assert.equal(a.android.package,'com.existing.app');assert.equal(a.android.softwareKeyboardLayoutMode,'resize');assert.ok(a.android.permissions.includes('RECORD_AUDIO'));assert.ok(a.plugins.includes('expo-secure-store'));assert.equal(a.plugins.filter(p=>p==='expo-secure-store').length,1);
 assert.equal(b.build.preview.android.buildType,'apk');assert.equal(b.build.preview.distribution,'internal');assert.equal(b.build.preview.credentialsSource,'remote');assert.deepEqual(b.build.production,eas.build.production);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
