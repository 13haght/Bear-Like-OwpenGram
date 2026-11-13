const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const React=require('react'),{act,create}=require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT=true;
const source=fs.readFileSync(path.join(__dirname,'../App.js'),'utf8');
const plugins=[require.resolve('@babel/plugin-transform-react-jsx'),require.resolve('@babel/plugin-transform-modules-commonjs')];
const compile=raw=>require('@babel/core').transformSync(raw,{plugins,babelrc:false,configFile:false}).code;
const code=compile(source+'\nexport {Main,PulseEntry,PulseSettings,Profile,PublicProfile,NativeContacts,EditProfile,Publisher,PostCard,Inbox,MediaThumb,Movie,ChatVoicePlayer,ResolvedImage,AuthBackground,applyPulseTheme,bearValidatePublicationMedia,bearTogglePublicationMedia,bearConversationRecipient};');
function loadApp(options={}) {
  const values=new Map(),requests=[],mediaResolutions=[],videoSources=[],audioSources=[],alerts=[];
  const failures={get:false,set:false};
  const user={id:'owp:100',username:'alice',name:'Alice',provider:'owpengram'};
  const session={provider:'owpengram',serverIdentity:'pinned-owpengram',user};
  let sequence=0;
  const storage={getItem:async key=>{if(failures.get)throw Error('disk unavailable');return values.get(key)||null;},setItem:async(key,value)=>{if(failures.set)throw Error('disk unavailable');values.set(key,value);},removeItem:async key=>values.delete(key),getAllKeys:async()=>[...values.keys()],multiGet:async keys=>keys.map(key=>[key,values.get(key)])};
  const rn={StyleSheet:{absoluteFillObject:{},create:value=>value},Platform:{OS:'android'},Alert:{alert:(...args)=>alerts.push(args)},AppState:{currentState:'active',addEventListener:()=>({remove(){}})},Keyboard:{addListener:()=>({remove(){}}),dismiss(){}},BackHandler:{addEventListener:()=>({remove(){}})},useWindowDimensions:()=>({width:360,height:800})};
  for(const name of ['ActivityIndicator','FlatList','Image','KeyboardAvoidingView','Linking','Modal','Pressable','RefreshControl','ScrollView','Share','StatusBar','Switch','Text','TextInput','View'])rn[name]=name;
  const animation=()=>({start(){},stop(){}});rn.Animated={View:'AnimatedView',Value:class{setValue(){}interpolate(){return 1;}},timing:animation,sequence:animation,loop:animation,delay:animation};
  const media={useMediaUri:(uri,enabled=true)=>{mediaResolutions.push({uri,enabled});return options.resolveMedia?options.resolveMedia(uri,enabled):{uri:uri?.startsWith('owp-media://')?'file:///cache/resolved-media':uri,loading:false,error:null,retry(){}};}};
  const api={request:async(url,opts={})=>{requests.push({url,...opts});if(options.request)return options.request(url,opts);if(url==='/api/profile/me')return {profile:user};if(url==='/api/posts'||/^\/api\/users\/.+\/posts/.test(url))return {posts:[],nextCursor:null};if(url==='/api/users/contacts'||url.startsWith('/api/users/search'))return {users:[]};if(url==='/api/conversations')return {conversations:[]};throw Error('Unexpected direct request '+url);},publish:options.publish||(async()=>{throw Error('Unexpected publish');}),sendMedia:options.sendMedia||(async()=>{throw Error('Unexpected media send');}),setAvatar:options.setAvatar||(async()=>({profile:user})),resolveMedia:async uri=>({uri})};
  const auth={authClient:{configurationError:null,load:async()=>{await storage.getItem('native');return options.signedIn?session:null;},validate:async value=>{if(options.validate)return options.validate(value);return value;},save:async value=>value,logout:async()=>{if(options.logout)return options.logout();},request:async()=>{throw Error('No native auth request expected');}},accountNamespace:id=>'@native:'+id};
  const useVideoPlayer=(src,setup)=>{videoSources.push(src);const player=React.useMemo(()=>({status:'loading',duration:0,play(){},pause(){},addListener:()=>({remove(){}}),generateThumbnailsAsync:async()=>[]}),[]);React.useMemo(()=>setup?.(player),[]);return player;};
  const useAudioPlayer=uri=>{audioSources.push(uri);return React.useMemo(()=>({play(){},pause(){},seekTo:async()=>{}}),[]);};
  const fileSystem={documentDirectory:'file:///document/',cacheDirectory:'file:///cache/',getInfoAsync:async()=>({exists:true,size:512}),makeDirectoryAsync:async()=>{},copyAsync:async()=>{},deleteAsync:async()=>{},readDirectoryAsync:async()=>[]};
  const modules={react:React,'react-native':rn,'react-native-safe-area-context':{SafeAreaProvider:'SafeAreaProvider',useSafeAreaInsets:()=>({top:0,bottom:0,left:0,right:0})},'@expo/vector-icons':{Ionicons:'Ionicons'},'expo-video':{VideoView:'VideoView',useVideoPlayer},expo:{useEvent:(player,event,initial)=>initial},'expo-image':{Image:'ExpoImage'},'expo-audio':{useAudioPlayer,useAudioPlayerStatus:()=>({duration:3,currentTime:0}),setAudioModeAsync:async()=>{},RecordingPresets:{HIGH_QUALITY:{}}},'expo-file-system/legacy':fileSystem,'expo-crypto':{randomUUID:()=>`10000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`},'@react-native-async-storage/async-storage':storage,'./lib/owpengram-auth':auth,'../lib/owpengram-auth':auth,'./lib/owpengram-api':api,'./lib/owpengram-media':media,'./lib/media-file':require('../lib/media-file')};
  const globals={console,URL,AbortController,setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},process:{env:{}},fetch:()=>{throw Error('HTTP forbidden in UI');}};
  const componentModule={exports:{}};
  function resolve(name){if(name in modules)return modules[name];if(name.startsWith('./assets/'))return 1;if(name==='./components/OwpengramAuth'){if(!componentModule.loaded){const context=vm.createContext({...globals,exports:componentModule.exports,require:resolve});vm.runInContext(compile(fs.readFileSync(path.join(__dirname,'../components/OwpengramAuth.js'),'utf8')),context);componentModule.loaded=true;}return componentModule.exports;}if(name.startsWith('expo-'))return {};throw Error('Unexpected import '+name);}
  const context=vm.createContext({...globals,exports:{},require:resolve});vm.runInContext(code,context,{filename:'App.js'});
  return {exports:context.exports,values,requests,mediaResolutions,videoSources,audioSources,failures,alerts,storage,session,api,auth,modules};
}
module.exports={React,act,create,source,compile,loadApp};
