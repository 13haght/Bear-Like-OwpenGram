const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const React=require('react'),{create,act}=require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT=true;
const source=fs.readFileSync(path.join(__dirname,'../App.js'),'utf8');
const raw=source.slice(source.indexOf('const voiceTime ='),source.indexOf('async function getBearImageQuality'));
const code=require('@babel/core').transformSync(raw,{plugins:[require.resolve('@babel/plugin-transform-react-jsx')],configFile:false,babelrc:false}).code;
async function mount({onSend=async()=>{},permission=true,prepareGate,duration=3000,size=100,initialGranted=permission}={}){
 const listeners={};const stored=new Map(),files=new Map(),calls={record:0,stop:0},recorder={isRecording:false,uri:'file:///cache/native.m4a',getStatus(){return {durationMillis:duration,isRecording:this.isRecording};},prepareToRecordAsync:async()=>{if(prepareGate)await prepareGate;},record(){this.isRecording=true;calls.record++;},async stop(){this.isRecording=false;calls.stop++;}};
 files.set(recorder.uri,{exists:true,size});
 const ctx=vm.createContext({React,useState:React.useState,useRef:React.useRef,useEffect:React.useEffect,View:'View',Text:'Text',Tap:'Tap',Icon:'Icon',Avatar:'Avatar',FlatList:'FlatList',Modal:'Modal',Pressable:'Pressable',ActivityIndicator:'ActivityIndicator',Image:'Image',MediaThumb:'MediaThumb',Movie:'Movie',useMediaUri:uri=>({uri,loading:false,error:null,retry(){}}),PULSE_THEMES:{navy:{panel:'#111',text:'#fff',muted:'#aaa'}},RecordingPresets:{HIGH_QUALITY:{}},useAudioRecorder:()=>recorder,useAudioRecorderState:()=>({durationMillis:recorder.isRecording?duration:0,isRecording:recorder.isRecording}),useAudioPlayer:()=>({pause(){},play(){},seekTo:async()=>{}}),useAudioPlayerStatus:()=>({duration:3,currentTime:0}),AudioModule:{getRecordingPermissionsAsync:async()=>({granted:initialGranted}),requestRecordingPermissionsAsync:async()=>({granted:permission})},setAudioModeAsync:async()=>{},AsyncStorage:{getItem:async k=>stored.get(k),setItem:async(k,v)=>stored.set(k,v),removeItem:async k=>stored.delete(k)},FS:{documentDirectory:'file:///document/',getInfoAsync:async uri=>files.get(uri)||{exists:false},makeDirectoryAsync:async()=>{},copyAsync:async({to})=>files.set(to,{exists:true,size:100}),deleteAsync:async uri=>files.delete(uri)},AppState:{currentState:'active',addEventListener:(name,fn)=>{listeners[name]=fn;return {remove(){}};}},BackHandler:{addEventListener:()=>({remove(){}})},Alert:{alert(){}},uid:()=> 'test-client-key-123',chatTime:()=> '12:00',setInterval:(...args)=>{const t=setInterval(...args);t.unref();return t;},clearInterval,Date,Math});
 vm.runInContext(code+'\nglobalThis.ChatComponent=Chat;',ctx);
 let renderer;await act(async()=>{renderer=create(React.createElement(ctx.ChatComponent,{user:{id:'bob',name:'Bob'},messages:[],onSend,onBack(){},sessionUserId:'alice',onChatSettings:async()=>({ttlSeconds:0}),onClearConversation:async()=>{}}));});
 const mic=()=>renderer.root.find(n=>n.type==='View'&&n.props.onResponderGrant);
 return {stored,files,calls,recorder,renderer,mic,appState:state=>listeners.change(state),close:async()=>act(async()=>renderer.unmount())};
}
const event=(x=100,y=100)=>({nativeEvent:{pageX:x,pageY:y}});
test('Releasing during asynchronous prepare never starts a recording',async()=>{
 let release;const gate=new Promise(r=>release=r);const h=await mount({prepareGate:gate});
 await act(async()=>h.mic().props.onResponderGrant(event()));
 await act(async()=>h.mic().props.onResponderRelease());await act(async()=>release());
 assert.equal(h.calls.record,0);assert.equal(h.stored.size,0);await h.close();
});
test('Denied microphone permission creates no recording',async()=>{const h=await mount({permission:false});await act(async()=>h.mic().props.onResponderGrant(event()));assert.equal(h.calls.record,0);await h.close();});
test('Sliding left discards the recording without a voice draft',async()=>{const h=await mount();await act(async()=>h.mic().props.onResponderGrant(event()));assert.equal(h.calls.record,1);await act(async()=>h.mic().props.onResponderMove(event(10,100)));assert.equal(h.calls.stop,1);assert.equal(h.stored.size,0);await h.close();});
test('Upward locking survives release; stopping persists a draft and failed send preserves it',async()=>{
 const h=await mount({onSend:async()=>{throw Error('Offline');}});await act(async()=>h.mic().props.onResponderGrant(event()));const mic=h.mic(),release=mic.props.onResponderRelease;await act(async()=>mic.props.onResponderMove(event(100,20)));assert.equal(h.mic(),mic);await act(async()=>release());assert.equal(h.calls.stop,0);
 const stop=h.renderer.root.find(n=>n.type==='Tap'&&n.props.label==='Arrêter et préécouter');await act(async()=>stop.props.onPress());assert.equal(h.calls.stop,1);assert.equal(h.stored.size,1);
 const send=h.renderer.root.find(n=>n.type==='Tap'&&n.props.label==='Envoyer le vocal');await act(async()=>send.props.onPress());assert.equal(h.stored.size,1);assert.ok(h.renderer.root.findAll(n=>n.type==='Text').some(n=>n.props.children==='Offline'));await h.close();
});
test('Successful send removes only its own persisted voice draft',async()=>{
 let sent;const h=await mount({onSend:async m=>{sent=m;}});h.stored.set('session','unchanged');await act(async()=>h.mic().props.onResponderGrant(event()));await act(async()=>h.mic().props.onResponderRelease());const saved=[...h.stored.entries()].find(([k])=>k.startsWith('@bear-voice'));assert.ok(saved);await act(async()=>h.renderer.root.find(n=>n.type==='Tap'&&n.props.label==='Envoyer le vocal').props.onPress());assert.equal(sent.type,'audio');assert.equal(sent.clientMessageId,'test-client-key-123');assert.equal(h.stored.get('session'),'unchanged');assert.equal(h.stored.size,1);assert.ok(!h.files.has(sent.uri));await h.close();
});

