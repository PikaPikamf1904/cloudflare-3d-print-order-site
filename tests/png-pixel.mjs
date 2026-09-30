import {inflateSync} from 'node:zlib';
// Read actual rendered Chrome screenshot pixels, including PNG scanline filters.
export function pngPixel(encoded,x,y){
  const b=Buffer.from(encoded,'base64'),width=b.readUInt32BE(16),height=b.readUInt32BE(20),channels=b[25]===6?4:b[25]===2?3:0;
  if(b[24]!==8||!channels||x<0||y<0||x>=width||y>=height)throw Error('Unsupported screenshot or pixel coordinates.');
  const chunks=[];for(let o=8;o<b.length;){const n=b.readUInt32BE(o);if(b.toString('ascii',o+4,o+8)==='IDAT')chunks.push(b.subarray(o+8,o+8+n));o+=n+12;}
  const raw=inflateSync(Buffer.concat(chunks)),stride=width*channels;let previous=new Uint8Array(stride),o=0;
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let row=0;row<=y;row++){const filter=raw[o++],current=new Uint8Array(stride);for(let i=0;i<stride;i++){const left=i>=channels?current[i-channels]:0,up=previous[i],corner=i>=channels?previous[i-channels]:0;const predictor=[0,left,up,Math.floor((left+up)/2),paeth(left,up,corner)][filter];if(predictor===undefined)throw Error('Invalid screenshot filter.');current[i]=(raw[o++]+predictor)&255;}previous=current;}
  return Array.from(previous.slice(x*channels,x*channels+3)).join(',');
}
