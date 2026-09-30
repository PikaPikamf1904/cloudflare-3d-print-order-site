import decode,{init} from '@jsquash/webp/decode.js';
import wasm from '../node_modules/@jsquash/webp/codec/dec/webp_dec.wasm';
let initialized;
export async function decodeWebp(bytes){
  if(!globalThis.ImageData)globalThis.ImageData=class{constructor(data,width,height){Object.assign(this,{data,width,height});}};
  initialized??=init(wasm);await initialized;
  return decode(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
}
