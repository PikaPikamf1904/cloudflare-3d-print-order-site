/* Existing header-authenticated API is injected; no credentials are stored here. */
class ProductManager {
  constructor({api, toast, confirm}) {
    Object.assign(this, {api, toast, confirm, products: [], dirty: false, busy: false});
    this.box = document.querySelector('#product-editor');
    const tools = this.el('div', '', 'catalog-toolbar');
    this.search = this.control('search', '', 'Search products'); this.search.placeholder = 'Search products';
    this.filter = document.createElement('select'); this.filter.setAttribute('aria-label','Product visibility');
    for (const [value,label] of [['all','All products'],['active','Active'],['disabled','Disabled'],['archived','Removed from store']]) { const o=this.el('option',label);o.value=value;this.filter.append(o); }
    tools.append(this.label('Search',this.search),this.label('Visibility',this.filter),this.button('Add product',()=>this.open()));
    this.box.before(tools); this.search.addEventListener('input',()=>this.render());this.filter.addEventListener('change',()=>this.render());
    this.dialog=document.createElement('dialog');this.dialog.id='product-dialog';this.dialog.className='catalog-dialog';this.dialog.setAttribute('aria-label','Product details');document.body.append(this.dialog);
    this.colorSuggestions=document.createElement('datalist');this.colorSuggestions.id='product-color-suggestions';document.body.append(this.colorSuggestions);
    this.dialog.addEventListener('cancel',event=>{event.preventDefault();this.close();});
    window.addEventListener('beforeunload',event=>{if(this.dirty){event.preventDefault();event.returnValue='';}});
  }
  el(tag,value='',className=''){const n=document.createElement(tag);n.textContent=value;n.className=className;return n;}
  button(label,fn,style='button button-secondary'){const b=this.el('button',label,style);b.type='button';b.addEventListener('click',fn);return b;}
  control(type,value,label){const n=document.createElement(type==='textarea'?'textarea':'input');if(type!=='textarea')n.type=type;n.value=value??'';n.setAttribute('aria-label',label);return n;}
  label(title,control){const l=this.el('label',title);l.append(control);return l;}
  money(c){return `$${Math.trunc(c/100)}.${String(c%100).padStart(2,'0')}`;}
  setProducts(products){this.products=products;this.refreshColorSuggestions();document.querySelector('#products-state').hidden=true;this.render();}
  refreshColorSuggestions(){const names=[...new Set(this.products.flatMap(p=>p.colors.map(c=>c.color)).filter(Boolean))].sort((a,b)=>a.localeCompare(b));this.colorSuggestions.replaceChildren(...names.map(name=>{const option=document.createElement('option');option.value=name;return option;}));}
  async refresh(){const data=await this.api('/api/admin/products');this.setProducts(data.products);}
  status(p){return p.archivedAt?'Removed':p.enabled?'Active':'Disabled';}
  state(p){return p.archivedAt?'archived':p.enabled?'active':'disabled';}
  render(){
    this.box.replaceChildren();
    const list=this.products.filter(p=>p.name.toLowerCase().includes(this.search.value.trim().toLowerCase())&&(this.filter.value==='all'||this.state(p)===this.filter.value));
    for(const p of list){
      const card=this.el('article','','product-card catalog-card');card.append(ProductTools.picture(p),this.el('h3',p.name));
      const prices=p.colors.filter(c=>c.enabled).map(c=>c.priceCents); const low=prices.length?Math.min(...prices):0,high=prices.length?Math.max(...prices):0;
      card.append(this.el('span',this.status(p),'status-pill'),this.el('p',`${p.colors.filter(c=>c.enabled).length} enabled colors · ${this.money(low)}${low!==high?' – '+this.money(high):''} · Display order ${p.sortOrder}`));
      const actions=this.el('div','','catalog-actions');actions.append(this.button('View details',()=>this.open(p.id)));
      if(!p.archivedAt)actions.append(this.button(p.enabled?'Disable':'Enable',()=>this.toggle(p)));
      actions.append(this.button(p.archivedAt?'Add back to store':'Remove from store',()=>this.archive(p)));card.append(actions);this.box.append(card);
    }
    if(!list.length)this.box.append(this.el('p','No products match these filters.','state-card'));
  }
  body(p){const {id,archivedAt,...body}=p;return body;}
  async toggle(p){if(this.busy||this.mediaBusy)return;this.busy=true;try{await this.api(`/api/admin/products/${p.id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({...this.body(p),enabled:!p.enabled})});await this.refresh();this.toast('Product availability saved.');}catch(e){this.toast(e.message);}finally{this.busy=false;}}
  async archive(p){if(this.busy||this.mediaBusy)return;const action=p.archivedAt?'restore':'archive';if(!await this.confirm(action==='archive'?'Remove product from store?':'Add product back to store?',action==='archive'?'This hides the product from new orders. Existing receipts and locked prices remain unchanged. You can add it back later.':'This returns the product to its previous enabled or disabled state.'))return;
    this.busy=true;try{await this.api(`/api/admin/products/${p.id}/${action}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:p.version})});await this.refresh();this.toast(action==='archive'?'Product removed from store.':'Product added back to store.');}catch(e){this.toast(e.message);}finally{this.busy=false;}
  }
  async close(){if(this.busy||this.mediaBusy)return;if(this.dirty&&!await this.confirm('Discard unsaved changes?','Unsaved product fields and media settings will be discarded. Completed uploads remain saved.'))return;this.dirty=false;this.mediaEditor?.dispose();this.dialog.close();}
  async open(id){
    if(this.busy||this.mediaBusy)return;this.dirty=false;this.dialog.replaceChildren(this.el('p','Loading product…'));this.dialog.showModal();
    try{this.current=id?(await this.api(`/api/admin/products/${id}`)).product:null;this.draw(!id);}catch(e){this.dialog.replaceChildren(this.el('p',e.message,'form-message'),this.button('Close',()=>this.close()));}
  }
  draw(edit){
    const p=this.current||{name:'',description:'',imageUrl:'',imageAlt:'',enabled:true,sortOrder:0,colors:[{color:'',priceCents:0,enabled:true,sortOrder:0,swatch:''}]};
    this.mediaEditor?.dispose();this.editing=edit;this.dirty=false;this.dialog.replaceChildren();
    const header=this.el('div','','panel-heading');header.append(this.el('h2',this.current?(edit?'Edit product':'Product details'):'Add product'),this.button('Close',()=>this.close()));this.dialog.append(header);
    this.form=document.createElement('form');this.form.className='catalog-form';this.dialog.append(this.form);this.controls={};
    for(const [key,rawTitle,type,max] of [['name','Product name','text',80],['description','Short description','textarea',500],['imageUrl','Image URL or site path','text',1000],['imageAlt','Image alt text','text',200],['sortOrder','Display order','number',null]]){
      const title=rawTitle,c=this.control(type,p[key],title);c.name=key;if(max)c.maxLength=max;if(key==='name')c.required=true;if(type==='number'){c.min=0;c.max=9999;c.step=1;}c.disabled=!edit;this.controls[key]=c;const label=this.label(title,c);if(key==='sortOrder')label.append(this.el('small','Lower numbers appear first.','field-help'));this.form.append(label);
    }
    const enabled=this.control('checkbox','', 'Product enabled');enabled.checked=p.enabled;enabled.disabled=!edit;this.controls.enabled=enabled;this.form.append(this.label('Product enabled',enabled));
    this.form.append(this.el('p','Upload files below, or keep a legacy HTTPS image URL or existing same-site image path. Supported raster formats: PNG, JPEG, WebP, GIF, AVIF, and ICO. Add meaningful alt text in the next field. External image hosts receive visitors’ image requests.','catalog-help'));
    const mediaHost=this.el('section','','product-media-editor');this.form.append(mediaHost);this.mediaEditor=new ProductMediaEditor(this,mediaHost,edit);
    this.variants=this.el('div','','catalog-variants');this.form.append(this.el('p','Color options belong to this product and have their own prices. Choose an existing color name from suggestions or type a new one; add it separately to each product that offers it.','catalog-help'),this.variants);for(const c of p.colors)this.variant(c,edit);
    if(edit)this.form.append(this.button('Add another color',()=>{this.variant({color:'',priceCents:0,enabled:true,sortOrder:this.variants.children.length,swatch:''},true);this.dirty=true;}));
    this.error=this.el('p','','form-message');this.error.setAttribute('role','alert');this.form.append(this.error);
    this.preview=this.el('div','','catalog-preview');this.form.append(this.preview);
    const actions=this.el('div','','catalog-actions');this.form.append(actions);
    if(edit){actions.append(this.button('Preview card',()=>{try{this.previewCard(this.collect());this.error.textContent='';}catch(e){this.error.textContent=e.message;}}),this.button('Cancel',async()=>{if(this.busy||this.mediaBusy)return;if(this.dirty&&!await this.confirm('Discard unsaved changes?','Unsaved product fields and media settings will be discarded. Completed uploads remain saved.'))return;if(this.current)this.draw(false);else{this.dirty=false;this.mediaEditor?.dispose();this.dialog.close();}}));const save=this.el('button','Save product','button button-primary');save.type='submit';actions.append(save);}else actions.append(this.button('Edit product',()=>this.draw(true),'button button-primary'));
    this.form.addEventListener('input',()=>{this.dirty=true;});this.form.addEventListener('change',()=>{this.dirty=true;});
    this.form.addEventListener('submit',event=>{event.preventDefault();if(edit)this.save();});
    if(p.imageUrl||!edit)this.previewCard(p);
  }
  variant(c,edit){
    const row=document.createElement('fieldset');row.className='catalog-variant';row.dataset.id=c.id||'';row.append(this.el('legend','Color and price'));row.inputs={};
    for(const [key,rawTitle,value,type] of [['color','Color name',c.color,'text'],['price','Price (USD)',this.money(c.priceCents).slice(1),'text'],['sortOrder','Display order',c.sortOrder,'number'],['swatch','Swatch (#RRGGBB)',c.swatch,'text']]){
      const title=rawTitle,x=this.control(type,value,title);x.disabled=!edit;if(key==='price')x.inputMode='decimal';if(key==='color'){x.required=true;x.maxLength=40;x.setAttribute('list','product-color-suggestions');}if(key==='swatch')x.maxLength=7;if(type==='number'){x.min=0;x.max=9999;x.step=1;}row.inputs[key]=x;const label=this.label(title,x);if(key==='sortOrder')label.append(this.el('small','Lower numbers appear first.','field-help'));row.append(label);
    }
    const enabled=this.control('checkbox','','Color available');enabled.checked=c.enabled;enabled.disabled=!edit;row.inputs.enabled=enabled;row.append(this.label('Color available',enabled));
    if(edit&&!c.id)row.append(this.button('Remove unsaved color',()=>{row.remove();this.dirty=true;}));this.variants.append(row);
  }
  collect(){const c=this.controls;const imageUrl=ProductTools.imageUrl(c.imageUrl.value.trim());if(imageUrl&&c.imageAlt.value.trim().length<3)throw new Error('Meaningful image alt text is required.');
    return { ...(this.current?{version:this.current.version}:{}),name:c.name.value.trim(),description:c.description.value.trim(),imageUrl,imageAlt:c.imageAlt.value.trim(),enabled:c.enabled.checked,sortOrder:Number(c.sortOrder.value),colors:[...this.variants.children].map(row=>({...(row.dataset.id?{id:row.dataset.id}:{}),color:row.inputs.color.value.trim(),priceCents:ProductTools.dollarsToCents(row.inputs.price.value),enabled:row.inputs.enabled.checked,sortOrder:Number(row.inputs.sortOrder.value),swatch:row.inputs.swatch.value.trim()}))};
  }
  previewCard(p){const card=this.el('article','','product-card');card.append(ProductTools.picture(p),this.el('h3',p.name||'Product preview'),this.el('p',p.description));const prices=p.colors.filter(c=>c.enabled).map(c=>c.priceCents);if(prices.length)card.append(this.el('p',`Starting at ${this.money(Math.min(...prices))}`));card.append(this.el('p',p.colors.filter(c=>c.enabled).map(c=>`${c.color}: ${this.money(c.priceCents)}`).join(' · ')));this.preview.replaceChildren(card);}
  async save(){if(this.busy||this.mediaBusy||!this.form.reportValidity())return;let body;try{body=this.collect();}catch(e){this.error.textContent=e.message;return;}try{await this.mediaEditor?.save();}catch(e){this.error.textContent=e.message;return;}this.busy=true;const controls=[...this.form.querySelectorAll('button,input,textarea,select')];controls.forEach(c=>c.disabled=true);this.error.textContent='Saving…';try{const data=await this.api(this.current?`/api/admin/products/${this.current.id}`:'/api/admin/products',{method:this.current?'PATCH':'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});this.current=data.product;this.dirty=false;await this.refresh();this.draw(false);this.toast('Product saved. Existing orders are unchanged.');}catch(e){this.error.textContent=e.message;controls.forEach(c=>c.disabled=false);}finally{this.busy=false;}}
}
