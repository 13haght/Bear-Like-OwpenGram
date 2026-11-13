const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../App.js'),'utf8');
const start=source.indexOf('  const loadPosts=');
const raw=source.slice(start,source.indexOf('  const loadContacts=',start));
function harness({read}={}) {
  const outsider={id:'outsider',author:'owp:900',media:[{}]},stored=[],ids=[],coverages=[];
  const refs={postLock:{current:null},postRevision:{current:0},postsRef:{current:[outsider]},feedIdsRef:{current:[]},coverageRef:{current:null}};
  const context=vm.createContext({...refs,session:{user:{id:'owp:100'}},request:read||(async()=>({posts:[{id:'friend',author:'owp:200',media:[{}]}],coverage:{partial:true,profilesFailed:1}})),fetchUserPosts:async()=>[{id:'mine',author:'owp:100',media:[{}]}],setPostState(){},notice(error){throw error;},setFeedIds:value=>ids.push(value),setFeedCoverage:value=>coverages.push(value),storePosts:rows=>{stored.push(rows);refs.postsRef.current=rows;}});
  vm.runInContext(raw+'\nglobalThis.load=loadPosts;',context);return {...refs,load:context.load,stored,ids,coverages};
}
test('A visited stranger stays in the profile cache but does not enter the Contacts feed IDs',async()=>{const h=harness();await h.load();assert.deepEqual(JSON.parse(JSON.stringify(h.ids[0])),['friend','mine']);assert.ok(h.stored[0].some(post=>post.id==='outsider'));assert.equal(h.coverages[0].partial,true);assert.equal(h.coverages[0].profilesFailed,1);});
test('A read started before a native mutation cannot restore stale posts or reaction counters',async()=>{let release;const gate=new Promise(resolve=>release=resolve);const h=harness({read:()=>gate});const task=h.load();h.postRevision.current++;release({posts:[{id:'deleted-post',likes:99}],coverage:{}});await task;assert.equal(h.stored.length,0);assert.equal(h.ids.length,0);});
test('A forced feed refresh waits for the current read then obtains updated contacts content',async()=>{let release,calls=0;const gate=new Promise(resolve=>release=resolve);const h=harness({read:async()=>{if(++calls===1)return gate;return {posts:[{id:'new-contact'}]};}});const first=h.load();h.postRevision.current++;const second=h.load(true);release({posts:[{id:'old-contact'}]});await Promise.all([first,second]);assert.equal(calls,2);assert.deepEqual(JSON.parse(JSON.stringify(h.ids[0])),['new-contact','mine']);});
