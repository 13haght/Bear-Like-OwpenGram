const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const React=require('react'),{create,act}=require('react-test-renderer');global.IS_REACT_ACT_ENVIRONMENT=true;
const source=fs.readFileSync(path.join(__dirname,'../App.js'),'utf8');
const raw=source.slice(source.indexOf('function AuthBackground('),source.indexOf('function PulseAuth('))+'\nglobalThis.Component=AuthBackground;';
const code=require('@babel/core').transformSync(raw,{plugins:[require.resolve('@babel/plugin-transform-react-jsx')],babelrc:false,configFile:false}).code;
function harness({initialState='active',initialStatus='readyToPlay',playThrows=false,listenerThrows=false}={}){
 const events={},removed=[],calls=[];let released=false;
 const player={status:initialStatus,play(){if(released||playThrows)throw Error('native play failed');calls.push('play');},pause(){if(released)throw Error('released');calls.push('pause');},addListener(name,fn){if(listenerThrows)throw Error('subscribe failed');events.status=fn;return {remove(){removed.push('status');}};}};
 const c=vm.createContext({React,useState:React.useState,useEffect:React.useEffect,View:'View',VideoView:'VideoView',StyleSheet:{absoluteFillObject:{}},BEAR_AUTH_VIDEO:123,console:{warn(){}},AppState:{currentState:initialState,addEventListener(name,fn){events.app=fn;return {remove(){removed.push('app');}};}},useVideoPlayer(src,setup){assert.equal(src,123);React.useMemo(()=>setup(player),[]);React.useEffect(()=>()=>{released=true;},[]);return player;}});
 vm.runInContext(code,c);return {Component:c.Component,events,removed,calls,player};
}
test('Unknown initial AppState waits, then plays with sound; cleanup tolerates released native player',async()=>{
 const h=harness({initialState:null});let r;await act(async()=>{r=create(React.createElement(h.Component));});assert.deepEqual(h.calls,['pause']);assert.equal(h.player.loop,true);assert.equal(h.player.muted,false);assert.equal(h.player.volume,1);
 await act(async()=>h.events.app('active'));assert.equal(h.calls.at(-1),'play');await act(async()=>h.events.app('background'));assert.equal(h.calls.at(-1),'pause');await act(async()=>r.unmount());assert.deepEqual(h.removed,['app','status']);const n=h.calls.length;h.events.app('active');h.events.status({status:'error'});assert.equal(h.calls.length,n);
});
for(const options of [{initialStatus:'error'},{playThrows:true},{listenerThrows:true}])test('Video failure stays contained: '+JSON.stringify(options),async()=>{
 const h=harness(options);let r;await act(async()=>{r=create(React.createElement(h.Component));});assert.equal(r.root.findAllByType('VideoView').length,0);assert.ok(h.calls.includes('pause'));await act(async()=>r.unmount());
});
test('Error event stops playback and subsequent foreground events cannot restart it',async()=>{
 const h=harness();let r;await act(async()=>{r=create(React.createElement(h.Component));});await act(async()=>h.events.status({status:'error'}));const n=h.calls.length;await act(async()=>h.events.app('active'));assert.equal(h.calls.length,n);assert.equal(r.root.findAllByType('VideoView').length,0);await act(async()=>r.unmount());
});
