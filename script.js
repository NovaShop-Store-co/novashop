let cart = JSON.parse(localStorage.getItem('novashop-cart') || '[]');
const $ = (s) => document.querySelector(s);
let favoriteIds = new Set((()=>{try{return JSON.parse(localStorage.getItem("novashop-favorites-v1")||"[]").map(Number);}catch(_){return [];}})());
let liveReviewStats = new Map();
function refreshFavoriteIds(){window.NovaShopDB?.getFavoriteIds?.().then(ids=>{favoriteIds=new Set(ids.map(Number));if($("#productGrid"))renderProducts();}).catch(err=>console.warn("Favoritos:",err));}
async function toggleFavoriteFromButton(button){
 const id=Number(button.dataset.favorite);if(!id)return;
 try{
  const ids=await window.NovaShopDB?.toggleFavorite?.(id);
  if(ids)favoriteIds=new Set(ids.map(Number));
  else{const next=new Set(favoriteIds);next.has(id)?next.delete(id):next.add(id);favoriteIds=next;localStorage.setItem("novashop-favorites-v1",JSON.stringify([...next]));}
  renderProducts();toast(favoriteIds.has(id)?"Añadido a favoritos":"Quitado de favoritos");
 }catch(e){toast(e.message||"No pudimos actualizar los favoritos.");}
}
const money = (n) => new Intl.NumberFormat('es-CO',{style:'currency',currency:CONFIG.currency,maximumFractionDigits:0}).format(n);

function saveCart(){ localStorage.setItem('novashop-cart',JSON.stringify(cart)); }
function cartCount(){ return cart.reduce((sum,i)=>sum+i.qty,0); }
function cartTotal(){ return cart.reduce((sum,i)=>sum+i.price*i.qty,0); }
function product(id){ return products.find(p=>p.id===id); }


function renderFeaturedProduct(){
  const link=$('#featuredProductLink');
  if(!link || !Array.isArray(products) || !products.length)return;
  const cta=$('#featuredProductCta');
  if(document.body.dataset.page==='streaming'){
    link.href='streaming.html';
    link.setAttribute('aria-label','Explorar el catálogo completo de Streaming');
    $('#featuredProductImage').src='https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?auto=format&fit=crop&w=1100&q=85';
    $('#featuredProductImage').alt='Catálogo de plataformas y servicios digitales';
    $('#featuredProductBadge').textContent='CATÁLOGO';
    $('#featuredProductName').textContent='Explora las plataformas de Streaming';
    $('#featuredProductDiscount').textContent='20 servicios';
    if(cta)cta.textContent='Ver catálogo completo ↗';
    return;
  }
  const featured=products.find(p=>p.category!=='Streaming' && p.oldPrice) || products.find(p=>p.category!=='Streaming');
  if(!featured)return;
  const pct=featured.oldPrice?Math.round((1-(featured.price/featured.oldPrice))*100):0;
  link.href='producto.html?id='+featured.id;
  link.setAttribute('aria-label','Ver detalles y comprar '+featured.name);
  $('#featuredProductImage').src=(featured.images&&featured.images[0])||'';
  $('#featuredProductImage').alt=featured.name;
  $('#featuredProductBadge').textContent=featured.oldPrice?'OFERTA':'DESTACADO';
  $('#featuredProductName').textContent=featured.name;
  $('#featuredProductDiscount').textContent=featured.oldPrice?(pct+'% OFF'):'Ver producto';
  if(cta)cta.textContent='Ver detalles y comprar ↗';
}

function renderCategories(){
  const streamingPage=document.body.dataset.page==='streaming';
  const metaByName=new Map(categoryMeta.map(item=>[item.name,item]));
  const names=streamingPage?['Streaming']:[...new Set([...categoryMeta.map(item=>item.name),...products.map(item=>item.category)])];
  const visibleCategories=names.map(name=>{
    const meta=metaByName.get(name)||{};
    const count=products.filter(item=>item.category===name).length;
    return {name,image:meta.image||'images/streaming-placeholder.svg',count:name==='Streaming'?count+' servicios digitales':count+' '+(count===1?'producto':'productos')};
  });
  $('#categoryGrid').innerHTML=visibleCategories.map(c=>`<button class="category-card" data-cat="${c.name}" aria-label="Ver ${c.name}"><img src="${c.image}" alt="${c.name}" loading="lazy"><div class="category-info"><h3>${c.name}</h3><span>${c.count}</span></div></button>`).join('');
  document.querySelectorAll('.category-card').forEach(btn=>btn.addEventListener('click',()=>{if(btn.dataset.cat==='Streaming'){location.href='streaming.html';return;}$('#categoryFilter').value=btn.dataset.cat;renderProducts();document.querySelector('#productos').scrollIntoView({behavior:'smooth'});}));
}

