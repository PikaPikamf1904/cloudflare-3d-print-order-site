class ProductMediaEditor {
  constructor(manager,host,edit){this.m=manager;this.host=host;this.edit=edit;this.items=(manager.current?.media||[]).map(x=>({...x}));this.version=manager.current?.mediaVersion||0;this.queue=[];this.dirty=false;this.urls=[];
    // A file dropped outside the drop area must not make the browser open it and discard unsaved fields.
    this.guard=e=>{if(this.disposed||![...(e.dataTransfer?.types||[])].includes('Files'))return;e.preventDefault();if(e.type==='drop'&&!this.host.contains(e.target)&&this.message)this.message.textContent='Drop files onto the Photos and GIFs area to upload them.';};
    addEventListener('dragover',this.guard);addEventListener('drop',this.guard);this.draw();}
  el(...a){return this.m.el(...a);} button(...a){return this.m.button(...a);} path(){return `/api/admin/products/${this.m.current.id}/media`;}
  dispose(){this.disposed=true;removeEventListener('dragover',this.guard);removeEventListener('drop',this.guard);this.urls.forEach(x=>URL.revokeObjectURL(x));}
  changed(){this.dirty=true;this.m.dirty=true;}
  draw(){
    this.host.replaceChildren(this.el('h3','Photos and GIFs'),this.el('p',`Up to ${MediaTools.maxItems} uploaded items, ${MediaTools.maxBytes/1024/1024} MB each. Uploads and replacements save immediately. Cover, order, alt text and removals save with “Save media” or “Save product”. Other product fields stay unsaved until “Save product”.`,'catalog-help'));
    if(!this.m.current){this.host.append(this.el('p','Save this new product first, then edit it to upload files.'));return;}
    if(this.edit){this.picker=document.createElement('input');this.picker.type='file';this.picker.multiple=true;this.picker.accept=MediaTools.accept;this.picker.hidden=true;this.picker.setAttribute('aria-label','Choose product photos or GIFs');this.picker.onchange=()=>{this.add(this.picker.files);this.picker.value='';};this.host.append(this.picker,this.button('Upload photos or GIFs',()=>this.picker.click()));
      const drop=this.el('div','Or drag photos or GIFs from your computer and drop them anywhere in this box','media-drop');this.host.append(drop);
      const files=e=>[...(e.dataTransfer?.types||[])].includes('Files');let depth=0;
      this.host.ondragenter=e=>{if(!files(e))return;e.preventDefault();depth++;this.host.classList.add('media-dragging');};
      this.host.ondragover=e=>{if(!files(e))return;e.preventDefault();e.dataTransfer.dropEffect='copy';};
      this.host.ondragleave=()=>{if(--depth<=0){depth=0;this.host.classList.remove('media-dragging');}};
      this.host.ondrop=e=>{if(!files(e))return;e.preventDefault();e.stopPropagation();depth=0;this.host.classList.remove('media-dragging');this.add(e.dataTransfer.files);};}
    this.list=this.el('div','','media-list');this.queueBox=this.el('div','','media-queue');this.queueBox.setAttribute('aria-live','polite');this.message=this.el('p','','media-message');this.message.setAttribute('role','status');this.host.append(this.list,this.queueBox,this.message);this.renderItems();
    if(this.edit)this.host.append(this.button('Save media',()=>this.save().catch(e=>this.message.textContent=e.message)),this.button('Reload saved media',async()=>{if(this.m.mediaBusy)return;if(this.dirty&&!await this.m.confirm('Discard unsaved media changes?','Other product edits stay in the form.'))return;try{const d=await this.m.api(this.path());this.items=d.media;this.version=d.mediaVersion;this.dirty=false;this.renderItems();this.message.textContent='Media reloaded. Other edits remain in the form.';}catch(e){this.message.textContent=e.message;}}));
  }
  renderItems(focus){
    this.list.replaceChildren();if(!this.items.length)this.list.append(this.el('p',this.m.current.imageUrl?'The existing image URL remains available when there are no uploaded photos.':'No uploaded photos yet.'));
    this.items.forEach((item,i)=>{
      const row=this.el('div','','media-row');row.dataset.mediaId=item.id;const preview=this.el('div','','media-preview');preview.append(this.el('span',item.animated?'Animation':'Loading preview'));
      const load=async()=>{try{const blob=await this.m.api(item.previewUrl||item.url,{responseType:'blob'});if(this.disposed)return;const url=URL.createObjectURL(blob);this.urls.push(url);const img=document.createElement('img');img.src=url;img.alt=item.alt;preview.replaceChildren(img);}catch{preview.textContent='Preview unavailable';}};
      if(item.animated&&!item.previewUrl)preview.append(this.button('Play preview',load));else load();row.append(preview,this.el('strong',i===0?'Cover image':`Image ${i+1}`));
      const alt=this.m.control('text',item.alt,`Alt text for image ${i+1}`);alt.maxLength=200;alt.disabled=!this.edit;alt.oninput=()=>{item.alt=alt.value;this.changed();};row.append(this.m.label('Alt text',alt));
      if(this.edit){const actions=this.el('div','','catalog-actions');const move=to=>{if(this.m.mediaBusy)return;this.items.splice(i,1);this.items.splice(to,0,item);this.changed();this.renderItems(item.id);};
        const cover=this.button('Use as cover',()=>move(0)),up=this.button('Move earlier',()=>move(i-1)),down=this.button('Move later',()=>move(i+1));cover.disabled=up.disabled=i===0;down.disabled=i===this.items.length-1;
        const replacement=document.createElement('input');replacement.type='file';replacement.accept=MediaTools.accept;replacement.hidden=true;replacement.setAttribute('aria-label',`Replace image ${i+1}`);replacement.onchange=()=>{this.add(replacement.files,item.id);replacement.value='';};
        actions.append(cover,up,down,this.button('Replace',()=>{if(!this.m.mediaBusy)replacement.click();}),replacement,this.button('Remove',async()=>{if(this.m.mediaBusy)return;if(await this.m.confirm('Remove this photo?','Removal takes effect when you save media or save the product.')){this.items=this.items.filter(x=>x.id!==item.id);this.changed();this.renderItems();}}));row.append(actions);}
      this.list.append(row);
    });if(focus)this.list.querySelector(`[data-media-id="${focus}"] button:not(:disabled)`)?.focus();
  }
  add(files,replaceId){
    if(this.m.busy||this.saving){this.message.textContent='Wait for the current save to finish, then add the files again.';return;}for(const file of files){const pending=this.queue.filter(x=>!x.replaceId&&x.status!=='Saved').length;
      if(!replaceId&&Math.max(this.items.length,this.m.current.media?.length||0)+pending>=MediaTools.maxItems){this.message.textContent='Media limit reached. Save removals before uploading more.';break;}
      const ext=file.name.split('.').pop().toLowerCase(),type=file.type||({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif'})[ext];
      if(!MediaTools.types.includes(type)||!file.size||file.size>MediaTools.maxBytes){this.message.textContent=`${file.name}: choose JPEG, PNG, WebP or GIF up to 10 MB.`;continue;}
      const url=URL.createObjectURL(file);this.urls.push(url);this.queue.push({file,type,replaceId,id:crypto.randomUUID(),url,status:'Waiting'});
    }this.renderQueue();this.uploadWaiting();
  }
  renderQueue(){this.queueBox.replaceChildren();for(const job of this.queue){const row=this.el('div','','media-row');row.append(this.el('span',`${job.file.name}: ${job.status}${job.error?' — '+job.error:''}`));
    if(job.status!=='Saved')row.append(this.button('Preview file',()=>{const img=document.createElement('img');img.src=job.url;img.alt=job.file.name;img.className='media-local-preview';row.prepend(img);}));
    if(job.status==='Failed')row.append(this.button('Retry',()=>{if(this.m.mediaBusy)return;job.status='Waiting';this.uploadWaiting();}),this.button('Dismiss failed file',()=>{if(this.m.mediaBusy)return;this.queue=this.queue.filter(x=>x!==job);this.renderQueue();}));this.queueBox.append(row);}}
  async uploadWaiting(){
    if(this.uploading)return;this.uploading=this.m.mediaBusy=true;try{for(let job;(job=this.queue.find(x=>x.status==='Waiting'));){if(this.disposed)break;job.status='Uploading';this.renderQueue();
      try{const expectedVersion=this.version;const image=await createImageBitmap(job.file);if(image.width>16384||image.height>16384||image.width*image.height>MediaTools.maxPixels){image.close();throw new Error('Image dimensions are too large.');}
        const canvas=document.createElement('canvas'),scale=Math.min(1,240/image.width,240/image.height);canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);image.close();
        const thumbnail=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const form=new FormData();form.append('file',new Blob([job.file],{type:job.type}),job.file.name);if(thumbnail&&thumbnail.size<=MediaTools.maxPreviewBytes)form.append('preview',thumbnail,'preview.png');
        const d=await this.m.api(this.path(),{method:'POST',headers:{'x-upload-id':job.id,'x-media-version':String(expectedVersion),...(job.replaceId?{'x-replace-id':job.replaceId}:{})},body:form});const uploaded=d.media.find(x=>x.id===job.id);if(!uploaded)throw new Error('Upload result unavailable; retry.');const index=job.replaceId?this.items.findIndex(x=>x.id===job.replaceId):-1;
        if(index>=0)this.items.splice(index,1,{...uploaded,alt:this.items[index].alt});else if(!this.items.some(x=>x.id===job.id))this.items.push(uploaded);
        this.m.current.media=d.media;this.m.current.mediaVersion=d.mediaVersion;this.version=expectedVersion+1;job.status='Saved';job.error='';this.renderItems();
      }catch(e){job.status='Failed';job.error=e.message;}this.renderQueue();}
    }finally{this.uploading=this.m.mediaBusy=false;}
  }
  async save(){
    if(this.m.mediaBusy)throw new Error('Wait for uploads to finish.');if(this.queue.some(x=>x.status==='Failed'))throw new Error('Retry or dismiss failed files before saving.');if(!this.dirty)return;
    this.saving=this.m.mediaBusy=true;try{const d=await this.m.api(this.path(),{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({mediaVersion:this.version,items:this.items.map(({id,alt})=>({id,alt}))})});this.items=d.media;this.version=d.mediaVersion;this.m.current.media=d.media;this.m.current.mediaVersion=d.mediaVersion;this.dirty=false;this.renderItems();this.message.textContent='Media saved. Other product edits remain unsaved.';}finally{this.saving=this.m.mediaBusy=false;}
  }
}
