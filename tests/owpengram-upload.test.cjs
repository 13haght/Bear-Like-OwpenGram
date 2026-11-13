const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../App.js'),'utf8');
const start=source.indexOf('  const commitPublication='),end=source.indexOf('  const resumePublication=',start);
const raw=source.slice(start,end);
const validator=source.slice(source.indexOf('function bearValidatePublicationMedia('),source.indexOf('function bearTogglePublicationMedia('));
const post={id:'operation-one',caption:'Une photo',visibility:'public',media:[{uri:'file:///image.jpg',type:'image',durationSeconds:0}]};
function harness({publish,commitFails=false,storageFails=false}={}) {
  const storage=new Map(),calls=[],events=[],drafts=[post],routes=[],ref={current:null},postsRef={current:[]},feedIdsRef={current:[]};
  let failCommit=commitFails;
  const context=vm.createContext({
    publicationLock:{current:false},postRevision:{current:0},pendingRef:ref,pendingKey:'pending',postsRef,feedIdsRef,
    AsyncStorage:{getItem:async key=>storage.get(key)||null,setItem:async(key,value)=>{events.push('persist');if(storageFails)throw Error('Stockage plein');storage.set(key,value);}},
    durableMedia:async media=>({media:media.map(item=>({...item,uri:'file:///durable/image.jpg'}))}),
    owpenApi:{publish:async(input,onProgress)=>{events.push('publish');calls.push(JSON.parse(JSON.stringify(input)));if(publish)return publish(input,onProgress);return {post:{id:'owps:user:100:1',media:input.media}};}},
    commit:async update=>{if(failCommit)throw Error('Cache plein');const value=update({drafts});drafts.splice(0,drafts.length,...value.drafts);},
    setPending(){},setFeedIds(){},setRecentPublicationId(){},setRoute:route=>routes.push(route),setTab(){},uid:()=> 'native-client-id',
    storePosts:rows=>{postsRef.current=rows;},discardPending:async()=>{storage.delete('pending');ref.current=null;}
  });
  vm.runInContext(validator+raw+'\nglobalThis.publishPost=commitPublication;',context);
  return {run:context.publishPost,storage,calls,events,drafts,routes,ref,postsRef,allowCommit(){failCommit=false;}};
}
test('Publication persists its file and stable operation before calling native publish',async()=>{const h=harness();await h.run(post,false);assert.equal(h.events[0],'persist');assert.equal(h.events[1],'publish');assert.equal(h.calls[0].clientMessageId,post.id);assert.equal(h.calls[0].media.uri,'file:///durable/image.jpg');assert.equal(h.calls[0].visibility,'public');assert.equal(h.drafts.length,0);assert.equal(h.storage.size,0);assert.equal(h.postsRef.current[0].id,'owps:user:100:1');});
test('An offline publication keeps its draft, files and operation ID for retry',async()=>{let attempt=0;const h=harness({publish:async()=>{if(++attempt===1)throw Error('Hors connexion');return {post:{id:'owps:user:100:1',media:post.media}};}});await assert.rejects(h.run(post,false),/Hors connexion/);assert.equal(h.drafts.length,1);assert.ok(h.storage.has('pending'));await h.run(post,false);assert.equal(h.calls[0].clientMessageId,h.calls[1].clientMessageId);assert.equal(h.calls[0].media.uri,h.calls[1].media.uri);});
test('A received story is never sent again when only local cleanup failed',async()=>{const h=harness({commitFails:true});await assert.rejects(h.run(post,false),/Cache plein/);assert.equal(JSON.parse(h.storage.get('pending')).confirmedPost.id,'owps:user:100:1');h.allowCommit();await h.run(post,false);assert.equal(h.calls.length,1);assert.equal(h.storage.size,0);assert.equal(h.drafts.length,0);});
test('Missing native confirmation keeps pending state and produces no success navigation',async()=>{const h=harness({publish:async()=>({})});await assert.rejects(h.run(post,false),/non confirmée/);assert.equal(h.routes.length,0);assert.equal(h.drafts.length,1);assert.ok(h.storage.has('pending'));});
test('Storage failure before upload prevents a remote send',async()=>{const h=harness({storageFails:true});await assert.rejects(h.run(post,false),/Stockage plein/);assert.equal(h.calls.length,0);assert.equal(h.drafts.length,1);});
test('An old multiple-media draft remains unchanged and is never partially published',async()=>{const h=harness();const old={...post,media:[...post.media,{type:'image',uri:'file:///second.jpg'}]},original=JSON.stringify(old);await assert.rejects(h.run(old,false),/brouillon est conservé/);assert.equal(JSON.stringify(old),original);assert.equal(h.calls.length,0);});
test('Repeated taps cannot send two native stories while publication is pending',async()=>{let release;const gate=new Promise(resolve=>release=resolve);const h=harness({publish:async()=>{await gate;return {post:{id:'owps:user:100:1'}};}});const first=h.run(post,false);await assert.rejects(h.run(post,false),/déjà en cours/);release();await first;assert.equal(h.calls.length,1);});
test('Publication sends already-normalized MediaLibrary duration without dividing twice',async()=>{const h=harness();await h.run({...post,media:[{type:'video',uri:'file:///video.mp4',duration:12.5,durationSeconds:12.5}]},false);assert.equal(h.calls[0].media.durationSeconds,12.5);});