function renderLiveRating(productId){
 const stats=liveReviewStats.get(Number(productId));
 if(!stats||!stats.count)return "";
 const filled=Math.max(0,Math.min(5,Math.round(stats.average)));
 const stars="★".repeat(filled)+"☆".repeat(5-filled);
 return '<div class="product-card-rating" aria-label="Calificación promedio '+stats.average.toFixed(1)+' de 5 estrellas, '+stats.count+' '+(stats.count===1?'reseña':'reseñas')+'"><span class="product-card-stars" aria-hidden="true">'+stars+'</span><strong>'+stats.average.toFixed(1)+'</strong><small>'+stats.count+' '+(stats.count===1?'reseña':'reseñas')+'</small></div>';
}
async function loadCatalogReviewStats(){
 const client=window.NovaShopDB?.client;if(!client)return;
 try{
  const {data,error}=await client.from("product_reviews").select("product_id,rating").eq("is_approved",true).limit(1000);
  if(error)throw error;
  const aggregate=new Map();
  (data||[]).forEach(row=>{
   const id=Number(row.product_id),rating=Number(row.rating);
   if(!Number.isInteger(id)||rating<1||rating>5)return;
   const stats=aggregate.get(id)||{sum:0,count:0};
   stats.sum+=rating;stats.count+=1;aggregate.set(id,stats);
  });
  liveReviewStats=new Map([...aggregate.entries()].map(([id,stats])=>[id,{average:stats.sum/stats.count,count:stats.count}]));
  if($("#productGrid"))renderProducts();
 }catch(error){console.warn("No se pudieron cargar las calificaciones reales del catálogo:",error.message);}
}
function productAudienceLabel(p){
  const audiences=Array.isArray(p?.targetAudiences)?p.targetAudiences:[];
  if(audiences.includes('hombre')&&audiences.includes('mujer'))return 'Unisex';
  if(audiences.includes('hombre'))return 'Hombre';
  if(audiences.includes('mujer'))return 'Mujer';
  return '';
}
function renderProducts(){
  const query = $('#searchInput').value.trim().toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const cat = $('#categoryFilter').value;
  const audience = $('#audienceFilter')?.value || 'all';
  const sort = $('#sortSelect').value;
  const streamingPage = document.body.dataset.page === 'streaming';
  const minValue=Number($('#minPriceFilter')?.value||0),maxRaw=$('#maxPriceFilter')?.value;
  const maxValue=maxRaw==null||maxRaw===''?Infinity:Number(maxRaw);
  const hideSoldOut=!!$('#hideSoldOut')?.checked,onlyOffers=!!$('#onlyOffers')?.checked;
  let list = products.filter(p=>{
    const targetAudiences=Array.isArray(p.targetAudiences)?p.targetAudiences:[];
    const audienceNames=targetAudiences.map(value=>value==='hombre'?'hombre':value==='mujer'?'mujer':'').filter(Boolean);
    const searchText=[p.name,p.category,p.description,p.tag,...audienceNames,...(Array.isArray(p.features)?p.features:[])].filter(Boolean).join(' ').toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    return (streamingPage ? p.category==='Streaming' : p.category!=='Streaming')&&(cat==='all'||p.category===cat)&&(audience==='all'||targetAudiences.includes(audience))&&searchText.includes(query)&&Number(p.price)>=minValue&&Number(p.price)<=maxValue&&(!hideSoldOut||p.stockQuantity==null||Number(p.stockQuantity)>0)&&(!onlyOffers||(Number(p.oldPrice)>Number(p.price)));
  });
  if(sort==='priceAsc') list.sort((a,b)=>a.price-b.price);
  if(sort==='priceDesc') list.sort((a,b)=>b.price-a.price);
  if(sort==='name') list.sort((a,b)=>a.name.localeCompare(b.name,'es'));
  $('#emptyState').hidden=list.length!==0;
  $('#productGrid').innerHTML=list.map(p=>`<article class="product-card">
    <a class="product-link" href="producto.html?id=${p.id}" aria-label="Ver ${p.name}">
      <div class="product-media"><img src="${p.images[0]}" alt="${p.name}" loading="lazy">${p.category==='Streaming'?'':(p.oldPrice?'<span class="tag">OFERTA</span>':(p.tag?'<span class="tag">'+p.tag+'</span>':''))}</div>
      <div class="product-body"><div class="category-label">${p.category}${p.category==='Moda'&&productAudienceLabel(p)?' · '+productAudienceLabel(p):''}</div>${renderLiveRating(p.id)}<div class="product-title">${p.name}</div>
        <div class="price-row"><span class="price">${money(p.price)}</span>${p.oldPrice?`<span class="old-price">${money(p.oldPrice)}</span>`:''}</div>
        <div class="product-fulfillment-note ${p.category==='Streaming'?'is-digital':'is-physical'}"><span aria-hidden="true">${p.category==='Streaming'?'💻':'🚚'}</span><span>${p.category==='Streaming'?'Servicio digital · sin envío físico':'Envío gratis pagando con Bold'}</span></div>
      </div>
    </a>
    <div class="product-actions"><button class="add-btn" data-id="${p.id}">Añadir al carrito</button></div>
  </article>`).join('');
  const grid=$('#productGrid');
  grid.querySelectorAll('.product-card').forEach((card,index)=>{
    const p=list[index];if(!p)return;
    const media=card.querySelector('.product-media');
    if(media){
      const favorite=document.createElement('button');favorite.type='button';favorite.className='favorite-toggle'+(favoriteIds.has(Number(p.id))?' is-favorite':'');
      favorite.dataset.favorite=String(p.id);favorite.setAttribute('aria-pressed',String(favoriteIds.has(Number(p.id))));
      favorite.setAttribute('aria-label',favoriteIds.has(Number(p.id))?'Quitar de favoritos':'Añadir a favoritos');favorite.textContent=favoriteIds.has(Number(p.id))?'♥':'♡';media.appendChild(favorite);
    }
    if(p.stockQuantity!=null){
      const label=document.createElement('small');label.className='stock-label'+(Number(p.stockQuantity)===0?' sold-out':'');
      label.textContent=Number(p.stockQuantity)===0?'Agotado':'Disponible: '+Number(p.stockQuantity);
      card.querySelector('.product-body')?.appendChild(label);
      const add=card.querySelector('.add-btn');if(add&&Number(p.stockQuantity)===0){add.disabled=true;add.textContent='Agotado';}
    }
  });
  grid.querySelectorAll('[data-favorite]').forEach(btn=>btn.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();toggleFavoriteFromButton(btn);}));
  grid.querySelectorAll('.add-btn').forEach(btn=>btn.addEventListener('click',event=>{
    event.preventDefault();
    event.stopPropagation();
    addToCart(Number(btn.dataset.id));
  }));
}

let quickAddProductId=null;
let quickAddSelectedAudience=null;
let quickAddSelectedColor=null;
let quickAddSelectedSize=null;

