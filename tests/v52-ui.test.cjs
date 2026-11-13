const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const React=require('react'),{create,act}=require('react-test-renderer');global.IS_REACT_ACT_ENVIRONMENT=true;
const source=fs.readFileSync(require('node:path').join(__dirname,'../App.js'),'utf8');
function load(raw,extra={}){const context=vm.createContext({React,useState:React.useState,useEffect:React.useEffect,useRef:React.useRef,useCallback:React.useCallback,View:'View',Text:'Text',RNText:'RNText',TextInput:'TextInput',Tap:'Tap',Icon:'Icon',Avatar:'Avatar',Thumb:'Thumb',ScrollView:'ScrollView',RefreshControl:'RefreshControl',ActivityIndicator:'ActivityIndicator',Empty:'Empty',RED:'red',CYAN:'cyan',s:{},compact:n=>String(n),BEAR_GRID_KEY:'grid',BEAR_COLUMNS:[2,3,4],PULSE_THEMES:{navy:{bg:'#123',text:'white'}},useBearPreference:()=>React.useState(3),useWindowDimensions:()=>({width:360}),setTimeout,clearTimeout,setInterval,clearInterval,...extra});vm.runInContext(require('@babel/core').transformSync(raw,{plugins:[require.resolve('@babel/plugin-transform-react-jsx')],configFile:false,babelrc:false}).code,context);return context;}
const hashtag=source.slice(source.indexOf('const HashtagContext='),source.indexOf('const BearFormContext='));
test('Public hashtag links preserve punctuation, stop card tap, and navigate exact tag',async()=>{
 const c=load(hashtag+'\nglobalThis.Component=HashtagText;globalThis.Context=HashtagContext;');let value,stopped=false,r;
 await act(async()=>{r=create(React.createElement(c.Context.Provider,{value:tag=>value=tag},React.createElement(c.Component,null,'Voyage (#Été), #chat! mot#non')));});
 const links=r.root.findAll(n=>n.type==='RNText'&&n.props.accessibilityRole==='link');assert.equal(links.length,2);await act(async()=>links[1].props.onPress({stopPropagation(){stopped=true;}}));assert.equal(value,'#chat');assert.equal(stopped,true);await act(async()=>r.unmount());
});
test('Auth video stays mounted, loops with sound, pauses on background and unmount',async()=>{
 const listeners={};const player={playCount:0,pauseCount:0,play(){this.playCount++;},pause(){this.pauseCount++;},addListener:(name,fn)=>{listeners.status=fn;return {remove(){}};}};
 const c=load(source.slice(source.indexOf('function AuthBackground('),source.indexOf('function PulseAuth('))+'\nglobalThis.Component=AuthBackground;', {BEAR_AUTH_VIDEO:1,VideoView:'VideoView',StyleSheet:{absoluteFillObject:{}},useVideoPlayer:(src,setup)=>{React.useMemo(()=>setup(player),[]);return player;},AppState:{currentState:'active',addEventListener:(name,fn)=>{listeners.app=fn;return {remove(){}};}}});let r;
 await act(async()=>{r=create(React.createElement(c.Component));});assert.equal(player.loop,true);assert.equal(player.muted,false);assert.equal(player.volume,1);assert.equal(r.root.findByType('VideoView').props.nativeControls,false);
 await act(async()=>listeners.app('background'));assert.equal(player.pauseCount,1);await act(async()=>listeners.app('active'));assert.equal(player.playCount,2);await act(async()=>listeners.status({status:'error'}));assert.equal(r.root.findAllByType('VideoView').length,0);await act(async()=>r.unmount());assert.equal(player.pauseCount,3);
});
test('AMOLED palette is black; other themes retain their backgrounds; upload view exposes actual progress and confirmation stage',()=>{
 const colors=load(source.slice(source.indexOf('const PULSE_THEMES ='),source.indexOf('const PULSE_THEME_KEYS ='))+'\nglobalThis.p=PULSE_THEMES;').p;assert.equal(colors.dark.bg,'#000000');assert.equal(colors.white.bg,'#FFFFFF');assert.equal(colors.navy.bg,'#0B1426');
 const upload=source.slice(source.indexOf('    const percentage ='),source.indexOf('  return (',source.indexOf('    const percentage =')));assert.ok(upload.includes('progress.label'));assert.equal((upload.match(/<Text /g)||[]).length,2);assert.ok(upload.includes('accessibilityRole="progressbar"'));
});
test('Auth forms disable scroll indicator and retain password masking/reveal; keyboard wrapper reveals focus',()=>{
 const auth=fs.readFileSync(require('node:path').join(__dirname,'../components/OwpengramAuth.js'),'utf8');assert.ok(auth.includes('showsVerticalScrollIndicator={false}'));assert.equal((auth.match(/secureTextEntry={!showPassword}/g)||[]).length,1);assert.ok(auth.includes('setShowPassword(value => !value)'));
 const form=source.slice(source.indexOf('function BearFormScroll('),source.indexOf('// Traduire également'));assert.ok(form.includes("Keyboard.addListener('keyboardDidShow'"));assert.ok(form.includes('scrollResponderScrollNativeHandleToKeyboard'));assert.ok(form.includes('reveal?.(e.nativeEvent.target)'));
});
