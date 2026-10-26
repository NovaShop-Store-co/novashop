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
function renderProducts(){
  const query = $('#searchInput').value.trim().toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const cat = $('#categoryFilter').value;
  const sort = $('#sortSelect').value;
  const streamingPage = document.body.dataset.page === 'streaming';
  const minValue=Number($('#minPriceFilter')?.value||0),maxRaw=$('#maxPriceFilter')?.value;
  const maxValue=maxRaw==null||maxRaw===''?Infinity:Number(maxRaw);
  const hideSoldOut=!!$('#hideSoldOut')?.checked,onlyOffers=!!$('#onlyOffers')?.checked;
  let list = products.filter(p=>{
    const searchText=[p.name,p.category,p.description,p.tag,...(Array.isArray(p.features)?p.features:[])].filter(Boolean).join(' ').toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    return (streamingPage ? p.category==='Streaming' : p.category!=='Streaming')&&(cat==='all'||p.category===cat)&&searchText.includes(query)&&Number(p.price)>=minValue&&Number(p.price)<=maxValue&&(!hideSoldOut||p.stockQuantity==null||Number(p.stockQuantity)>0)&&(!onlyOffers||(Number(p.oldPrice)>Number(p.price)));
  });
  if(sort==='priceAsc') list.sort((a,b)=>a.price-b.price);
  if(sort==='priceDesc') list.sort((a,b)=>b.price-a.price);
  if(sort==='name') list.sort((a,b)=>a.name.localeCompare(b.name,'es'));
  $('#emptyState').hidden=list.length!==0;
  $('#productGrid').innerHTML=list.map(p=>`<article class="product-card">
    <a class="product-link" href="producto.html?id=${p.id}" aria-label="Ver ${p.name}">
      <div class="product-media"><img src="${p.images[0]}" alt="${p.name}" loading="lazy">${p.category==='Streaming'?'':(p.oldPrice?'<span class="tag">OFERTA</span>':(p.tag?'<span class="tag">'+p.tag+'</span>':''))}</div>
      <div class="product-body"><div class="category-label">${p.category}</div>${renderLiveRating(p.id)}<div class="product-title">${p.name}</div>
        <div class="price-row"><span class="price">${money(p.price)}</span>${p.oldPrice?`<span class="old-price">${money(p.oldPrice)}</span>`:''}</div>
        ${Array.isArray(p.colorVariants)&&p.colorVariants.length?`<div class="product-card-colors"><span>Colores disponibles · ${p.colorVariants.length}</span><div>${p.colorVariants.slice(0,5).map(v=>`<i title="${escapeHTML(v.name||"Color")}" style="background:${/^#[0-9a-f]{6}$/i.test(String(v.hex||""))?v.hex:"#d1d5db"}"></i>`).join("")}</div></div>`:'' }
        <div class="product-fulfillment-note ${p.category==='Streaming'?'is-digital':'is-physical'}"><span aria-hidden="true">${p.category==='Streaming'?'💻':'🚚'}</span><span>${p.category==='Streaming'?'Servicio digital · sin envío físico':'Envío gratis pagando con Bold'}</span></div>
      </div>
    </a>
    <div class="product-actions"><button class="add-btn" data-id="${p.id}">${Array.isArray(p.colorVariants)&&p.colorVariants.length?"Elegir color":"Añadir al carrito"}</button></div>
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
  document.querySelectorAll('.add-btn').forEach(btn=>btn.addEventListener('click',()=>addToCart(Number(btn.dataset.id))));
}

function addToCart(id){
  const p=product(id);if(!p)return;
  if(Array.isArray(p.colorVariants)&&p.colorVariants.length){window.location.href="producto.html?id="+encodeURIComponent(id);return;}
  const found=cart.find(i=>Number(i.id)===Number(id)&&!i.selectedVariant);
  if(p.stockQuantity!=null&&Number(p.stockQuantity)<=0){toast('Este producto está agotado');return;}
  if(found){if(p.stockQuantity!=null&&found.qty>=Number(p.stockQuantity)){toast('No hay más unidades disponibles');return;}found.qty++;}
  else cart.push({id:p.id,name:p.name,price:p.price,image:p.images[0],qty:1});
  saveCart(); renderCart(); openCart(); toast('Producto añadido al carrito');
}
function changeQty(index,delta){const item=cart[index];if(!item)return;const p=product(Number(item.id));const productQty=cart.filter(row=>Number(row.id)===Number(item.id)).reduce((sum,row)=>sum+Number(row.qty||0),0);if(delta>0&&p?.stockQuantity!=null&&productQty>=Number(p.stockQuantity)){toast('No hay más unidades disponibles');return;}item.qty+=delta;if(item.qty<=0)cart.splice(index,1);saveCart();renderCart();}
function removeItem(index){if(!Number.isInteger(index)||index<0||index>=cart.length)return;cart.splice(index,1);saveCart();renderCart();}
function renderCart(){
  $('#cartCount').textContent=cartCount();
  if(!cart.length){ $('#cartItems').innerHTML='<div class="cart-empty">Tu carrito está vacío.<br>Añade productos para comenzar.</div>'; $('#cartSubtotal').textContent=money(0); return; }
  $('#cartItems').innerHTML=cart.map((i,index)=>`<div class="cart-item"><img src="${escapeHTML(i.image||"")}" alt=""><div><h4>${escapeHTML(i.name)}</h4>${i.selectedVariant?`<p class="cart-item-variant">Color: ${escapeHTML(i.selectedVariant)}</p>`:""}<p>${money(i.price)} c/u</p><div class="qty-control"><button data-action="dec" data-index="${index}">−</button><span>${i.qty}</span><button data-action="inc" data-index="${index}">+</button></div></div><div><strong>${money(i.price*i.qty)}</strong><br><button class="remove" data-action="remove" data-index="${index}">Eliminar</button></div></div>`).join('');
  $('#cartSubtotal').textContent=money(cartTotal());
  document.querySelectorAll('#cartItems button').forEach(b=>b.addEventListener('click',()=>{const index=Number(b.dataset.index);const a=b.dataset.action;if(a==='dec')changeQty(index,-1);if(a==='inc')changeQty(index,1);if(a==='remove')removeItem(index);}));
}

function openCart(){ $('#cartDrawer').classList.add('open'); $('#drawerOverlay').classList.add('show'); document.body.style.overflow='hidden'; }
function closeCart(){ $('#cartDrawer').classList.remove('open'); $('#drawerOverlay').classList.remove('show'); document.body.style.overflow=''; }
function toast(msg,duration=1800){ const t=$('#toast'); if(!t)return; t.textContent=msg; t.classList.add('show'); clearTimeout(window.__toast); window.__toast=setTimeout(()=>t.classList.remove('show'),duration); }

function configureCheckoutPaymentMethods(form,allowContraentrega,digitalOnly){
  const select=form?.querySelector('select[name="paymentMethod"]');
  const boldOption=select?.querySelector('option[value="bold"]');
  const codOption=select?.querySelector('option[value="cash_on_delivery"]');
  if(boldOption)boldOption.textContent=digitalOnly?"Pagar en línea con Bold":"Pagar en línea con Bold · envío gratis";
  if(codOption){codOption.hidden=!allowContraentrega;codOption.disabled=!allowContraentrega;}
  if(select&&!allowContraentrega)select.value="bold";
  const policy=form?.querySelector("[data-payment-policy]");
  const intro=form?.querySelector("[data-payment-intro]");
  if(digitalOnly){
    if(intro)intro.textContent="Completa tus datos y paga los servicios digitales en línea con Bold. No hay envío físico ni contraentrega; si tienes dudas sobre un servicio, puedes consultarnos por WhatsApp antes de comprar.";
    if(policy)policy.textContent="Este carrito contiene solo servicios digitales: se paga en línea con Bold y no aplica envío físico ni contraentrega. Si tienes preguntas sobre un servicio, consúltanos por WhatsApp antes de comprar.";
  }else if(allowContraentrega){
    if(intro)intro.textContent="Completa tus datos y elige cómo pagar. Con Bold el envío es gratis en productos físicos y en la pasarela podrás elegir uno de los medios habilitados. Con contraentrega pagas el producto al recibirlo y el flete se cotiza según destino y se paga por anticipado a la transportadora.";
    if(policy)policy.textContent="Con Bold el envío es gratis y el cliente elige un medio habilitado en Bold. Con contraentrega, el producto se paga al recibirlo y el flete se cotiza según el destino y se paga por anticipado a la transportadora.";
  }else{
    if(intro)intro.textContent="Completa tus datos y paga en línea con Bold. En este carrito hay productos físicos y servicios digitales, así que no está disponible la contraentrega; el envío de los productos físicos es gratis.";
    if(policy)policy.textContent="Este carrito mezcla productos físicos y servicios digitales, por lo que solo está disponible el pago en línea con Bold. El envío de los productos físicos es gratis al pagar en línea.";
  }
}
function checkoutWhatsApp(){
  if(!cart.length){toast("Añade al menos un producto");return;}
  renderCheckoutSummary();
  const digitalOnly=cart.every(item=>product(item.id)?.deliveryType==="digital");
  const allowContraentrega=cart.every(item=>product(item.id)?.deliveryType==="physical");
  const form=$("#checkoutForm");
  const deliveryFields=$("#cartDeliveryFields");if(deliveryFields)deliveryFields.hidden=digitalOnly;
  configureCheckoutPaymentMethods(form,allowContraentrega,digitalOnly);
  openCheckoutModal();
  window.NovaShopDB?.prefillCheckout?.(form).catch(err=>console.warn("Perfil no precargado:",err));
}

function renderCheckoutSummary(){
  const summary=$('#checkoutSummary');
  if(!summary) return;
  const itemCount=cartCount();
  const lines=cart.map(i=>`<li>${escapeHTML(i.name)}${i.selectedVariant?` · Color: ${escapeHTML(i.selectedVariant)}`:""} ×${i.qty} — <strong>${money(i.price*i.qty)}</strong></li>`).join('');
  summary.innerHTML=`<div class="checkout-summary-title"><strong>Resumen del pedido</strong><span>${itemCount} ${itemCount===1?'producto':'productos'}</span></div><ul class="checkout-summary-list">${lines}</ul><div class="checkout-summary-total"><span>Subtotal</span><strong>${money(cartTotal())}</strong></div>`;
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
      window.NovaShopBold.setMessage(form,"Tu pedido ya está registrado. Pulsa «Pagar ahora con Bold» para completar el pago seguro.");
    }catch(error){
      if(formButton){formButton.type="submit";formButton.onclick=null;formButton.disabled=false;formButton.textContent="Reintentar pago con Bold";}
      window.NovaShopBold.setMessage(form,(error?.message||"No pudimos preparar el pago.")+" Tu pedido está guardado; puedes reintentar sin crear otro pedido.");
      toast(error?.message||"No pudimos preparar el pago con Bold.");
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
  const missingColor=cart.find(item=>Array.isArray(product(item.id)?.colorVariants)&&product(item.id).colorVariants.length&&!item.selectedVariant);
  if(missingColor){toast("En el carrito falta elegir el color de "+(missingColor.name||"uno de los productos")+". Elimina ese producto y vuelve a seleccionarlo desde su ficha.");return;}
  const useBold=data.paymentMethod==="bold";
  const useCOD=data.paymentMethod==="cash_on_delivery";
  if(!useBold&&!useCOD){toast("Selecciona Bold o contraentrega para continuar.");return;}
  if(useCOD&&cart.some(item=>product(item.id)?.deliveryType!=="physical")){
    toast("La contraentrega solo está disponible para pedidos de productos físicos. Para servicios digitales, paga con Bold.");return;
  }
  data.paymentMethod=useBold?"Pago en línea con Bold":"Contraentrega";
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
  if(useBold){
    try{
      const configured=await window.NovaShopDB?.checkBoldConfigured?.();
      if(!configured){toast("El pago con Bold todavía está en configuración. Elige contraentrega o inténtalo cuando se activen las llaves.");return;}
    }catch(error){toast(error?.message||"No pudimos comprobar la configuración de Bold.");return;}
  }
  if(!window.NovaShopDB?.isConfigured?.()){
    toast("El sistema de pedidos no está disponible en este momento. No se ha registrado ni cobrado tu pedido.");return;
  }
  let savedOrder=null;
  const button=form.querySelector('button[type="submit"]');
  if(button){button.disabled=true;button.textContent="Registrando pedido…";}
  try{
    savedOrder=await window.NovaShopDB.createOrder(data,cart.map(item=>({product_id:Number(item.id),quantity:Number(item.qty),selected_variant:item.selectedVariant||null})));
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
    window.location.href="pedido.html?modo=contraentrega&pedido="+encodeURIComponent(savedOrder.order_number);
    return;
  }
  if(!savedOrder?.id){toast("El servidor no devolvió el identificador del pedido. No hemos abierto el pago.");return;}
  form.dataset.boldOrderId=savedOrder.id;
  form.querySelectorAll("input,select,textarea").forEach(field=>{field.disabled=true;});
  if(button){button.disabled=true;button.textContent="Preparando pago…";}
  window.NovaShopBold?.setMessage(form,"Pedido "+(savedOrder.order_number||"registrado")+". Estamos preparando el checkout seguro de Bold.");
  try{
    if(!window.NovaShopBold?.prepare)throw new Error("La integración de Bold no está disponible. Recarga la página.");
    await window.NovaShopBold.prepare(savedOrder.id,button,closeCheckoutModal);
    window.NovaShopBold.setMessage(form,"Pedido "+(savedOrder.order_number||"registrado")+". Pulsa «Pagar ahora con Bold» para pagar y recibir envío gratis.");
  }catch(error){
    if(button){button.type="submit";button.onclick=null;button.disabled=false;button.textContent="Reintentar pago con Bold";}
    window.NovaShopBold?.setMessage(form,(error?.message||"No pudimos preparar el pago.")+" Tu pedido está guardado; al reintentar no se creará otro pedido.");
    toast(error?.message||"No pudimos preparar el pago con Bold.");
  }
}
window.openModal=function(type){
  const content={
    shipping:['Envíos','Si pagas en línea con Bold, el envío de productos físicos es gratis. Si eliges contraentrega, el costo del flete depende del destino y debe pagarse por anticipado a la transportadora; el producto se paga al recibirlo.'],
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
  $('#categoryFilter').addEventListener('change',renderProducts); $('#sortSelect').addEventListener('change',renderProducts); $('#searchInput').addEventListener('input',renderProducts);
  $('#minPriceFilter')?.addEventListener('input',renderProducts);$('#maxPriceFilter')?.addEventListener('input',renderProducts);$('#hideSoldOut')?.addEventListener('change',renderProducts);$('#onlyOffers')?.addEventListener('change',renderProducts);
  refreshFavoriteIds();
  $('#searchToggle').addEventListener('click',()=>{ const x=$('#searchBarWrap'); x.classList.toggle('open'); if(x.classList.contains('open')) $('#searchInput').focus(); });
  $('#cartToggle').addEventListener('click',openCart); $('#cartClose').addEventListener('click',closeCart); $('#drawerOverlay').addEventListener('click',closeCart); $('#whatsappCheckout').addEventListener('click',checkoutWhatsApp);
  $('#checkoutForm').addEventListener('submit',submitCheckoutForm);
  $('#checkoutClose').addEventListener('click',closeCheckoutModal);
  $('#checkoutModal').addEventListener('click',e=>{if(e.target.id==='checkoutModal') closeCheckoutModal();});
  $('#newsletterForm')?.addEventListener('submit',e=>{e.preventDefault();toast('La suscripción por correo estará disponible próximamente. Tu correo no se ha guardado.');});
  if(window.location.hash==='#carrito') openCart();
  $('#infoModal').addEventListener('click',e=>{if(e.target.id==='infoModal') closeModal();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeCheckoutModal(); closeModal(); if($('#cartDrawer').classList.contains('open')) closeCart();}});
});