function catalogDropiVariants(p){
  return Array.isArray(p?.dropiVariants)?p.dropiVariants.filter(v=>v&&v.is_active!==false&&["hombre","mujer"].includes(String(v.audience||"").toLowerCase())):[];
}
function catalogDropiAudiences(p){
  const values=new Set(catalogDropiVariants(p).map(v=>String(v.audience).toLowerCase()));
  return ["mujer","hombre"].filter(value=>values.has(value));
}
function catalogProductAudiences(p){
  const rows=catalogDropiVariants(p);
  if(rows.length)return catalogDropiAudiences(p);
  const raw=p?.targetAudiences??p?.target_audiences;
  const values=new Set((Array.isArray(raw)?raw:[]).map(value=>String(value??"").trim().toLowerCase())
   .filter(value=>["hombre","mujer"].includes(value)));
  return ["mujer","hombre"].filter(value=>values.has(value));
}
function selectedQuickAddDropiVariant(p){
  if(!p||!quickAddSelectedAudience||!quickAddSelectedColor||!quickAddSelectedSize)return null;
  return catalogDropiVariants(p).find(v=>String(v.audience).toLowerCase()===quickAddSelectedAudience&&
   String(v.color||"").trim().toLocaleLowerCase("es")===quickAddSelectedColor.toLocaleLowerCase("es")&&
   String(v.size||"").trim().toLocaleLowerCase("es")===quickAddSelectedSize.toLocaleLowerCase("es"))||null;
}
function catalogColorVariants(p){
  const dropi=catalogDropiVariants(p);
  const selectedAudience=Number(quickAddProductId)===Number(p?.id)?quickAddSelectedAudience:null;
  if(dropi.length){
    const audiences=catalogDropiAudiences(p);
    if(audiences.length>1&&!selectedAudience)return [];
    const colors=[...new Set(dropi.filter(v=>!selectedAudience||String(v.audience).toLowerCase()===selectedAudience).map(v=>String(v.color||"").trim()).filter(Boolean))];
    const raw=p?.colorVariants??p?.color_variants;
    const existing=Array.isArray(raw)?raw:[];
    return colors.map(name=>{
      const found=existing.find(v=>String(v?.name||"").trim().toLocaleLowerCase("es")===name.toLocaleLowerCase("es"));
      const images=Array.isArray(found?.images)?found.images.filter(Boolean):[found?.front_image||found?.frontImage,found?.back_image||found?.backImage].filter(Boolean);
      return {...(found||{}),name,hex:found?.hex||"#d1d5db",images};
    });
  }
  const raw=p?.colorVariants??p?.color_variants;
  if(!Array.isArray(raw))return [];
  return raw.filter(v=>v&&typeof v.name==="string"&&v.name.trim()).map(v=>{
    const images=Array.isArray(v.images)?v.images.filter(Boolean):[v.front_image||v.frontImage,v.back_image||v.backImage].filter(Boolean);
    return {...v,name:String(v.name).trim(),images};
  });
}
function catalogSizeVariants(p){
  const dropi=catalogDropiVariants(p);
  if(dropi.length){
    if(Number(quickAddProductId)!==Number(p?.id)||!quickAddSelectedAudience||!quickAddSelectedColor)return [];
    return [...new Set(dropi.filter(v=>String(v.audience).toLowerCase()===quickAddSelectedAudience&&
      String(v.color||"").trim().toLocaleLowerCase("es")===quickAddSelectedColor.toLocaleLowerCase("es")).map(v=>String(v.size||"").trim()).filter(Boolean))];
  }
  const raw=p?.sizeVariants??p?.size_variants;
  if(!Array.isArray(raw))return [];
  return [...new Set(raw.map(v=>String(v??"").trim()).filter(Boolean))].slice(0,20);
}
function openQuickAdd(id){
  const p=product(id);if(!p)return;
  const dropi=catalogDropiVariants(p);
  if(!dropi.length&&p.stockQuantity!=null&&Number(p.stockQuantity)<=0){toast("Este producto está agotado");return;}
  quickAddProductId=Number(id);
  const audiences=catalogProductAudiences(p);
  quickAddSelectedAudience=audiences.length===1?audiences[0]:null;
  quickAddSelectedColor=null;quickAddSelectedSize=null;
  const colors=catalogColorVariants(p);
  if(colors.length===1)quickAddSelectedColor=colors[0].name;
  const sizes=catalogSizeVariants(p);
  if(sizes.length===1)quickAddSelectedSize=sizes[0];
  if(p.printfulEnabled&&sizes.length){
    toast("Este producto necesita una combinación de talla y color configurada antes de venderse.");
    return;
  }
  $("#quickAddTitle").textContent=p.name;
  $("#quickAddPrice").textContent=money(p.price);
  $("#quickAddImage").src=(p.images&&p.images[0])||"images/streaming-placeholder.svg";
  $("#quickAddImage").alt=p.name;
  const stockLabel=$("#quickAddStock");
  if(stockLabel)stockLabel.textContent=dropi.length?"Elige el corte, color y talla que prefieras.":(p.stockQuantity==null?"":(Number(p.stockQuantity)===1?"Disponible · 1 unidad":"Disponible: "+Number(p.stockQuantity)+" unidades"));
  renderQuickAddOptions();
  const modal=$("#quickAddModal");
  modal.classList.add("show");
  modal.setAttribute("aria-hidden","false");
  document.body.style.overflow="hidden";
  $("#quickAddClose")?.focus();
}
function renderQuickAddOptions(){
  const p=product(quickAddProductId);if(!p)return;
  const dropi=catalogDropiVariants(p),audiences=catalogProductAudiences(p);
  const colors=catalogColorVariants(p),sizes=catalogSizeVariants(p);
  const audienceSection=$("#quickAddAudienceSection"),audienceBox=$("#quickAddAudienceOptions");
  if(audienceSection)audienceSection.hidden=audiences.length<2;
  if(audienceBox)audienceBox.innerHTML=audiences.map(audience=>{
    const selected=audience===quickAddSelectedAudience;
    const label=audience==="mujer"?"Dama":"Caballero";
    return '<button type="button" class="quick-add-option" data-quick-audience="'+audience+'" aria-pressed="'+selected+'">'+label+(selected?' <b aria-hidden="true">✓</b>':'')+'</button>';
  }).join("");
  const colorSection=$("#quickAddColorSection"),sizeSection=$("#quickAddSizeSection");
  if(colorSection)colorSection.hidden=!colors.length;
  if(sizeSection)sizeSection.hidden=!sizes.length;
  const safeHex=value=>/^#[0-9a-f]{6}$/i.test(String(value||""))?String(value):"#d1d5db";
  const colorBox=$("#quickAddColorOptions");
  if(colorBox)colorBox.innerHTML=colors.map((v,index)=>{
    const selected=v.name===quickAddSelectedColor;
    const thumbnail=v.images[0]
      ? '<img src="'+escapeHTML(v.images[0])+'" alt="" loading="lazy">'
      : '<span class="quick-add-color-dot" style="background:'+safeHex(v.hex)+'"></span>';
    return '<button type="button" class="quick-add-option quick-add-color-option" data-quick-color="'+index+'" aria-pressed="'+selected+'">'+thumbnail+'<span>'+escapeHTML(v.name)+'</span>'+(selected?'<b aria-hidden="true">✓</b>':'')+'</button>';
  }).join("");
  const sizeBox=$("#quickAddSizeOptions");
  if(sizeBox)sizeBox.innerHTML=sizes.map((size,index)=>{
    const selected=size===quickAddSelectedSize;
    const variant=dropi.length?dropi.find(v=>String(v.audience).toLowerCase()===quickAddSelectedAudience&&String(v.color||"").trim().toLocaleLowerCase("es")===String(quickAddSelectedColor||"").toLocaleLowerCase("es")&&String(v.size||"").trim().toLocaleLowerCase("es")===size.toLocaleLowerCase("es")):null;
    const soldOut=!!variant&&Number(variant.stock_quantity)<=0;
    return '<button type="button" class="quick-add-option quick-add-size-option" data-quick-size="'+index+'" aria-pressed="'+selected+'" '+(soldOut?'disabled aria-disabled="true"':'')+'>'+escapeHTML(size)+(soldOut?' · Agotada':'')+'</button>';
  }).join("");
  const help=$("#quickAddHelp");
  if(help){
    const missing=[];
    if(audiences.length>1&&!quickAddSelectedAudience)missing.push("si es para Dama o Caballero");
    if(colors.length&&!quickAddSelectedColor)missing.push("el color");
    if((sizes.length|| (dropi.length&&!!quickAddSelectedColor))&&!quickAddSelectedSize)missing.push("la talla");
    if(dropi.length&&quickAddSelectedSize&&!selectedQuickAddDropiVariant(p))missing.push("una combinación disponible");
    help.textContent=missing.length?"Para añadirlo, selecciona "+missing.join(", ")+".":"Listo. Pulsa «Añadir al carrito» para continuar.";
  }
}
function closeQuickAdd(){
  const modal=$("#quickAddModal");if(!modal)return;
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden","true");
  quickAddProductId=null;
  if(!$("#checkoutModal")?.classList.contains("show")&&!$("#cartDrawer")?.classList.contains("open"))document.body.style.overflow="";
}
function confirmQuickAdd(){
  const p=product(quickAddProductId);if(!p)return;
  const dropi=catalogDropiVariants(p),audiences=catalogProductAudiences(p);
  const colors=catalogColorVariants(p),sizes=catalogSizeVariants(p);
  if(audiences.length>1&&!quickAddSelectedAudience){toast("Selecciona si lo quieres para Dama o Caballero.");return;}
  if(colors.length&&!quickAddSelectedColor){toast("Selecciona un color para continuar");return;}
  if((dropi.length||sizes.length)&&!quickAddSelectedSize){toast("Selecciona una talla para continuar");return;}
  const chosenDropi=dropi.length?selectedQuickAddDropiVariant(p):null;
  if(dropi.length&&(!chosenDropi||!chosenDropi.is_active||Number(chosenDropi.stock_quantity)<=0)){toast("Esa combinación no está disponible. Elige otro color o talla.");return;}
  const totalForChoice=cart.filter(item=>Number(item.id)===Number(p.id)&&
    (item.selectedAudience||null)===((dropi.length||audiences.length)?quickAddSelectedAudience:null)&&
    (item.selectedVariant||null)===(quickAddSelectedColor||null)&&
    (item.selectedSize||null)===(quickAddSelectedSize||null)).reduce((sum,item)=>sum+Number(item.qty||0),0);
  if(dropi.length&&totalForChoice+1>Number(chosenDropi.stock_quantity)){toast("No quedan más unidades de esa combinación en Dropi.");return;}
  if(!dropi.length&&p.stockQuantity!=null){
    const total=cart.filter(item=>Number(item.id)===Number(p.id)).reduce((sum,item)=>sum+Number(item.qty||0),0);
    if(total>=Number(p.stockQuantity)){toast("No hay más unidades disponibles");return;}
  }
  const imageColor=colors.find(v=>v.name===quickAddSelectedColor);
  const image=(imageColor?.images?.[0])||(p.images&&p.images[0])||"images/streaming-placeholder.svg";
  const found=cart.find(item=>Number(item.id)===Number(p.id)&&
    (item.selectedAudience||null)===(dropi.length?quickAddSelectedAudience:null)&&
    (item.selectedVariant||null)===(quickAddSelectedColor||null)&&(item.selectedSize||null)===(quickAddSelectedSize||null));
  if(found)found.qty=Number(found.qty||0)+1;
  else cart.push({id:p.id,name:p.name,price:Number(p.price)||0,image,selectedAudience:(dropi.length||audiences.length)?quickAddSelectedAudience:null,selectedVariant:quickAddSelectedColor||null,selectedSize:quickAddSelectedSize||null,qty:1});
  const details=[quickAddSelectedAudience?"Corte "+(quickAddSelectedAudience==="mujer"?"Dama":"Caballero"):"",quickAddSelectedColor,quickAddSelectedSize?"Talla "+quickAddSelectedSize:""].filter(Boolean).join(" · ");
  saveCart();renderCart();closeQuickAdd();openCart();
  toast("¡Añadido al carrito!"+(details?" · "+details:""));
}
function addToCart(id){
  const p=product(id);if(!p)return;
  const dropi=catalogDropiVariants(p);
  if(!dropi.length&&p.stockQuantity!=null&&Number(p.stockQuantity)<=0){toast("Este producto está agotado");return;}
  if(dropi.length||catalogProductAudiences(p).length>1||catalogColorVariants(p).length||catalogSizeVariants(p).length){
    openQuickAdd(id);
    return;
  }
  const found=cart.find(i=>Number(i.id)===Number(id)&&!i.selectedAudience&&!i.selectedVariant&&!i.selectedSize);
  if(p.stockQuantity!=null){
    const total=cart.filter(item=>Number(item.id)===Number(p.id)).reduce((sum,row)=>sum+Number(row.qty||0),0);
    if(total>=Number(p.stockQuantity)){toast("No hay más unidades disponibles");return;}
  }
  if(found)found.qty++;
  else cart.push({id:p.id,name:p.name,price:p.price,image:p.images?.[0]||"images/streaming-placeholder.svg",selectedAudience:null,selectedVariant:null,selectedSize:null,qty:1});
  saveCart();renderCart();openCart();toast("¡Listo! Añadimos el producto a tu carrito");
}
function changeQty(index,delta){
 const item=cart[index];if(!item)return;
 const p=product(Number(item.id)),dropi=catalogDropiVariants(p);
 if(delta>0&&dropi.length){
  const variant=dropi.find(v=>String(v.audience).toLowerCase()===String(item.selectedAudience||"").toLowerCase()&&
   String(v.color||"").trim().toLocaleLowerCase("es")===String(item.selectedVariant||"").toLocaleLowerCase("es")&&
   String(v.size||"").trim().toLocaleLowerCase("es")===String(item.selectedSize||"").toLocaleLowerCase("es"));
  const selectedCount=cart.filter(row=>Number(row.id)===Number(item.id)&&(row.selectedAudience||null)===(item.selectedAudience||null)&&(row.selectedVariant||null)===(item.selectedVariant||null)&&(row.selectedSize||null)===(item.selectedSize||null)).reduce((sum,row)=>sum+Number(row.qty||0),0);
  if(!variant||selectedCount>=Number(variant.stock_quantity)){toast("No hay más unidades de esa combinación");return;}
 }else if(delta>0&&p?.stockQuantity!=null){
  const productQty=cart.filter(row=>Number(row.id)===Number(item.id)).reduce((sum,row)=>sum+Number(row.qty||0),0);
  if(productQty>=Number(p.stockQuantity)){toast('No hay más unidades disponibles');return;}
 }
 item.qty+=delta;if(item.qty<=0)cart.splice(index,1);saveCart();renderCart();
}
function removeItem(index){if(!Number.isInteger(index)||index<0||index>=cart.length)return;cart.splice(index,1);saveCart();renderCart();}
function renderCart(){
  $('#cartCount').textContent=cartCount();
  if(!cart.length){ $('#cartItems').innerHTML='<div class="cart-empty">Tu carrito está esperando algo que te guste.<br>Explora la tienda y añade tu primer producto.</div>'; $('#cartSubtotal').textContent=money(0); return; }
  $('#cartItems').innerHTML=cart.map((i,index)=>`<div class="cart-item"><img src="${escapeHTML(i.image||"")}" alt=""><div><h4>${escapeHTML(i.name)}</h4>${i.selectedAudience?`<p class="cart-item-variant">Corte: ${i.selectedAudience==="mujer"?"Dama":"Caballero"}</p>`:""}${i.selectedVariant?`<p class="cart-item-variant">Color: ${escapeHTML(i.selectedVariant)}</p>`:""}${i.selectedSize?`<p class="cart-item-variant">Talla: ${escapeHTML(i.selectedSize)}</p>`:""}<p>${money(i.price)} c/u</p><div class="qty-control"><button data-action="dec" data-index="${index}">−</button><span>${i.qty}</span><button data-action="inc" data-index="${index}">+</button></div></div><div><strong>${money(i.price*i.qty)}</strong><br><button class="remove" data-action="remove" data-index="${index}">Eliminar</button></div></div>`).join('');
  $('#cartSubtotal').textContent=money(cartTotal());
  document.querySelectorAll('#cartItems button').forEach(b=>b.addEventListener('click',()=>{const index=Number(b.dataset.index);const a=b.dataset.action;if(a==='dec')changeQty(index,-1);if(a==='inc')changeQty(index,1);if(a==='remove')removeItem(index);}));
}

