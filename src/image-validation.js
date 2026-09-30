import '../public/media-tools.js';
import {validateGifLzw} from './gif-lzw.js';
// Parse container structure rather than trusting extensions or a magic prefix.
// No transcoding: uploaded animation bytes remain unchanged.
export function inspectImage(b,declared){
  const bad=()=>{throw new Error('Malformed or unsupported image. Use JPEG, PNG, WebP or GIF.');};
  const v=new DataView(b.buffer,b.byteOffset,b.byteLength),n=b.length;
  const text=(o,l)=>String.fromCharCode(...b.slice(o,o+l));
  const bounds=(o,l)=>{if(o<0||l<0||o+l>n)bad();};
  const dims=(w,h)=>{if(!w||!h||w>16384||h>16384||w*h>MediaTools.maxPixels)bad();};
  let type,animated=false;
  if(n>=33&&text(0,8)==='\x89PNG\r\n\x1a\n'){
    type='image/png';let o=8,idat=false,end=false,ihdr=false,palette=false;
    while(o<n){bounds(o,12);const len=v.getUint32(o),tag=text(o+4,4);bounds(o,12+len);
      // Validate PNG chunk CRC, including image data.
      let crc=0xffffffff;for(let j=o+4;j<o+8+len;j++){crc^=b[j];for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}if(((crc^0xffffffff)>>>0)!==v.getUint32(o+8+len))bad();
      if(!ihdr){if(tag!=='IHDR'||len!==13)bad();dims(v.getUint32(o+8),v.getUint32(o+12));const depth=b[o+16],color=b[o+17];if(!({0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]})[color]?.includes(depth)||b[o+18]||b[o+19]||b[o+20]>1)bad();ihdr=true;}
      if(tag==='PLTE'){if(idat||palette||!len||len%3||len>768)bad();palette=true;}if(tag==='IHDR'&&o!==8)bad();if(tag==='IDAT'){if(b[25]===3&&!palette)bad();idat=true;}if(tag==='acTL')animated=true;
      o+=len+12;if(tag==='IEND'){if(len||o!==n)bad();end=true;break;}
    }if(!end||!idat)bad();
  }else if(n>=14&&['GIF87a','GIF89a'].includes(text(0,6))){
    type='image/gif';const width=v.getUint16(6,true),height=v.getUint16(8,true);dims(width,height);let o=13,frames=0,end=false,totalPixels=0;
    if(b[10]&128)o+=3*(1<<((b[10]&7)+1));bounds(0,o);
    const blocks=()=>{let total=0;while(true){bounds(o,1);const l=b[o++];if(!l)return total;bounds(o,l);o+=l;total+=l;}};
    while(o<n){const tag=b[o++];if(tag===0x3b){if(o!==n)bad();end=true;break;}
      if(tag===0x21){bounds(o,1);o++;blocks();}
      else if(tag===0x2c){bounds(o,9);const w=v.getUint16(o+4,true),h=v.getUint16(o+6,true);dims(w,h);if(v.getUint16(o,true)+w>width||v.getUint16(o+2,true)+h>height)bad();const flags=b[o+8],palette=flags&128?1<<((flags&7)+1):b[10]&128?1<<((b[10]&7)+1):0;if(!palette)bad();o+=9;if(flags&128)o+=3*palette;bounds(o,1);const min=b[o++];if(min<2||min>8)bad();const data=[];while(true){bounds(o,1);const l=b[o++];if(!l)break;bounds(o,l);for(let j=0;j<l;j++)data.push(b[o++]);}validateGifLzw(new Uint8Array(data),min,w*h,palette,bad);frames++;totalPixels+=w*h;if(frames>MediaTools.maxFrames||totalPixels>MediaTools.maxFramePixels)bad();}else bad();
    }if(!end||!frames)bad();animated=frames>1;
  }else if(n>=20&&text(0,4)==='RIFF'&&text(8,4)==='WEBP'){
    type='image/webp';if(v.getUint32(4,true)+8!==n)bad();let o=12,frames=0,image=false,animHeader=false,totalPixels=0;
    while(o<n){bounds(o,8);const tag=text(o,4),len=v.getUint32(o+4,true);bounds(o+8,len);const p=o+8;
      if(tag==='VP8X'){if(len!==10)bad();dims(1+(b[p+4]|b[p+5]<<8|b[p+6]<<16),1+(b[p+7]|b[p+8]<<8|b[p+9]<<16));animated=!!(b[p]&2);}
      if(tag==='VP8 '){if(len<10||text(p+3,3)!=='\x9d\x01\x2a')bad();dims(v.getUint16(p+6,true)&0x3fff,v.getUint16(p+8,true)&0x3fff);image=true;}
      if(tag==='VP8L'){if(len<5||b[p]!==0x2f)bad();const bits=v.getUint32(p+1,true);dims((bits&0x3fff)+1,((bits>>>14)&0x3fff)+1);image=true;}
      if(tag==='ANIM'){if(len!==6)bad();animHeader=true;}
      if(tag==='ANMF'){if(len<24)bad();const w=1+(b[p+6]|b[p+7]<<8|b[p+8]<<16),h=1+(b[p+9]|b[p+10]<<8|b[p+11]<<16);dims(w,h);let q=p+16,frame=false;while(q<p+len){bounds(q,8);const size=v.getUint32(q+4,true);if(q+8+size>p+len)bad();const t=text(q,4);if(t==='VP8 '||t==='VP8L'){if(size<5||frame)bad();const z=q+8;let fw,fh;if(t==='VP8L'){if(b[z]!==0x2f)bad();const bits=v.getUint32(z+1,true);fw=(bits&0x3fff)+1;fh=((bits>>>14)&0x3fff)+1;}else{if(size<10||text(z+3,3)!=='\x9d\x01\x2a')bad();fw=v.getUint16(z+6,true)&0x3fff;fh=v.getUint16(z+8,true)&0x3fff;}dims(fw,fh);if(fw!==w||fh!==h)bad();frame=true;}q+=8+size+(size&1);}if(q!==p+len||!frame)bad();frames++;totalPixels+=w*h;if(frames>MediaTools.maxFrames||totalPixels>MediaTools.maxFramePixels)bad();}
      o+=8+len+(len&1);if(o>n)bad();
    }if(o!==n||(!image&&!(animated&&animHeader&&frames)))bad();
  }else if(n>=4&&b[0]===255&&b[1]===216){
    type='image/jpeg';let o=2,frame=false,scan=false,end=false;
    while(o<n){if(b[o++]!==255)bad();while(b[o]===255)o++;bounds(o,1);const marker=b[o++];if(marker===217){if(o!==n)bad();end=true;break;}if(marker===0||marker===216)bad();bounds(o,2);const len=v.getUint16(o);if(len<2)bad();bounds(o,len);
      if([192,193,194].includes(marker)){if(len<8)bad();dims(v.getUint16(o+5),v.getUint16(o+3));frame=true;}
      o+=len;if(marker===218){scan=true;let bytes=0;while(o<n){if(b[o]!==255){o++;bytes++;continue;}if(b[o+1]===0||b[o+1]>=208&&b[o+1]<=215){o+=2;bytes++;continue;}break;}if(!bytes)bad();}
    }if(!frame||!scan||!end)bad();
  }else bad();
  if(declared!==type)throw new Error('File content does not match its declared image type.');
  return{type,animated};
}
