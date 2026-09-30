(function(root){
  function open(product,opener){
    const items=MediaTools.items(product);if(!items.length)return;
    const dialog=document.createElement('dialog');dialog.className='product-gallery';dialog.setAttribute('aria-label',`${product.name} photos`);
    const button=(text,fn)=>{const b=document.createElement('button');b.type='button';b.className='button button-secondary';b.textContent=text;b.onclick=fn;return b;};
    const title=document.createElement('h2');title.textContent=product.name;
    const close=button('Close gallery',()=>dialog.close());const main=document.createElement('div');main.className='gallery-main';
    const indicator=document.createElement('p');indicator.setAttribute('role','status');indicator.setAttribute('aria-live','polite');
    const controls=document.createElement('div');controls.className='gallery-controls';const thumbnails=document.createElement('div');thumbnails.className='gallery-thumbnails';thumbnails.setAttribute('aria-label','Choose a product image');
    let index=0,playing=false;
    const show=()=>{playing=false;main.replaceChildren();const item=items[index];indicator.textContent=`${index+1} of ${items.length}`;
      const load=()=>{playing=true;const img=document.createElement('img');img.src=ProductTools.mediaUrl(item.url);img.alt=item.alt||product.name;img.decoding='async';img.onerror=()=>{main.textContent='Photo unavailable';};main.replaceChildren(img);};
      if(item.animated&&matchMedia('(prefers-reduced-motion: reduce)').matches){const hint=document.createElement('p');hint.textContent='Animated image paused for reduced motion.';main.append(hint,button('Play animation',load));}else load();
      thumbnails.querySelectorAll('button').forEach((b,i)=>b.setAttribute('aria-pressed',String(i===index)));previous.disabled=next.disabled=items.length===1;
    };
    const move=amount=>{index=(index+amount+items.length)%items.length;show();};
    const previous=button('Previous image',()=>move(-1)),next=button('Next image',()=>move(1));controls.append(previous,indicator,next);
    items.forEach((item,i)=>{const thumb=button(`Image ${i+1}${item.animated?' · Animation':''}`,()=>{index=i;show();});thumb.setAttribute('aria-label',`View image ${i+1}: ${item.alt||product.name}`);
      if(item.previewUrl||!item.animated){const img=document.createElement('img');img.src=ProductTools.mediaUrl(item.previewUrl||item.url);img.alt='';img.loading='lazy';thumb.prepend(img);}thumbnails.append(thumb);});
    let start;main.addEventListener('touchstart',e=>{start={x:e.changedTouches[0].clientX,y:e.changedTouches[0].clientY};},{passive:true});main.addEventListener('touchend',e=>{if(!start)return;const dx=e.changedTouches[0].clientX-start.x,dy=e.changedTouches[0].clientY-start.y;if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy))move(dx<0?1:-1);start=null;},{passive:true});
    dialog.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();move(e.key==='ArrowLeft'?-1:1);}});
    const motion=matchMedia('(prefers-reduced-motion: reduce)'),changed=()=>{if(motion.matches&&playing&&items[index].animated)show();};motion.addEventListener('change',changed);
    dialog.addEventListener('close',()=>{motion.removeEventListener('change',changed);dialog.remove();opener?.focus();},{once:true});
    dialog.append(close,title,main,controls,thumbnails);document.body.append(dialog);show();dialog.showModal();close.focus();
  }
  root.ProductGallery={open};
})(globalThis);
