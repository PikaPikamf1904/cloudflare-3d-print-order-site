/* Limits are shared by the Worker, editor and tests. */
(function(root){
  root.MediaTools=Object.freeze({maxItems:10,maxPixels:16000000,maxFrames:500,maxFramePixels:128000000,maxPreviewBytes:256*1024,maxBytes:10*1024*1024,types:['image/jpeg','image/png','image/webp','image/gif'],accept:'.jpg,.jpeg,.png,.webp,.gif',
    items:p=>p.media?.length?p.media:(p.imageUrl?[{id:'legacy',url:p.imageUrl,alt:p.imageAlt||p.name,animated:/\.(gif|webp)$/i.test(p.imageUrl)}]:[])});
})(globalThis);