function openCart(){ $('#cartDrawer').classList.add('open'); $('#drawerOverlay').classList.add('show'); document.body.style.overflow='hidden'; }
function closeCart(){ $('#cartDrawer').classList.remove('open'); $('#drawerOverlay').classList.remove('show'); document.body.style.overflow=''; }
function toast(msg,duration=1800){ const t=$('#toast'); if(!t)return; t.textContent=msg; t.classList.add('show'); clearTimeout(window.__toast); window.__toast=setTimeout(()=>t.classList.remove('show'),duration); }

function getProductPaymentCapabilities(productData){
  const item=productData||{};
  const isDigital=item.deliveryType==="digital"||item.category==="Streaming";
  const methods=Array.isArray(item.paymentMethods)&&item.paymentMethods.length
    ? item.paymentMethods
    : (isDigital?["bold"]:["bold","cash_on_delivery"]);
  return {
    allowBold:methods.includes("bold"),
    allowContraentrega:!isDigital&&methods.includes("cash_on_delivery")&&!item.printfulEnabled,
    digitalOnly:isDigital
  };
}

function configureCheckoutPaymentMethods(form,allowContraentrega,digitalOnly,allowBold=true){
  const select=form?.querySelector('select[name="paymentMethod"]');
  const boldOption=select?.querySelector('option[value="bold"]');
  const codOption=select?.querySelector('option[value="cash_on_delivery"]');
  if(boldOption){
    boldOption.textContent=digitalOnly?"Pago en línea":"Pago en línea · envío gratis";
    boldOption.hidden=!allowBold;
    boldOption.disabled=!allowBold;
  }
  if(codOption){
    codOption.textContent="Contraentrega · producto al recibirlo; flete anticipado";
    codOption.hidden=!allowContraentrega;
    codOption.disabled=!allowContraentrega;
  }
  if(select){
    if(select.value==="bold"&&!allowBold)select.value="";
    if(select.value==="cash_on_delivery"&&!allowContraentrega)select.value="";
    if(allowBold&&!allowContraentrega)select.value="bold";
    else if(!allowBold&&allowContraentrega)select.value="cash_on_delivery";
  }

  const policy=form?.querySelector("[data-payment-policy]");
  const intro=form?.querySelector("[data-payment-intro]");
  if(digitalOnly){
    if(intro)intro.textContent="Este carrito contiene servicios digitales: el pago se realiza por anticipado en línea. No hay envío físico ni contraentrega.";
    if(policy)policy.textContent="Los servicios digitales se pagan por anticipado en línea. Si tienes preguntas sobre un servicio, escríbenos por WhatsApp antes de comprar.";
  }else if(allowBold&&allowContraentrega){
    if(intro)intro.textContent="Completa tus datos y elige la forma de pago disponible. Al pagar en línea, el envío es gratis; si eliges contraentrega, pagas $12.000 de anticipo de envío y el saldo del producto al recibirlo.";
    if(policy)policy.textContent="Al pagar en línea, cubres el total y el envío es gratis. Si eliges contraentrega, el anticipo de envío es de $12.000 y el saldo del producto se paga al recibirlo.";
  }else if(allowBold){
    if(intro)intro.textContent="Este pedido se paga por anticipado en línea. Completa tus datos para continuar al pago seguro; el envío de los productos físicos es gratis.";
    if(policy)policy.textContent="Este pedido solo admite pago en línea; la contraentrega no está disponible para estos artículos.";
  }else{
    if(intro)intro.textContent="Este pedido solo admite contraentrega. El anticipo de envío es de $12.000 y el saldo del producto se paga al recibirlo.";
    if(policy)policy.textContent="Para este pedido puedes elegir contraentrega: el anticipo de envío es de $12.000 y el saldo del producto se paga al recibirlo.";
  }
  if(intro&&!digitalOnly){
    intro.textContent += " Tiempo estimado de entrega: 1 a 5 días hábiles, sin contar fines de semana.";
  }
}

