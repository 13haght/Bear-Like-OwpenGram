const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../App.js'),'utf8');
const code=source.slice(source.indexOf('const bearActiveGalleryFiles='),source.indexOf('function BearLocalStorage('));
const cache='file:///cache/',document='file:///document/',old=Date.now()/1000-172800;
function harness(){const files=new Map(),values=new Map(),deleted=[];
 for(const dir of [cache+'bear-gallery/',document+'pulse-media/',document+'bear-voice/'])files.set(dir,{exists:true,isDirectory:true});
 const FS={cacheDirectory:cache,documentDirectory:document,getInfoAsync:async uri=>files.get(uri)||{exists:false},readDirectoryAsync:async dir=>[...files.keys()].filter(u=>u.startsWith(dir)&&u!==dir&&!u.slice(dir.length).includes('/')).map(u=>u.slice(dir.length)),deleteAsync:async uri=>{deleted.push(uri);files.delete(uri);}};
 const AsyncStorage={getAllKeys:async()=>[...values.keys()],multiGet:async keys=>keys.map(k=>[k,values.get(k)])};
 const ctx=vm.createContext({FS,AsyncStorage,Date,Set});vm.runInContext(code+'\nglobalThis.inventory=bearLocalInventory;globalThis.clean=bearCleanLocalFiles;globalThis.active=bearActiveGalleryFiles;',ctx);
 const add=(uri,size=100,time=old,directory=false)=>files.set(uri,{exists:true,isDirectory:directory,size,modificationTime:time});
 return {ctx,files,values,deleted,add};}
test('Measured cache excludes saved drafts, active gallery selections, fresh files, unknown directories and persistent voice files',async()=>{
 const h=harness();h.add(cache+'bear-gallery/stale.jpg',100);h.add(cache+'bear-gallery/draft.jpg',200);h.add(cache+'bear-gallery/active.jpg',300);h.add(cache+'bear-gallery/fresh.jpg',400,Date.now()/1000);h.add(document+'pulse-media/saved.jpg',500);h.add(document+'bear-voice/pending.m4a',600);h.add(cache+'bear-gallery/subdirectory',999,old,true);h.add(cache+'unknown.bin',777);
 h.values.set('pending-upload',JSON.stringify({uri:cache+'bear-gallery/draft.jpg'}));h.ctx.active.add(cache+'bear-gallery/active.jpg');
 const r=await h.ctx.inventory();assert.equal(r.total,2100);assert.equal(r.reclaimable,100);
 const result=await h.ctx.clean();assert.equal(result.released,100);assert.deepEqual(h.deleted,[cache+'bear-gallery/stale.jpg']);assert.equal(result.inventory.total,2000);assert.ok(h.files.has(document+'bear-voice/pending.m4a'));
});
test('Cleanup rechecks references added after inventory, rather than deleting a newly protected upload',async()=>{
 const h=harness();const uri=cache+'bear-gallery/race.jpg';h.add(uri);let count=0;
 const storage={getAllKeys:async()=>{if(++count===2)h.values.set('new-draft',uri);return [...h.values.keys()];},multiGet:async keys=>keys.map(k=>[k,h.values.get(k)])};
 h.ctx.AsyncStorage=storage;
 const result=await h.ctx.clean();assert.equal(result.released,0);assert.equal(h.deleted.length,0);
});
test('Missing modification date is protected',async()=>{const h=harness();h.add(cache+'bear-gallery/no-date.jpg',123,0);assert.equal((await h.ctx.inventory()).reclaimable,0);});