test('Inactive event during prepare does not lose the held gesture (V50 regression)',async()=>{
 let ready;const gate=new Promise(r=>ready=r),h=await mount({prepareGate:gate});
 await act(async()=>h.mic().props.onResponderGrant(event()));
 await act(async()=>h.appState('inactive'));await act(async()=>h.appState('active'));await act(async()=>ready());
 assert.equal(h.calls.record,1);await act(async()=>h.mic().props.onResponderRelease());assert.equal(h.stored.size,1);await h.close();
});
test('Background during prepare cancels and leaves no native file',async()=>{
 let ready;const h=await mount({prepareGate:new Promise(r=>ready=r)});
 await act(async()=>h.mic().props.onResponderGrant(event()));await act(async()=>h.appState('background'));await act(async()=>ready());
 assert.equal(h.calls.record,0);assert.equal(h.files.size,0);await h.close();
});
test('Newly granted permission asks for a fresh gesture instead of recording stale touch',async()=>{
 const h=await mount({initialGranted:false,permission:true});await act(async()=>h.mic().props.onResponderGrant(event()));assert.equal(h.calls.record,0);
 assert.ok(h.renderer.root.findAll(n=>n.type==='Text').some(n=>String(n.props.children).includes('Microphone autorisé')));await h.close();
});
test('Empty and too-short recordings never become sendable drafts',async()=>{
 for(const options of [{size:0},{duration:100}]){const h=await mount(options);await act(async()=>h.mic().props.onResponderGrant(event()));await act(async()=>h.mic().props.onResponderRelease());assert.equal(h.stored.size,0);assert.equal(h.files.size,0);await h.close();}
});
test('Responder termination during preparation cannot send or start a recording',async()=>{
 let ready;const h=await mount({prepareGate:new Promise(r=>ready=r)});await act(async()=>h.mic().props.onResponderGrant(event()));await act(async()=>h.mic().props.onResponderTerminate());await act(async()=>ready());assert.equal(h.calls.record,0);assert.equal(h.stored.size,0);await h.close();
});