async function checkoutWhatsApp(){
  if(!cart.length){toast("Añade al menos un producto");return;}
  try{if(window.NovaShopDB?.isConfigured?.())await window.NovaShopDB.syncCatalog?.(products);}catch(error){console.warn("No se pudo actualizar el catálogo antes del checkout:",error);}
  const capabilities=cart.map(item=>getProductPaymentCapabilities(product(item.id)));
  const allowBold=capabilities.every(item=>item.allowBold);
  const allowContraentrega=capabilities.every(item=>item.allowContraentrega)&&cartTotal()>12000;
  const digitalOnly=capabilities.every(item=>item.digitalOnly);
  if(!allowBold&&!allowContraentrega){
    toast("Estos productos necesitan formas de pago diferentes. Haz pedidos separados para continuar.",6000);
    return;
  }
  renderCheckoutSummary();
  const form=$("#checkoutForm");
  const deliveryFields=$("#cartDeliveryFields");if(deliveryFields)deliveryFields.hidden=digitalOnly;
  configureCheckoutPaymentMethods(form,allowContraentrega,digitalOnly,allowBold);
  renderCheckoutSummary();
  const accountHint=$("#checkoutModal .checkout-account-hint");
  if(accountHint){
    try{
      const session=await window.NovaShopDB?.getSession?.();
      accountHint.hidden=!!session?.user;
    }catch(error){
      accountHint.hidden=false;
    }
  }
  openCheckoutModal();
  window.NovaShopDB?.prefillCheckout?.(form).catch(err=>console.warn("Perfil no precargado:",err));
}

function renderCheckoutSummary(){
  const summary=$('#checkoutSummary');
  if(!summary) return;
  const itemCount=cartCount();
  const lines=cart.map(i=>`<li>${escapeHTML(i.name)}${i.selectedVariant?` · Color: ${escapeHTML(i.selectedVariant)}`:""}${i.selectedSize?` · Talla: ${escapeHTML(i.selectedSize)}`:""} ×${i.qty} — <strong>${money(i.price*i.qty)}</strong></li>`).join('');
  const subtotal=cartTotal();
  const paymentMethod=$("#checkoutForm select[name='paymentMethod']")?.value||"";
  const contraentrega=paymentMethod==="cash_on_delivery";
  const hasPhysicalItems=cart.some(item=>product(item.id)?.deliveryType!=="digital");
  const codAllowed=subtotal>12000;

  let totals=`<div class="checkout-summary-total"><span>Subtotal de productos</span><strong>${money(subtotal)}</strong></div>`;
  if(contraentrega&&codAllowed){
    const balance=subtotal-12000;
    totals=`
      <div class="checkout-summary-total"><span>Precio total de los productos</span><strong>${money(subtotal)}</strong></div>
      <div class="checkout-summary-total checkout-summary-deduction"><span>Anticipo de envío que pagas ahora</span><strong>−${money(12000)}</strong></div>
      <div class="checkout-summary-total checkout-summary-due"><span>Saldo a pagar a la transportadora al recibir</span><strong>${money(balance)}</strong></div>
      <p class="checkout-summary-payment-note"><strong>Hoy pagas ${money(12000)}.</strong> Los ${money(12000)} se descuentan del valor del producto; no se suman al precio. A la transportadora le pagas únicamente el saldo mostrado.</p>`;
  }else if(paymentMethod==="bold"){
    totals=`<div class="checkout-summary-total checkout-summary-due"><span>Total a pagar en línea</span><strong>${money(subtotal)}</strong></div>`
      +(hasPhysicalItems?'<p class="checkout-summary-payment-note">Pagas el total en línea y el envío de productos físicos es gratis.</p>':'<p class="checkout-summary-payment-note">El valor completo del servicio digital se paga por anticipado con Bold.</p>');
  }else if(contraentrega&&!codAllowed){
    totals+=`<p class="checkout-summary-payment-note">Para contraentrega, el total de productos debe ser superior a ${money(12000)} porque el anticipo se descuenta del precio.</p>`;
  }

  summary.innerHTML=`<div class="checkout-summary-title"><strong>Resumen del pedido</strong><span>${itemCount} ${itemCount===1?'producto':'productos'}</span></div><ul class="checkout-summary-list">${lines}</ul>${totals}`;
}
function openCheckoutModal(){
  const modal=$('#checkoutModal');
  if(!modal) return;
  renderCheckoutSummary();
  modal.classList.add('show');
  modal.setAttribute('aria-hidden','false');
  document.body.style.overflow='hidden';
  window.NovaShopDeliveryMaps?.invalidate('checkoutDeliveryMap');
  const first=modal.querySelector('input[name="firstName"]');
  window.setTimeout(()=>first?.focus(),50);
}

