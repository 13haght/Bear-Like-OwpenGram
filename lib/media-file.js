// Bear Like V54 - Préparation locale des photos, indépendante du serveur.
// Aucun jeton, accès réseau ou état global. Utilisable dans Expo et dans les tests Node.
'use strict';

function photoFormatFromBase64(prefix) {
  if (typeof prefix !== 'string' || prefix.length < 8) return null;
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean=prefix.replace(/\s+/g,'').replace(/=+$/,'');
  const bytes=[];let buffer=0,bits=0;
  for(const char of clean){
    const n=alphabet.indexOf(char);
    if(n<0)return null;
    buffer=(buffer<<6)|n;bits+=6;
    if(bits>=8){bits-=8;bytes.push((buffer>>bits)&255);if(bytes.length>=24)break;}
  }
  const starts=(arr)=>arr.every((v,i)=>bytes[i]===v);
  if(starts([0xff,0xd8,0xff]))return {mime:'image/jpeg',extension:'jpg'};
  if(starts([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))return {mime:'image/png',extension:'png'};
  if(starts([0x52,0x49,0x46,0x46])&&bytes.length>=12&&bytes.slice(8,12).every((v,i)=>v===[0x57,0x45,0x42,0x50][i]))return {mime:'image/webp',extension:'webp'};
  return null;
}

// Android et certains sélecteurs fournissent des extensions trompeuses (ou aucune).
// La signature du fichier, et non son nom, est l'autorité pour les photos.
async function preparePhotoFile(file, fs, makeName='publication') {
  if(!file || typeof file.uri!=='string')throw Error('Photo introuvable. Sélectionne-la à nouveau.');
  let uri=file.uri;
  if(/^content:\/\//i.test(uri)){
    const folder=fs.documentDirectory+'pulse-media/';
    await fs.makeDirectoryAsync(folder,{intermediates:true});
    const destination=folder+'photo-'+Date.now()+'-'+Math.random().toString(36).slice(2)+'.upload';
    try{await fs.copyAsync({from:uri,to:destination});uri=destination;}
    catch{throw Error('La photo Android n’est pas accessible. Sélectionne-la à nouveau dans la galerie.');}
  }
  if(!/^file:\/\//i.test(uri))throw Error('La photo doit être disponible localement pour être publiée.');
  let info;
  try{info=await fs.getInfoAsync(uri);}catch{throw Error('Impossible de lire la photo sélectionnée.');}
  if(!info?.exists||info.isDirectory||!(Number(info.size)>0))throw Error('La photo sélectionnée est vide ou inaccessible.');
  if(Number(info.size)>18*1024*1024)throw Error('Photo supérieure à 18 Mio : choisis une photo plus petite.');
  let header;
  try{header=await fs.readAsStringAsync(uri,{encoding:fs.EncodingType.Base64,position:0,length:32});}
  catch{throw Error('Impossible de vérifier le format réel de la photo. Sélectionne-la à nouveau.');}
  const format=photoFormatFromBase64(header);
  if(!format)throw Error('Format réel non accepté : choisis une photo JPEG, PNG ou WEBP (pas HEIC/GIF).');
  return {uri,name:makeName+'.'+format.extension,type:format.mime};
}

module.exports={photoFormatFromBase64,preparePhotoFile};
