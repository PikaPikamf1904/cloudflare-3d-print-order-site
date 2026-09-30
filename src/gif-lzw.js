// Validate dictionary expansion without allocating the decompressed pixel canvas.
export function validateGifLzw(data,min,pixels,palette,bad){
  const clear=1<<min,end=clear+1,lengths=new Uint16Array(4096),first=new Uint16Array(4096);for(let i=0;i<clear;i++){lengths[i]=1;first[i]=i;}
  let bit=0,bits=min+1,next=end+1,previous=-1,count=0,ended=false;
  while(bit+bits<=data.length*8){let code=0;for(let j=0;j<bits;j++)code|=((data[(bit+j)>>3]>>((bit+j)&7))&1)<<j;bit+=bits;
    if(code===clear){bits=min+1;next=end+1;previous=-1;continue;}if(code===end){ended=true;break;}
    if(code>next||code===next&&previous<0||code>=4096)bad();
    const isNew=code===next,len=isNew?lengths[previous]+1:lengths[code],lead=isNew?first[previous]:first[code];if(!len||lead>=palette)bad();count+=len;if(count>pixels)bad();
    if(previous>=0&&next<4096){lengths[next]=lengths[previous]+1;first[next]=first[previous];next++;if(next===(1<<bits)&&bits<12)bits++;}previous=code;
  }if(!ended||count!==pixels)bad();
}
