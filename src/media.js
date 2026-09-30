import '../public/media-tools.js';
import {inspectImage} from './image-validation.js';
import {validateCompressed} from './compressed-validation.js';
class MediaError extends Error{constructor(message,status=400){super(message);this.status=status;}}
const fail=(m,s)=>{throw new MediaError(m,s);};
const stmt=(e,sql,...args)=>e.DB.prepare(sql).bind(...args);
export async function mediaFor(e,productId){return(await stmt(e,"SELECT id,alt,animated,content_type,preview_key FROM product_media WHERE product_id=? AND state='ready' ORDER BY sort_order,id",productId).all()).results.map(x=>({id:x.id,url:`/media/${x.id}`,...(x.preview_key?{previewUrl:`/media/${x.id}/preview`}:{}),alt:x.alt,animated:!!x.animated,type:x.content_type}));}
async function bytes(r,max){if(Number(r.headers.get('content-length')||0)>max)fail('File or request exceeds the size limit.',413);let size=0,chunks=[];const reader=r.body?.getReader();if(!reader)fail('Missing file.');while(true){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();fail('File or request exceeds the size limit.',413);}chunks.push(value);}const b=new Uint8Array(size);let o=0;for(const c of chunks){b.set(c,o);o+=c.length;}return b;}
async function cleanup(e,key){
  // Retain bytes if the database is unavailable or the commit outcome is uncertain.
  try{if(!await stmt(e,"SELECT id FROM product_media WHERE (object_key=? OR preview_key=?) AND state IN ('ready','pending')",key,key).first())await e.PRODUCT_MEDIA.delete(key);}catch{console.warn('Media cleanup deferred; reconcile unreferenced objects.');}
}
export async function mediaRoutes(r,e,{admin,json,decodeWebp}){
  const u=new URL(r.url),publicMatch=/^\/media\/([a-f0-9-]{36})(\/preview)?$/.exec(u.pathname),m=/^\/api\/admin\/products\/([a-zA-Z0-9-]{1,80})\/media$/.exec(u.pathname);
  if(!publicMatch&&!m)return null;
  try{
    if(publicMatch){
      if(!['GET','HEAD'].includes(r.method))fail('Method not allowed.',405);
      const row=await stmt(e,"SELECT m.* ,p.enabled,p.archived_at FROM product_media m JOIN catalog_products p ON p.id=m.product_id WHERE m.id=? AND m.state='ready'",publicMatch[1]).first();
      const privileged=await admin(r,e);if(!row||(!privileged&&(!row.enabled||row.archived_at)))fail('Photo not found.',404);
      const isPreview=!!publicMatch[2],objectKey=isPreview?row.preview_key:row.object_key;if(!objectKey)fail('Photo not found.',404);
      const object=await e.PRODUCT_MEDIA?.get(objectKey);if(!object)fail('Photo not found.',404);
      return new Response(r.method==='HEAD'?null:object.body,{headers:{'content-type':isPreview?'image/png':row.content_type,'content-length':String(isPreview?row.preview_size:row.byte_size),'cache-control':privileged?'private, no-store':'public, max-age=300, must-revalidate','etag':object.httpEtag,'x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox",'cross-origin-resource-policy':'same-origin','referrer-policy':'no-referrer'}});
    }
    if(!await admin(r,e))fail('Incorrect admin key.',401);
    if(r.headers.get('origin')&&r.headers.get('origin')!==u.origin||r.headers.get('sec-fetch-site')==='cross-site')fail('Cross-origin media changes are not allowed.',403);
    const p=await stmt(e,'SELECT id,name,media_version FROM catalog_products WHERE id=?',m[1]).first();if(!p)fail('Product not found.',404);
    const response=async(status=200)=>{const data=await e.DB.batch([stmt(e,'SELECT media_version FROM catalog_products WHERE id=?',p.id),stmt(e,"SELECT id,alt,animated,content_type,preview_key FROM product_media WHERE product_id=? AND state='ready' ORDER BY sort_order,id",p.id)]);return json({mediaVersion:data[0].results[0].media_version,media:data[1].results.map(x=>({id:x.id,url:`/media/${x.id}`,...(x.preview_key?{previewUrl:`/media/${x.id}/preview`}:{}),alt:x.alt,animated:!!x.animated,type:x.content_type}))},status);};
    if(r.method==='GET')return response();
    if(r.method==='POST'){
      if(!e.PRODUCT_MEDIA)fail('Product media storage is not configured.',503);
      const token=r.headers.get('x-upload-id');if(!/^[a-f0-9-]{36}$/.test(token||''))fail('A unique upload identifier is required.');
      let b,preview,declared=r.headers.get('content-type');
      if(declared?.startsWith('multipart/form-data;')){
        const raw=await bytes(r,MediaTools.maxBytes+MediaTools.maxPreviewBytes+8192);let form;try{form=await new Request(r.url,{method:'POST',headers:{'content-type':declared},body:raw}).formData();}catch{fail('Malformed upload.',415);}
        const file=form.get('file'),thumb=form.get('preview');if(!file||typeof file.arrayBuffer!=='function'||[...form.keys()].some(k=>!['file','preview'].includes(k))||form.getAll('file').length!==1||form.getAll('preview').length>1)fail('Invalid upload.');
        b=new Uint8Array(await file.arrayBuffer());declared=file.type;
        if(thumb){if(typeof thumb.arrayBuffer!=='function'||thumb.type!=='image/png'||thumb.size>MediaTools.maxPreviewBytes)fail('Invalid preview.',415);preview=new Uint8Array(await thumb.arrayBuffer());try{const previewInfo=inspectImage(preview,'image/png');if(previewInfo.animated)fail('Preview must be still.',415);await validateCompressed(preview,previewInfo,decodeWebp);}catch{fail('Invalid preview.',415);}}
      }else b=await bytes(r,MediaTools.maxBytes);
      if(b.length>MediaTools.maxBytes)fail('File exceeds 10 MB.',413);if(!b.length)fail('Empty file.');let info;try{info=inspectImage(b,declared);}catch(x){fail(x.message,415);}
      try{await validateCompressed(b,info,decodeWebp);}catch{fail('Malformed compressed image data or excessive decoded size.',415);}
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('');
      const previous=await stmt(e,'SELECT * FROM product_media WHERE id=?',token).first();
      if(previous){if(previous.product_id!==p.id||previous.digest!==digest||previous.state!=='ready')fail('Upload identifier was already used.',409);return response();}
      const expected=r.headers.get('x-media-version');if(expected!==null&&(!/^\d+$/.test(expected)||Number(expected)!==p.media_version))fail('Media changed. Reload saved media.',409);
      const replace=r.headers.get('x-replace-id')||null;
      let old;if(replace){old=await stmt(e,"SELECT * FROM product_media WHERE id=? AND product_id=? AND state='ready'",replace,p.id).first();if(!old)fail('Replacement photo changed. Reload media.',409);}
      const key=`products/${p.id}/${crypto.randomUUID()}`;
      try{
        await e.PRODUCT_MEDIA.put(key,b,{httpMetadata:{contentType:info.type}});
        if(preview)await e.PRODUCT_MEDIA.put(key+'/preview',preview,{httpMetadata:{contentType:'image/png'}});
        const insert=stmt(e,"INSERT INTO product_media(id,product_id,object_key,preview_key,preview_size,content_type,byte_size,digest,animated,alt,sort_order,state,replace_id) SELECT ?,?,?,?,?,?,?,?,?,?,?,'ready',? WHERE (? IS NULL OR EXISTS(SELECT 1 FROM product_media WHERE id=? AND product_id=? AND state='ready')) AND (? IS NULL OR EXISTS(SELECT 1 FROM catalog_products WHERE id=? AND media_version=?))",token,p.id,key,preview?key+'/preview':null,preview?.length??null,info.type,b.length,digest,+info.animated,old?.alt||`${p.name} photo`.slice(0,200),old?.sort_order??Date.now(),replace,replace,replace,p.id,expected,p.id,expected===null?null:Number(expected));
        const writes=[insert];
        if(old)writes.push(stmt(e,"UPDATE product_media SET state='deleted' WHERE id=? AND EXISTS(SELECT 1 FROM product_media WHERE id=? AND object_key=?)",old.id,token,key));
        writes.push(stmt(e,'UPDATE catalog_products SET media_version=media_version+1 WHERE id=? AND EXISTS(SELECT 1 FROM product_media WHERE id=? AND object_key=?)',p.id,token,key));
        const result=await e.DB.batch(writes);if(!result[0].meta.changes)fail('Replacement changed. Reload media.',409);
      }catch(x){await cleanup(e,key);if(preview)await cleanup(e,key+'/preview');if(x instanceof MediaError)throw x;if(String(x.message).includes('media_limit'))fail(`A product can have at most ${MediaTools.maxItems} uploaded media items.`,409);if(String(x.message).includes('media_replace_conflict'))fail('Replacement changed. Reload media.',409);
        const existing=await stmt(e,'SELECT * FROM product_media WHERE id=?',token).first();if(existing?.state==='ready'&&existing.product_id===p.id&&existing.digest===digest)return response();throw x;
      }
      if(old){await cleanup(e,old.object_key);if(old.preview_key)await cleanup(e,old.preview_key);}return response(201);
    }
    if(r.method==='PATCH'){
      let b;try{b=JSON.parse(new TextDecoder().decode(await bytes(r,8192)));}catch(x){if(x instanceof MediaError)throw x;fail('Invalid media update.');}
      if(!b||Object.keys(b).some(k=>!['mediaVersion','items'].includes(k))||!Array.isArray(b.items)||b.items.length>MediaTools.maxItems)fail('Invalid media update.');
      if(b.mediaVersion!==p.media_version)fail('Media changed. Reload media before saving.',409);
      const rows=(await stmt(e,"SELECT * FROM product_media WHERE product_id=? AND state='ready'",p.id).all()).results;
      const seen=new Set();for(const item of b.items){if(!item||Object.keys(item).some(k=>!['id','alt'].includes(k))||seen.has(item.id)||!rows.some(x=>x.id===item.id)||typeof item.alt!=='string'||item.alt.trim().length<3||item.alt.length>200||/[\u0000-\u001f]/.test(item.alt))fail('Each photo needs a unique identifier and meaningful alt text (3–200 characters).');seen.add(item.id);}
      const version=p.media_version+1,guardId=crypto.randomUUID();
      const writes=[stmt(e,'UPDATE catalog_products SET media_version=?,media_guard=? WHERE id=? AND media_version=?',version,guardId,p.id,p.media_version)];
      const guard=' AND EXISTS(SELECT 1 FROM catalog_products WHERE id=? AND media_guard=?)';
      b.items.forEach((item,i)=>writes.push(stmt(e,'UPDATE product_media SET alt=?,sort_order=?,replace_id=NULL WHERE id=? AND product_id=?'+guard,item.alt.trim(),i,item.id,p.id,p.id,guardId)));
      const removed=rows.filter(x=>!seen.has(x.id));for(const row of removed)writes.push(stmt(e,"UPDATE product_media SET state='deleted' WHERE id=?"+guard,row.id,p.id,guardId));
      const result=await e.DB.batch(writes);if(!result[0].meta.changes)fail('Media changed. Reload media before saving.',409);
      for(const row of removed){await cleanup(e,row.object_key);if(row.preview_key)await cleanup(e,row.preview_key);}return response();
    }
    fail('Method not allowed.',405);
  }catch(x){return json({error:x instanceof MediaError?x.message:'Media could not be saved. Retry the same file; successful uploads will not be duplicated.'},x instanceof MediaError?x.status:500);}
}