function closeCheckoutModal(){
  const modal=$('#checkoutModal');
  if(!modal) return;
  const form=$('#checkoutForm');
  if(form?.dataset.boldOrderId){
    delete form.dataset.boldOrderId;
    form.querySelectorAll('input,select,textarea').forEach(field=>{field.disabled=false;});
    const button=form.querySelector('button[data-bold-ready]')||form.querySelector('button[type="submit"]');
    if(button){button.type='submit';button.onclick=null;button.dataset.boldReady='';delete button.dataset.boldReady;button.disabled=false;button.textContent='Confirmar pedido';}
    form.querySelector('[data-bold-payment-status]')?.remove();
  }
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden','true');
  document.body.style.overflow='';
}

function escapeHTML(value){
  return String(value).replace(/[&<>"']/g, char=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[char]));
}

function cleanField(value){
  return String(value||'').trim().replace(/\s+/g,' ');
}

function buildWhatsAppMessage(data, orderInfo={}){
  const order=typeof orderInfo==='string'?{order_number:orderInfo}:(orderInfo||{});
  const orderNumber=order.order_number||'';
  const discount=Math.max(0,Number(order.discount_cop)||0);
  const finalTotal=Number.isFinite(Number(order.total_cop))&&order.total_cop!=null?Number(order.total_cop):Math.max(0,cartTotal()-discount);
  const lines=cart.map((i,index)=>[
    `${index+1}. ${i.name}`,
    `   Cantidad: ${i.qty}`,
    i.selectedVariant ? `   Color: ${i.selectedVariant}` : null,
    i.selectedSize ? `   Talla: ${i.selectedSize}` : null,
    `   Precio: ${money(i.price)} c/u`,
    `   Total: ${money(i.price*i.qty)}`
  ].join('\n')).join('\n\n');

  const I = {
    wave: '\u{1F44B}',
    bag: '\u{1F6CD}',
    package: '\u{1F4E6}',
    user: '\u{1F464}',
    phone: '\u{1F4F1}',
    email: '\u{1F4E7}',
    pin: '\u{1F4CD}',
    house: '\u{1F3E0}',
    map: '\u{1F5FA}',
    note: '\u{1F4DD}',
    card: '\u{1F4B3}',
    check: '\u{2705}',
    pray: '\u{1F64F}'
  };

  return [
    `${I.wave} Hola, ${data.firstName}! Quiero realizar un pedido en ${CONFIG.storeName}.`,
    orderNumber ? `🧾 Número de pedido: ${orderNumber} (pendiente de pago)` : null,
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    `${I.bag} *MI PEDIDO*`,
    '━━━━━━━━━━━━━━━━━━━━',
    lines,
    '',
    `${I.package} *Subtotal:* ${money(cartTotal())}`,
    order.coupon_code ? `🎟️ Cupón aplicado: ${order.coupon_code}` : null,
    discount>0 ? `Descuento: -${money(discount)}` : null,
    `*Total tras descuento:* ${money(finalTotal)}`,
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    `${I.user} *DATOS DEL CLIENTE*`,
    '━━━━━━━━━━━━━━━━━━━━',
    `Nombre: ${data.firstName} ${data.lastName}`,
    `${I.phone} Teléfono / WhatsApp: ${data.phone}`,
    data.email ? `${I.email} Correo: ${data.email}` : null,
    ...(cart.every(item => product(item.id)?.deliveryType === 'digital')
      ? ['', '━━━━━━━━━━━━━━━━━━━━', '📩 *ENTREGA DIGITAL*', 'No requiere dirección física.', '']
      : ['', '━━━━━━━━━━━━━━━━━━━━', `${I.pin} *DIRECCIÓN DE ENTREGA*`, '━━━━━━━━━━━━━━━━━━━━',
         `${I.house} Dirección: ${data.address}`, `Barrio: ${data.neighborhood}`,
         `Ciudad / Municipio: ${data.city}`, `Departamento: ${data.department}`,
         data.postalCode ? `Código postal: ${data.postalCode}` : null,
         data.reference ? `${I.note} Referencia: ${data.reference}` : null,
    data.latitude && data.longitude ? `📍 Ubicación: https://maps.google.com/?q=${data.latitude},${data.longitude}` : null, '']),
    '━━━━━━━━━━━━━━━━━━━━',
    `${I.card} *MÉTODO DE PAGO*`,
    '━━━━━━━━━━━━━━━━━━━━',
    `${data.paymentMethod}`,
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    `${I.check} *POR FAVOR, CONFIRMAR*`,
    '━━━━━━━━━━━━━━━━━━━━',
    '• Disponibilidad de los productos',
    '• Costo de envío',
    '• Tiempo estimado de entrega',
    '',
    `${I.pray} ¡Muchas gracias! Quedo atento a su confirmación.`
  ].filter(Boolean).join('\n');
}

async function submitCheckoutForm(event){
  event.preventDefault();
  const form=event.currentTarget;
  const formButton=form.querySelector('button[type="submit"],button[data-bold-ready]');
  if(form.dataset.boldOrderId){
    if(!window.NovaShopBold?.prepare){toast("La integración de Bold no está disponible. Recarga la página e inténtalo de nuevo.");return;}
    if(formButton){formButton.disabled=true;formButton.textContent="Preparando pago…";}
    try{
      await window.NovaShopBold.prepare(form.dataset.boldOrderId,formButton,closeCheckoutModal);
      window.NovaShopBold.setMessage(form,"Tu pedido ya está registrado. Pulsa «Continuar al pago» para completar el pago seguro.");
    }catch(error){
      if(formButton){formButton.type="submit";formButton.onclick=null;formButton.disabled=false;formButton.textContent="Reintentar pago";}
      window.NovaShopBold.setMessage(form,(error?.message||"No pudimos preparar el pago.")+" Tu pedido está guardado; puedes reintentar sin crear otro pedido.");
      toast(error?.message||"No pudimos preparar el pago en línea.");
    }
    return;
  }
  if(!cart.length){closeCheckoutModal();toast("Tu carrito está vacío");return;}
  if(!form.checkValidity()){form.reportValidity();return;}
  const raw=new FormData(form);
  const data={
    firstName:cleanField(raw.get("firstName")),lastName:cleanField(raw.get("lastName")),
    phone:cleanField(raw.get("phone")),email:cleanField(raw.get("email")),
    address:cleanField(raw.get("address")),neighborhood:cleanField(raw.get("neighborhood")),
    city:cleanField(raw.get("city")),department:cleanField(raw.get("department")),
    postalCode:cleanField(raw.get("postalCode")),reference:cleanField(raw.get("reference")),
    paymentMethod:cleanField(raw.get("paymentMethod")),
    couponCode:cleanField(raw.get("couponCode")).toUpperCase(),
    latitude:cleanField(raw.get("latitude")),longitude:cleanField(raw.get("longitude"))
  };
  const missingDropiVariant=cart.find(item=>{
    const p=product(item.id),dropi=catalogDropiVariants(p);
    if(!dropi.length)return false;
    return !item.selectedAudience||!item.selectedVariant||!item.selectedSize||
      !dropi.some(v=>String(v.audience).toLowerCase()===String(item.selectedAudience).toLowerCase()&&
       String(v.color||"").trim().toLocaleLowerCase("es")===String(item.selectedVariant).toLocaleLowerCase("es")&&
       String(v.size||"").trim().toLocaleLowerCase("es")===String(item.selectedSize).toLocaleLowerCase("es")&&
       v.is_active!==false&&Number(v.stock_quantity)>=Number(item.qty||1));
  });
  if(missingDropiVariant){toast("Revisa el corte, color, talla o existencias de "+(missingDropiVariant.name||"uno de los productos")+". Vuelve a seleccionarlo desde la ficha.");return;}
  const missingColor=cart.find(item=>!catalogDropiVariants(product(item.id)).length&&Array.isArray(product(item.id)?.colorVariants)&&product(item.id).colorVariants.length&&!item.selectedVariant);
  if(missingColor){toast("En el carrito falta elegir el color de "+(missingColor.name||"uno de los productos")+". Elimina ese producto y vuelve a seleccionarlo desde su ficha.");return;}
  const invalidSize=cart.find(item=>{if(catalogDropiVariants(product(item.id)).length)return false;const sizes=product(item.id)?.sizeVariants;return Array.isArray(sizes)&&sizes.length?(!item.selectedSize||!sizes.includes(item.selectedSize)):!!item.selectedSize;});
  if(invalidSize){toast("Falta una talla válida para "+(invalidSize.name||"uno de los productos")+". Elimina ese artículo y vuelve a seleccionarlo desde su ficha.");return;}
  const useBold=data.paymentMethod==="bold";
  const useCOD=data.paymentMethod==="cash_on_delivery";
  if(useBold&&cart.some(item=>!getProductPaymentCapabilities(product(item.id)).allowBold)){
    toast("Uno de los productos del carrito no admite pago en línea. Revisa las formas de pago disponibles o realiza pedidos separados.");return;
  }
  if(useCOD&&cart.some(item=>!getProductPaymentCapabilities(product(item.id)).allowContraentrega)){
    toast("Uno de los productos del carrito no admite contraentrega. Revisa los métodos de pago o realiza pedidos separados.");return;
  }
  if(!useBold&&!useCOD){toast("Elige una forma de pago para continuar.");return;}
  if(useCOD&&cart.some(item=>product(item.id)?.deliveryType!=="physical")){
    toast("La contraentrega solo está disponible para productos físicos. Los servicios digitales se pagan por anticipado en línea.");return;
  }
  data.paymentMethod=useBold?"Pago en línea":"Contraentrega";
  const needsAddress=cart.some(item=>product(item.id)?.deliveryType!=="digital");
  if(needsAddress&&(!data.address||!data.neighborhood||!data.city||!data.department)){
    toast("Para productos físicos, completa dirección, barrio, ciudad y departamento.");return;
  }
  const hasDeliveryPin=String(data.latitude??"").trim()!==""&&String(data.longitude??"").trim()!==""&&Number.isFinite(Number(data.latitude))&&Number.isFinite(Number(data.longitude))&&Math.abs(Number(data.latitude))<=90&&Math.abs(Number(data.longitude))<=180;
  if(needsAddress&&!hasDeliveryPin){
    const mapStatus=$("#checkoutMapStatus");if(mapStatus)mapStatus.textContent="Falta marcar el punto obligatorio de entrega en el mapa.";
    $("#checkoutLocationCard")?.scrollIntoView({behavior:"smooth",block:"center"});
    toast("Para comprar productos físicos, marca obligatoriamente tu ubicación en el mapa.");return;
  }
  if(useBold||useCOD){
    try{
      const configured=await window.NovaShopDB?.checkBoldConfigured?.();
      if(!configured){toast(useCOD?"Para contraentrega debes pagar el anticipo de envío de $12.000 en la plataforma de pago. El pago aún no está disponible.":"El pago en línea todavía está en configuración.");return;}
    }catch(error){toast(error?.message||"No pudimos comprobar la configuración del pago en línea.");return;}
  }
  if(!window.NovaShopDB?.isConfigured?.()){
    toast("El sistema de pedidos no está disponible en este momento. No se ha registrado ni cobrado tu pedido.");return;
  }
  let savedOrder=null;
  const button=form.querySelector('button[type="submit"]');
  if(button){button.disabled=true;button.textContent="Registrando pedido…";}
  try{
    savedOrder=await window.NovaShopDB.createOrder(data,cart.map(item=>({product_id:Number(item.id),quantity:Number(item.qty),selected_audience:item.selectedAudience||null,selected_variant:item.selectedVariant||null,selected_size:item.selectedSize||null})));
  }catch(error){
    toast(error?.message||"No pudimos registrar el pedido. Inténtalo de nuevo.");
    if(button){button.disabled=false;button.type="submit";button.textContent="Confirmar pedido";}
    return;
  }finally{
    if(button&&!useBold){button.disabled=false;button.textContent="Confirmar pedido";}
  }
  if(useCOD){
    if(!savedOrder?.order_number){toast("El servidor no devolvió el número del pedido. Contacta a soporte antes de repetirlo.");return;}
    cart=[];saveCart();renderCart();closeCheckoutModal();
    window.location.href="pedido.html?modo=contraentrega&pedido="+encodeURIComponent(savedOrder.order_number)+"&id="+encodeURIComponent(savedOrder.id);
    return;
  }
  if(!savedOrder?.id){toast("El servidor no devolvió el identificador del pedido. No hemos abierto el pago.");return;}
  form.dataset.boldOrderId=savedOrder.id;
  form.querySelectorAll("input,select,textarea").forEach(field=>{field.disabled=true;});
  if(button){button.disabled=true;button.textContent="Preparando pago…";}
  window.NovaShopBold?.setMessage(form,"Pedido "+(savedOrder.order_number||"registrado")+". Estamos preparando la plataforma de pago seguro.");
  try{
    if(!window.NovaShopBold?.prepare)throw new Error("La integración de Bold no está disponible. Recarga la página.");
    await window.NovaShopBold.prepare(savedOrder.id,button,closeCheckoutModal);
    window.NovaShopBold.setMessage(form,"Pedido "+(savedOrder.order_number||"registrado")+". Pulsa «Continuar al pago» para pagar y recibir envío gratis.");
  }catch(error){
    if(button){button.type="submit";button.onclick=null;button.disabled=false;button.textContent="Reintentar pago";}
    window.NovaShopBold?.setMessage(form,(error?.message||"No pudimos preparar el pago.")+" Tu pedido está guardado; al reintentar no se creará otro pedido.");
    toast(error?.message||"No pudimos preparar el pago en línea.");
  }
}
window.openModal=function(type){
  const content={
    shipping:['Envíos','Si pagas en línea, el envío de productos físicos es gratis. Si eliges contraentrega, el costo del flete depende del destino y debe pagarse por anticipado a la transportadora; el producto se paga al recibirlo.'],
    returns:['Cambios y devoluciones','Para consultas sobre cambios, devoluciones o garantía, escribe a hola@novashop.co. Las condiciones aplicables no limitan los derechos que te reconoce la normativa vigente.'],
    privacy:['Privacidad','Los datos que compartes se utilizan para gestionar tu cuenta y coordinar los pedidos. No ingreses números de tarjeta, contraseñas ni códigos de seguridad en esta página. Para consultas sobre tus datos, escríbenos a hola@novashop.co.']
  }[type];
  $('#modalContent').innerHTML=`<span class="eyebrow">INFORMACIÓN</span><h2>${content[0]}</h2><p>${content[1]}</p>`;
  $('#infoModal').classList.add('show'); $('#infoModal').setAttribute('aria-hidden','false');
}
window.closeModal=function(){ $('#infoModal').classList.remove('show'); $('#infoModal').setAttribute('aria-hidden','true'); }

document.addEventListener('DOMContentLoaded',()=>{
  const registrationNotice=new URLSearchParams(window.location.search).get('registro');
  if(registrationNotice==='creado')toast('¡Cuenta creada correctamente! Ya puedes comprar en NovaShop.',5000);
  else if(registrationNotice==='acceso')toast('¡Listo! Guardamos tus datos y ya puedes comprar en NovaShop.',5000);
  if(registrationNotice)history.replaceState(null,'',window.location.pathname+window.location.hash);
  const streamingPage = document.body.dataset.page === 'streaming';
  const pageCategories = [...new Set(products.filter(p=>streamingPage ? p.category==='Streaming' : p.category!=='Streaming').map(p=>p.category))];
  $('#categoryFilter').innerHTML='<option value="all">'+(streamingPage?'Todas las plataformas':'Todas las categorías')+'</option>'+pageCategories.map(c=>`<option>${c}</option>`).join('');
  const requestedCategory=new URLSearchParams(window.location.search).get('category');
  if(!streamingPage&&requestedCategory&&pageCategories.includes(requestedCategory))$('#categoryFilter').value=requestedCategory;
  if(streamingPage){ $('#categorias')?.setAttribute('hidden',''); const h=$('.product-heading h2'); if(h) h.textContent='Plataformas de Streaming'; const eye=$('.product-heading .eyebrow'); if(eye) eye.textContent='SERVICIOS DIGITALES'; }
  renderFeaturedProduct(); renderCategories(); renderProducts(); renderCart();
  loadCatalogReviewStats();
  window.NovaShopDB?.syncCatalog?.(products).then(()=>{renderCategories();renderProducts();renderFeaturedProduct();loadCatalogReviewStats();}).catch(err=>console.warn('Catálogo Supabase:',err));
  $('#categoryFilter').addEventListener('change',renderProducts); $('#audienceFilter')?.addEventListener('change',renderProducts); $('#sortSelect').addEventListener('change',renderProducts); $('#searchInput').addEventListener('input',renderProducts);
  $('#minPriceFilter')?.addEventListener('input',renderProducts);$('#maxPriceFilter')?.addEventListener('input',renderProducts);$('#hideSoldOut')?.addEventListener('change',renderProducts);$('#onlyOffers')?.addEventListener('change',renderProducts);
  refreshFavoriteIds();
  $('#searchToggle').addEventListener('click',()=>{ const x=$('#searchBarWrap'); x.classList.toggle('open'); if(x.classList.contains('open')) $('#searchInput').focus(); });
  $('#quickAddClose')?.addEventListener('click',closeQuickAdd);
  $('#quickAddModal')?.addEventListener('click',event=>{if(event.target.id==='quickAddModal')closeQuickAdd();});
  $('#quickAddAudienceOptions')?.addEventListener('click',event=>{
    const button=event.target.closest('[data-quick-audience]');if(!button)return;
    const p=product(quickAddProductId);if(!p)return;
    const audience=button.dataset.quickAudience;
    if(!catalogProductAudiences(p).includes(audience))return;
    quickAddSelectedAudience=audience;quickAddSelectedColor=null;quickAddSelectedSize=null;
    const colors=catalogColorVariants(p);
    if(colors.length===1)quickAddSelectedColor=colors[0].name;
    const sizes=catalogSizeVariants(p);
    if(sizes.length===1)quickAddSelectedSize=sizes[0];
    renderQuickAddOptions();
  });
  $('#quickAddColorOptions')?.addEventListener('click',event=>{
    const button=event.target.closest('[data-quick-color]');if(!button)return;
    const p=product(quickAddProductId),v=catalogColorVariants(p)[Number(button.dataset.quickColor)];if(!v)return;
    quickAddSelectedColor=v.name;quickAddSelectedSize=null;
    const sizes=catalogSizeVariants(p);
    if(sizes.length===1)quickAddSelectedSize=sizes[0];
    renderQuickAddOptions();
  });
  $('#quickAddSizeOptions')?.addEventListener('click',event=>{
    const button=event.target.closest('[data-quick-size]');if(!button)return;
    const p=product(quickAddProductId),size=catalogSizeVariants(p)[Number(button.dataset.quickSize)];if(!size)return;
    quickAddSelectedSize=size;renderQuickAddOptions();
  });
  $('#quickAddConfirm')?.addEventListener('click',confirmQuickAdd);
  $('#cartToggle').addEventListener('click',openCart); $('#cartClose').addEventListener('click',closeCart); $('#drawerOverlay').addEventListener('click',closeCart); $('#whatsappCheckout').addEventListener('click',checkoutWhatsApp);
  $('#checkoutForm').addEventListener('submit',submitCheckoutForm); $('#checkoutForm').elements.paymentMethod?.addEventListener('change',renderCheckoutSummary);
  $('#checkoutClose').addEventListener('click',closeCheckoutModal);
  $('#checkoutModal').addEventListener('click',e=>{if(e.target.id==='checkoutModal') closeCheckoutModal();});
  $('#newsletterForm')?.addEventListener('submit',e=>{e.preventDefault();toast('La suscripción por correo estará disponible próximamente. Tu correo no se ha guardado.');});
  if(window.location.hash==='#carrito') openCart();
  $('#infoModal').addEventListener('click',e=>{if(e.target.id==='infoModal') closeModal();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeQuickAdd();closeCheckoutModal(); closeModal(); if($('#cartDrawer').classList.contains('open')) closeCart();}});
});
