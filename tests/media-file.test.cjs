const test=require('node:test');
const assert=require('node:assert/strict');
const {photoFormatFromBase64,preparePhotoFile}=require('../lib/media-file');

const jpeg=Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x10]);
const png=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0]);
const webp=Buffer.concat([Buffer.from('RIFF'),Buffer.from([0x10,0,0,0]),Buffer.from('WEBPVP8 ')]);

for(const [type,contents,extension] of [['image/jpeg',jpeg,'jpg'],['image/png',png,'png'],['image/webp',webp,'webp']]){
  test('Real photo signature determines '+type+' even with a misleading Android filename',async()=>{
    const read=[];
    const fs={EncodingType:{Base64:'base64'},getInfoAsync:async()=>({exists:true,size:contents.length,isDirectory:false}),readAsStringAsync:async(uri,opt)=>{read.push(opt);return contents.toString('base64');}};
    const info=await preparePhotoFile({uri:'file:///image-from-picker.heic',mimeType:'image/jpeg',fileName:'fake.png'},fs);
    assert.deepEqual(info,{uri:'file:///image-from-picker.heic',name:'publication.'+extension,type});
    assert.equal(read[0].position,0);assert.ok(read[0].length<=64);
  });
}
test('Unsupported HEIC or GIF is rejected before the gateway transfer',async()=>{
  const fs={EncodingType:{Base64:'base64'},getInfoAsync:async()=>({exists:true,size:99}),readAsStringAsync:async()=>Buffer.from('GIF89a').toString('base64')};
  await assert.rejects(preparePhotoFile({uri:'file:///picture.jpg'},fs),/Format réel non accepté/);
  assert.equal(photoFormatFromBase64(''),null);
});
test('Android content:// URI is copied to a stable local file before signature validation',async()=>{
  let copied=null;
  const fs={documentDirectory:'file:///doc/',EncodingType:{Base64:'base64'},makeDirectoryAsync:async()=>{},copyAsync:async(data)=>{copied=data;},getInfoAsync:async()=>({exists:true,size:128}),readAsStringAsync:async()=>png.toString('base64')};
  const out=await preparePhotoFile({uri:'content://media/1234'},fs,'publication');
  assert.equal(copied.from,'content://media/1234');assert.match(out.uri,/^file:\/\/\/doc\/pulse-media\/photo-/);assert.equal(out.type,'image/png');
});
test('Photo prevalidation catches unreadable or empty Android media',async()=>{
  const fs={getInfoAsync:async()=>({exists:true,size:0})};
  await assert.rejects(preparePhotoFile({uri:'file:///photo.jpeg'},fs),/vide ou inaccessible/);
});
