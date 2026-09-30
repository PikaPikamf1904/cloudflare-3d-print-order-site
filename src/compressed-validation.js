import jpeg from 'jpeg-js';
import {inflateSync} from 'node:zlib';
export async function validateCompressed(bytes,info,decodeWebp){
  // Structural validation runs first and bounds dimensions before allocation.
  if(info.type==='image/jpeg')jpeg.decode(bytes,{useTArray:true,formatAsRGBA:false,tolerantDecoding:false,maxResolutionInMP:16,maxMemoryUsageInMB:80});
  if(info.type==='image/png'){
    const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),w=v.getUint32(16),h=v.getUint32(20),depth=bytes[24],channels=({0:1,2:3,3:1,4:2,6:4})[bytes[25]],interlace=bytes[28];
    const passes=interlace?[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]:[[0,0,1,1]];
    const rows=[];let expected=0;for(const[x,y,dx,dy]of passes){const pw=Math.max(0,Math.ceil((w-x)/dx)),ph=Math.max(0,Math.ceil((h-y)/dy));if(!pw||!ph)continue;const stride=Math.ceil(pw*channels*depth/8)+1;rows.push([stride,ph]);expected+=stride*ph;}
    if(expected>80*1024*1024)throw Error('Decoded image too large.');
    const chunks=[];let o=8;while(o<bytes.length){const len=v.getUint32(o);if(String.fromCharCode(...bytes.slice(o+4,o+8))==='IDAT')chunks.push(Buffer.from(bytes.buffer,bytes.byteOffset+o+8,len));o+=len+12;}
    const decoded=inflateSync(Buffer.concat(chunks),{maxOutputLength:expected});if(decoded.length!==expected)throw Error('Invalid PNG pixels.');
    o=0;for(const[stride,count]of rows)for(let y=0;y<count;y++){if(decoded[o]>4)throw Error('Invalid PNG filter.');o+=stride;}
  }
  if(info.type==='image/webp'){
    if(!decodeWebp)throw Error('WebP decoder unavailable.');
    if(!info.animated){await decodeWebp(bytes);return;}
    // Decode every animation frame as a standalone WebP; retain original bytes.
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let o=12;
    while(o<bytes.length){const size=view.getUint32(o+4,true),tag=String.fromCharCode(...bytes.slice(o,o+4));if(tag==='ANMF'){
      const start=o+8,content=bytes.slice(start+16,start+size),vp8x=new Uint8Array(18);vp8x.set([86,80,56,88,10,0,0,0,16,0,0,0]);vp8x.set(bytes.slice(start+6,start+9),12);vp8x.set(bytes.slice(start+9,start+12),15);
      const frame=new Uint8Array(12+vp8x.length+content.length);frame.set([82,73,70,70,0,0,0,0,87,69,66,80]);new DataView(frame.buffer).setUint32(4,frame.length-8,true);frame.set(vp8x,12);frame.set(content,30);await decodeWebp(frame);
    }o+=8+size+(size&1);}
  }
}
