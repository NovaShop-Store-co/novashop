const money = (n) => new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: CONFIG.currency,
  maximumFractionDigits: 0
}).format(n);

const params = new URLSearchParams(window.location.search);
const productId = Number(params.get('id'));
let currentProduct = products.find(p => p.id === productId) || products[0];

const $ = (selector) => document.querySelector(selector);
let quantity = 1;
let productFavoriteIds = new Set();
let selectedColorVariant = null;

function cartData() {
  return JSON.parse(localStorage.getItem('novashop-cart') || '[]');
}

function saveCart(cart) {
  localStorage.setItem('novashop-cart', JSON.stringify(cart));
}

function updateCartCount() {
  const count = cartData().reduce((sum, item) => sum + item.qty, 0);
  $('#productCartCount').textContent = count;
}

function refreshProductQuantityControls() {
  const stockKnown=currentProduct?.stockQuantity!=null&&Number.isFinite(Number(currentProduct.stockQuantity));
  const stock=stockKnown?Number(currentProduct.stockQuantity):null;
  const soldOut=stockKnown&&stock<=0;
  $('#quantityValue').textContent=String(quantity);
  $('#qtyMinus').disabled=soldOut||quantity<=1;
  $('#qtyPlus').disabled=soldOut||(stockKnown&&quantity>=stock);
}

function showToast(message) {
  const toast = $('#productToast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(window.__productToast);
  window.__productToast = setTimeout(() => toast.classList.remove('show'), 1800);
}

function addCurrentProduct(amount = quantity) {
  const cart = cartData();
  const variants=Array.isArray(currentProduct.colorVariants)?currentProduct.colorVariants:[];
  if(variants.length&&!selectedColorVariant){showToast("Selecciona el color que quieres comprar.");return;}
  const selectedVariant=selectedColorVariant?.name||null;
  const existing = cart.find(item => Number(item.id) === Number(currentProduct.id) && (item.selectedVariant||null)===selectedVariant);
  if(currentProduct.stockQuantity!=null&&Number(currentProduct.stockQuantity)<=0){showToast('Este producto está agotado');return;}
  if(existing&&currentProduct.stockQuantity!=null&&existing.qty+amount>Number(currentProduct.stockQuantity)){showToast('No hay más unidades disponibles');return;}
  if(existing) {
    existing.qty += amount;
  } else {
    cart.push({
      id: currentProduct.id,
      name: currentProduct.name,
      price: currentProduct.price,
      image: selectedColorVariant?.images?.[0]||currentProduct.images[0],
      selectedVariant,
      qty: amount
    });
  }

  saveCart(cart);
  updateCartCount();
  showToast(`${currentProduct.name}${selectedVariant?" · "+selectedVariant:""} añadido al carrito`);
}

function cleanField(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}


function escProduct(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
async function refreshProductFavorite(){
 const button=$("#toggleProductFavorite");if(!button)return;
 try{const ids=await window.NovaShopDB?.getFavoriteIds?.();if(Array.isArray(ids))productFavoriteIds=new Set(ids.map(Number));}
 catch(e){console.warn("Favoritos:",e);}
 const saved=productFavoriteIds.has(Number(currentProduct.id));button.textContent=saved?"♥ Guardado en favoritos":"♡ Guardar en favoritos";button.classList.toggle("is-favorite",saved);button.setAttribute("aria-pressed",String(saved));
}
async function toggleCurrentProductFavorite(){
 const button=$("#toggleProductFavorite");if(!button)return;
 try{
  let ids=await window.NovaShopDB?.toggleFavorite?.(Number(currentProduct.id));
  if(!Array.isArray(ids)){const next=new Set(productFavoriteIds);next.has(Number(currentProduct.id))?next.delete(Number(currentProduct.id)):next.add(Number(currentProduct.id));productFavoriteIds=next;localStorage.setItem("novashop-favorites-v1",JSON.stringify([...next]));}
  else productFavoriteIds=new Set(ids.map(Number));
  refreshProductFavorite();showToast(productFavoriteIds.has(Number(currentProduct.id))?"Añadido a favoritos":"Quitado de favoritos");
 }catch(e){showToast(e.message||"No pudimos actualizar favoritos.");}
}
const reviewRatingCopy={1:"Mala",2:"Regular",3:"Buena",4:"Muy buena",5:"Excelente"};
function drawReviewStars(preview=0){
 const picker=$("#reviewStarPicker"),input=$("#productReviewForm [name=rating]"),label=$("#reviewRatingLabel");
 if(!picker||!input)return;
 const selected=Number(input.value)||0,display=Number(preview)||selected;
 picker.querySelectorAll("[data-rating]").forEach(button=>{
  const value=Number(button.dataset.rating);
  button.classList.toggle("is-filled",value<=display);
  button.classList.toggle("is-selected",value===selected);
  button.setAttribute("aria-checked",String(value===selected));
  button.tabIndex=value===selected||(!selected&&value===1)?0:-1;
 });
 if(label)label.textContent=display?display+" de 5 estrellas · "+reviewRatingCopy[display]:"Selecciona una calificación de 1 a 5 estrellas.";
}
function initReviewStarPicker(){
 const picker=$("#reviewStarPicker"),input=$("#productReviewForm [name=rating]");
 if(!picker||!input)return;
 const buttons=[...picker.querySelectorAll("[data-rating]")];
 buttons.forEach(button=>{
  button.addEventListener("click",()=>{input.value=button.dataset.rating;drawReviewStars();});
  button.addEventListener("pointerenter",()=>drawReviewStars(button.dataset.rating));
 });
 picker.addEventListener("pointerleave",()=>drawReviewStars());
 picker.addEventListener("focusout",event=>{if(!picker.contains(event.relatedTarget))drawReviewStars();});
 picker.addEventListener("keydown",event=>{
  const current=Number(event.target?.dataset?.rating)||Number(input.value)||1;
  let next=null;
  if(event.key==="ArrowRight"||event.key==="ArrowUp")next=Math.min(5,current+1);
  if(event.key==="ArrowLeft"||event.key==="ArrowDown")next=Math.max(1,current-1);
  if(event.key==="Home")next=1;
  if(event.key==="End")next=5;
  if(next===null)return;
  event.preventDefault();input.value=String(next);drawReviewStars();buttons[next-1]?.focus();
 });
 drawReviewStars();
}
function renderReviewStats(published,mean){
 const box=$("#productReviewStats");if(!box)return;
 if(!published.length){box.hidden=true;box.innerHTML="";return;}
 const fullStars="★".repeat(Math.round(mean))+"☆".repeat(5-Math.round(mean));
 const bars=[5,4,3,2,1].map(star=>{
  const count=published.filter(review=>Number(review.rating)===star).length;
  const percent=Math.round(count/published.length*100);
  return '<div class="review-distribution-row"><span>'+star+' <span aria-hidden="true">★</span></span><div class="review-distribution-track"><span style="width:'+percent+'%"></span></div><b>'+count+'</b></div>';
 }).join("");
 box.innerHTML='<div class="review-score"><strong>'+mean.toFixed(1)+'</strong><div class="review-score-stars" aria-label="'+mean.toFixed(1)+' de 5 estrellas">'+fullStars+'</div><p>'+published.length+' '+(published.length===1?'opinión publicada':'opiniones publicadas')+'</p><small>Calificación de clientes</small></div><div class="review-distribution">'+bars+'</div>';
 box.hidden=false;
}
function reviewHint(text,kind="info"){const el=$("#productReviewHint");if(!el)return;el.textContent=text;el.className="account-message "+kind;el.hidden=!text;}
async function loadProductReviews(){
 const client=window.NovaShopDB?.client,box=$("#productReviewsList"),form=$("#productReviewForm"),summary=$("#productReviewSummary"),authLinks=$("#productReviewAuthLinks");
 if(!box)return;
 let session=null;
 try{session=await window.NovaShopDB?.getSession?.();}catch(_){}
 let reviews=[];
 if(client){
  const {data,error}=await client.from("product_reviews").select("id,user_id,rating,title,body,is_approved,created_at").eq("product_id",Number(currentProduct.id)).order("created_at",{ascending:false}).limit(100);
  if(error){
   box.innerHTML='<div class="favorites-empty"><h2>No pudimos cargar las reseñas</h2><p>Inténtalo de nuevo más tarde.</p></div>';
   if(form)form.hidden=true;
   if(authLinks)authLinks.hidden=true;
   reviewHint("No pudimos consultar las reseñas de este producto. Inténtalo de nuevo más tarde.","error");
   console.warn("Reseñas:",error.message);return;
  }else reviews=data||[];
 }
 const published=reviews.filter(r=>r.is_approved);
 const own=session?.user?reviews.find(r=>r.user_id===session.user.id):null;
 const mean=published.length?published.reduce((sum,r)=>sum+Number(r.rating||0),0)/published.length:0;
 const ratingRow=document.querySelector(".rating-row");
 if(ratingRow){
  ratingRow.hidden=!published.length;
  $("#productRating").textContent=published.length?mean.toFixed(1):"";
  $("#productReviews").textContent=published.length?"("+published.length+" reseñas)":"";
  $("#productRatingStars").textContent=published.length?("★".repeat(Math.round(mean))+"☆".repeat(5-Math.round(mean))):"";
 }
 if(summary)summary.textContent=published.length?published.length+" reseñas publicadas · Promedio "+mean.toFixed(1)+" de 5 estrellas.":"Todavía no hay reseñas publicadas de este producto.";
 renderReviewStats(published,mean);
 box.innerHTML=reviews.length?reviews.filter(r=>r.is_approved||(session?.user&&r.user_id===session.user.id)).map(r=>'<article class="product-review-card"><div class="product-review-card-head"><div><strong>'+escProduct(r.title||"Opinión de comprador")+'</strong><div class="product-review-meta">'+escProduct(r.user_id===session?.user?.id?"Tu reseña":"Comprador verificado")+' · '+escProduct(new Date(r.created_at).toLocaleDateString("es-CO"))+'</div></div><span class="product-review-stars">'+("★".repeat(Number(r.rating)||0))+("☆".repeat(5-(Number(r.rating)||0)))+'</span></div><p>'+escProduct(r.body)+'</p>'+(r.user_id===session?.user?.id&&!r.is_approved?'<small class="admin-help">Pendiente de revisión antes de publicarse.</small>':"")+'</article>').join(""):'<div class="favorites-empty"><h2>Tu opinión puede ser la primera</h2><p>Cuando haya reseñas aprobadas aparecerán aquí.</p></div>';
 if(!form)return;
 if(!session?.user){form.hidden=true;if(authLinks)authLinks.hidden=false;reviewHint("Inicia sesión o crea una cuenta para valorar este producto. Solo se aceptan reseñas de compras entregadas.");return;}
 if(authLinks)authLinks.hidden=true;
 if(own){form.hidden=true;reviewHint(own.is_approved?"Ya publicaste una reseña de este producto.":"Ya recibimos tu reseña; está pendiente de revisión.","success");return;}
 let eligible=false;
 try{
  const {data:orders}=await client.from("orders").select("id").eq("user_id",session.user.id).eq("status","delivered").limit(100);
  const orderIds=(orders||[]).map(o=>o.id);
  if(orderIds.length){
   const {data:items}=await client.from("order_items").select("product_id").eq("product_id",Number(currentProduct.id)).in("order_id",orderIds).limit(1);
   eligible=!!items?.length;
  }
 }catch(e){console.warn("No se pudo comprobar la entrega para reseñas:",e.message);}
 form.hidden=!eligible;
 reviewHint(eligible?"Tu pedido fue entregado. Deja una reseña; se publicará tras la revisión de NovaShop.":"Podrás escribir una reseña cuando una compra de este producto figure como entregada.","info");
}
async function submitProductReview(event){
 event.preventDefault();
 const form=event.currentTarget;
 if(!Number(form.elements.rating?.value)){
  reviewHint("Selecciona una calificación de 1 a 5 estrellas antes de enviar tu reseña.","error");
  $("#reviewStarPicker [data-rating='1']")?.focus();return;
 }
 if(!form.reportValidity())return;
 const session=await window.NovaShopDB?.getSession?.(),client=window.NovaShopDB?.client;
 if(!session?.user||!client){reviewHint("Inicia sesión para dejar una reseña.","error");return;}
 const raw=new FormData(form),button=form.querySelector('[type="submit"]');
 button.disabled=true;button.textContent="Enviando…";
 try{
  const {error}=await client.from("product_reviews").insert({product_id:Number(currentProduct.id),user_id:session.user.id,rating:Number(raw.get("rating")),title:cleanField(raw.get("title")),body:cleanField(raw.get("body"))});
  if(error){if(error.code==="23505")throw new Error("Ya enviaste una reseña para este producto.");throw error;}
  form.reset();drawReviewStars();reviewHint("Gracias. Tu reseña quedó pendiente de revisión y se mostrará cuando sea aprobada.","success");await loadProductReviews();
 }catch(e){reviewHint(e.message||"No se pudo enviar la reseña. Verifica que el pedido esté entregado.","error");}
 finally{button.disabled=false;button.textContent="Enviar reseña";}
}

function renderProductCheckoutSummary() {
  const total = currentProduct.price * quantity;
  const summary = $('#productCheckoutSummary');
  if (!summary) return;
  summary.innerHTML = `
    <div class="checkout-summary-title"><strong>🛍️ Tu compra</strong><span>${quantity} ${quantity === 1 ? 'unidad' : 'unidades'}</span></div>
    <ul class="checkout-summary-list">
      <li>${escProduct(currentProduct.name)}${selectedColorVariant?" · Color: "+escProduct(selectedColorVariant.name):""} ×${quantity} — <strong>${money(total)}</strong></li>
    </ul>
    <div class="checkout-summary-total"><span>Subtotal de productos</span><strong>${money(total)}</strong></div>
  `;
}

function configureProductPaymentMethods(form){
  const allowContraentrega=currentProduct.deliveryType==="physical";
  const select=form?.querySelector('select[name="paymentMethod"]');
  const boldOption=select?.querySelector('option[value="bold"]');
  const codOption=select?.querySelector('option[value="cash_on_delivery"]');
  if(boldOption)boldOption.textContent=allowContraentrega?"Pagar en línea con Bold · envío gratis":"Pagar en línea con Bold";
  if(codOption){codOption.hidden=!allowContraentrega;codOption.disabled=!allowContraentrega;}
  if(select&&!allowContraentrega)select.value="bold";
  const policy=form?.querySelector("[data-payment-policy]");
  const intro=form?.querySelector("[data-payment-intro]");
  if(allowContraentrega){
    if(intro)intro.textContent="Completa tus datos y elige cómo pagar. Con Bold el envío es gratis y en la pasarela podrás seleccionar uno de los medios habilitados. Con contraentrega pagarás el producto al recibirlo y el flete debe pagarse por anticipado a la transportadora.";
    if(policy)policy.textContent="Con Bold el envío es gratis y puedes elegir un medio habilitado en la pasarela. Con contraentrega pagas el producto al recibirlo y el flete cotizado según destino por anticipado a la transportadora.";
  }else{
    if(intro)intro.textContent="Completa tus datos y paga este servicio digital en línea con Bold. No hay envío físico ni contraentrega; si tienes dudas del servicio, puedes consultarnos por WhatsApp antes de comprar.";
    if(policy)policy.textContent="Este es un servicio digital: paga en línea con Bold. No aplica contraentrega ni envío físico. Si tienes preguntas sobre el servicio, consúltanos por WhatsApp antes de comprar.";
  }
}
function openProductCheckout() {
  renderProductCheckoutSummary();
  const modal=$('#productCheckoutModal');
  modal.classList.add('show');
  modal.setAttribute('aria-hidden','false');
  document.body.style.overflow='hidden';
  const deliveryFields=$('#productDeliveryFields');if(deliveryFields)deliveryFields.hidden=currentProduct.deliveryType==='digital';
  configureProductPaymentMethods($('#productCheckoutForm'));
  window.NovaShopDB?.prefillCheckout?.($('#productCheckoutForm')).catch(err=>console.warn('Perfil no precargado:',err));
  window.NovaShopDeliveryMaps?.invalidate('productCheckoutMap');
  window.setTimeout(() => $('#productCheckoutForm input[name="firstName"]')?.focus(), 50);
}

function closeProductCheckout() {
  const modal = $('#productCheckoutModal');
  const form=$('#productCheckoutForm');
  if(form?.dataset.boldOrderId){
    delete form.dataset.boldOrderId;
    form.querySelectorAll('input,select,textarea').forEach(field=>{field.disabled=false;});
    const button=form.querySelector('button[data-bold-ready]')||form.querySelector('button[type="submit"]');
    if(button){button.type='submit';button.onclick=null;delete button.dataset.boldReady;button.disabled=false;button.textContent='Confirmar pedido';}
    form.querySelector('[data-bold-payment-status]')?.remove();
  }
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function buildProductWhatsAppMessage(data, orderInfo={}) {
  const order=typeof orderInfo==='string'?{order_number:orderInfo}:(orderInfo||{});
  const orderNumber=order.order_number||'';
  const subtotal = currentProduct.price * quantity;
  const discount=Math.max(0,Number(order.discount_cop)||0);
  const finalTotal=order.total_cop!=null?Number(order.total_cop):Math.max(0,subtotal-discount);

  const I = {
    wave: '\u{1F44B}',
    bag: '\u{1F6CD}',
    package: '\u{1F4E6}',
    user: '\u{1F464}',
    phone: '\u{1F4F1}',
    email: '\u{1F4E7}',
    pin: '\u{1F4CD}',
    house: '\u{1F3E0}',
    note: '\u{1F4DD}',
    card: '\u{1F4B3}',
    check: '\u{2705}',
    pray: '\u{1F64F}'
  };

  return [
    `${I.wave} Hola, ${data.firstName}! Quiero comprar este producto en ${CONFIG.storeName}.`,
    orderNumber ? `🧾 Número de pedido: ${orderNumber} (pendiente de pago)` : null,
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    `${I.bag} *MI COMPRA*`,
    '━━━━━━━━━━━━━━━━━━━━',
    `1. ${currentProduct.name}`,
    `   Cantidad: ${quantity}`,
    `   Precio: ${money(currentProduct.price)} c/u`,
    `   Total: ${money(subtotal)}`,
    '',
    `${I.package} *Subtotal:* ${money(subtotal)}`,
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
    ...(currentProduct.deliveryType==='digital'
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
    '• Disponibilidad del producto',
    '• Costo de envío',
    '• Tiempo estimado de entrega',
    '',
    `${I.pray} ¡Muchas gracias! Quedo atento a su confirmación.`
  ].filter(Boolean).join('\n');
}

async function submitProductCheckout(event) {
  event.preventDefault();
  const form=event.currentTarget;
  const formButton=form.querySelector('button[type="submit"],button[data-bold-ready]');
  if(form.dataset.boldOrderId){
    if(!window.NovaShopBold?.prepare){showToast("La integración de Bold no está disponible. Recarga la página e inténtalo de nuevo.");return;}
    if(formButton){formButton.disabled=true;formButton.textContent="Preparando pago…";}
    try{
      await window.NovaShopBold.prepare(form.dataset.boldOrderId,formButton,closeProductCheckout);
      window.NovaShopBold.setMessage(form,"Tu pedido ya está registrado. Pulsa «Pagar ahora con Bold» para completar el pago seguro.");
    }catch(error){
      if(formButton){formButton.type="submit";formButton.onclick=null;formButton.disabled=false;formButton.textContent="Reintentar pago con Bold";}
      window.NovaShopBold.setMessage(form,(error?.message||"No pudimos preparar el pago.")+" Tu pedido está guardado; puedes reintentar sin crear otro pedido.");
      showToast(error?.message||"No pudimos preparar el pago con Bold.");
    }
    return;
  }
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
  const useBold=data.paymentMethod==="bold";
  const useCOD=data.paymentMethod==="cash_on_delivery";
  if(!useBold&&!useCOD){showToast("Selecciona Bold o contraentrega para continuar.");return;}
  if(useCOD&&currentProduct.deliveryType!=="physical"){
    showToast("La contraentrega solo está disponible para productos físicos. Para servicios digitales, paga con Bold.");return;
  }
  data.paymentMethod=useBold?"Pago en línea con Bold":"Contraentrega";
  const configuredVariants=productColorVariants();
  if(configuredVariants.length&&(!selectedColorVariant||!configuredVariants.some(v=>v.name===selectedColorVariant.name))){showToast("Selecciona un color para continuar.");return;}
  if(currentProduct.deliveryType!=="digital"&&(!data.address||!data.neighborhood||!data.city||!data.department)){
    showToast("Para productos físicos, completa dirección, barrio, ciudad y departamento.");return;
  }
  const hasDeliveryPin=String(data.latitude??"").trim()!==""&&String(data.longitude??"").trim()!==""&&Number.isFinite(Number(data.latitude))&&Number.isFinite(Number(data.longitude))&&Math.abs(Number(data.latitude))<=90&&Math.abs(Number(data.longitude))<=180;
  if(currentProduct.deliveryType!=="digital"&&!hasDeliveryPin){
    const mapStatus=$("#productCheckoutMapStatus");if(mapStatus)mapStatus.textContent="Falta marcar el punto obligatorio de entrega en el mapa.";
    $("#productCheckoutMap")?.scrollIntoView({behavior:"smooth",block:"center"});
    showToast("Para comprar productos físicos, marca obligatoriamente tu ubicación en el mapa.");return;
  }
  if(useBold){
    try{
      const configured=await window.NovaShopDB?.checkBoldConfigured?.();
      if(!configured){showToast("El pago con Bold todavía está en configuración. Elige contraentrega o inténtalo cuando se activen las llaves.");return;}
    }catch(error){showToast(error?.message||"No pudimos comprobar la configuración de Bold.");return;}
  }
  if(!window.NovaShopDB?.isConfigured?.()){
    showToast("El sistema de pedidos no está disponible en este momento. No se ha registrado ni cobrado tu pedido.");return;
  }
  let savedOrder=null;
  const button=form.querySelector('button[type="submit"]');
  if(button){button.disabled=true;button.textContent="Registrando pedido…";}
  try{
    savedOrder=await window.NovaShopDB.createOrder(data,[{product_id:Number(currentProduct.id),quantity:Number(quantity),selected_variant:selectedColorVariant?.name||null}]);
  }catch(error){
    showToast(error?.message||"No pudimos registrar el pedido. Inténtalo de nuevo.");
    if(button){button.disabled=false;button.type="submit";button.textContent="Confirmar pedido";}
    return;
  }finally{
    if(button&&!useBold){button.disabled=false;button.textContent="Confirmar pedido";}
  }
  if(useCOD){
    if(!savedOrder?.order_number){showToast("El servidor no devolvió el número del pedido. Contacta a soporte antes de repetirlo.");return;}
    closeProductCheckout();
    window.location.href="pedido.html?modo=contraentrega&pedido="+encodeURIComponent(savedOrder.order_number);
    return;
  }
  if(!savedOrder?.id){showToast("El servidor no devolvió el identificador del pedido. No hemos abierto el pago.");return;}
  form.dataset.boldOrderId=savedOrder.id;
  form.querySelectorAll("input,select,textarea").forEach(field=>{field.disabled=true;});
  if(button){button.disabled=true;button.textContent="Preparando pago…";}
  window.NovaShopBold?.setMessage(form,"Pedido "+(savedOrder.order_number||"registrado")+". Estamos preparando el checkout seguro de Bold.");
  try{
    if(!window.NovaShopBold?.prepare)throw new Error("La integración de Bold no está disponible. Recarga la página.");
    await window.NovaShopBold.prepare(savedOrder.id,button,closeProductCheckout);
    window.NovaShopBold.setMessage(form,"Pedido "+(savedOrder.order_number||"registrado")+". Pulsa «Pagar ahora con Bold» para pagar y recibir envío gratis.");
  }catch(error){
    if(button){button.type="submit";button.onclick=null;button.disabled=false;button.textContent="Reintentar pago con Bold";}
    window.NovaShopBold?.setMessage(form,(error?.message||"No pudimos preparar el pago.")+" Tu pedido está guardado; al reintentar no se creará otro pedido.");
    showToast(error?.message||"No pudimos preparar el pago con Bold.");
  }
}


function productColorVariants(){
 return Array.isArray(currentProduct?.colorVariants)?currentProduct.colorVariants.filter(v=>v&&typeof v.name==="string"&&v.name.trim()):[];
}
function renderProductColorOptions(){
 const box=$("#productColorOptions");if(!box)return;
 const variants=productColorVariants();
 if(!variants.length){box.hidden=true;box.innerHTML="";selectedColorVariant=null;return;}
 if(!selectedColorVariant||!variants.some(v=>v.name===selectedColorVariant.name))selectedColorVariant=variants[0];
 const safeHex=value=>/^#[0-9a-f]{6}$/i.test(String(value||""))?String(value):"#d1d5db";
 box.hidden=false;
 box.innerHTML='<div class="product-color-options-head"><strong>Elige un color</strong><span>'+escProduct(selectedColorVariant?.name||"")+'</span></div><div class="product-color-swatch-list">'+variants.map((variant,index)=>{
  const active=variant.name===selectedColorVariant?.name;
  return '<button type="button" class="product-color-swatch" data-color-variant="'+index+'" aria-pressed="'+(active?"true":"false")+'" aria-label="Seleccionar color '+escProduct(variant.name)+'"><span style="background:'+safeHex(variant.hex)+'"></span><span>'+escProduct(variant.name)+'</span>'+(active?'<span class="product-color-check" aria-hidden="true">✓</span>':'')+'</button>';
 }).join("")+'</div><p class="product-color-help">Las imágenes cambian según el color seleccionado. Revisa las vistas frontal y trasera en las miniaturas.</p>';
 box.querySelectorAll("[data-color-variant]").forEach(button=>button.addEventListener("click",()=>{
  const variant=variants[Number(button.dataset.colorVariant)];if(!variant)return;
  selectedColorVariant=variant;
  renderProductColorOptions();renderProductMedia();renderProductCheckoutSummary();
 }));
}
function renderProductMedia(){
 const mainImage=$("#productMainImage"),mainVideo=$("#productMainVideo"),mediaFrame=$("#productMediaFrame");
 const variants=productColorVariants();
 const variantImages=selectedColorVariant&&Array.isArray(selectedColorVariant.images)?selectedColorVariant.images.filter(Boolean).slice(0,2):[];
 const galleryImages=variantImages.length?variantImages:(Array.isArray(currentProduct.images)?currentProduct.images:[]);
 const titlePrefix=selectedColorVariant?currentProduct.name+" · "+selectedColorVariant.name:currentProduct.name;
 const firstImage=galleryImages[0]||"images/streaming-placeholder.svg";
 mainImage.hidden=false;mainImage.src=firstImage;mainImage.alt=titlePrefix+(selectedColorVariant?" · vista frontal":"");
 mainVideo.pause();mainVideo.hidden=true;mainVideo.removeAttribute("src");mainVideo.removeAttribute("poster");mainVideo.load();mediaFrame?.classList.remove("is-video");
 if(currentProduct.videoUrl){mainVideo.src=currentProduct.videoUrl;mainVideo.poster=firstImage;}
 $("#productThumbnails").innerHTML=galleryImages.map((image,index)=>{
  const label=selectedColorVariant?(index===0?"Vista frontal":"Vista trasera"):("Ver imagen "+(index+1));
  return '<button class="thumbnail '+(index===0?"active":"")+'" type="button" data-index="'+index+'" aria-label="'+escProduct(label+(selectedColorVariant?" del color "+selectedColorVariant.name:""))+'"><img src="'+escProduct(image)+'" alt="'+escProduct(titlePrefix+" · "+label)+'">'+(selectedColorVariant?'<span class="product-thumbnail-label">'+(index===0?"FRENTE":"ESPALDA")+'</span>':"")+'</button>';
 }).join("")+(currentProduct.videoUrl?'<button class="thumbnail video-thumbnail" type="button" data-video="true" aria-label="Reproducir video del producto"><span>▶</span><small>Ver video</small></button>':"");
 $("#productThumbnails").querySelectorAll(".thumbnail").forEach(button=>button.addEventListener("click",()=>{
  $("#productThumbnails").querySelectorAll(".thumbnail").forEach(item=>item.classList.remove("active"));button.classList.add("active");
  if(button.dataset.video==="true"){mainImage.hidden=true;mainVideo.hidden=false;mediaFrame?.classList.add("is-video");mainVideo.play().catch(()=>{});}
  else{mainVideo.pause();mainVideo.hidden=true;mainImage.hidden=false;mediaFrame?.classList.remove("is-video");const imageIndex=Number(button.dataset.index);mainImage.src=galleryImages[imageIndex]||firstImage;mainImage.alt=titlePrefix+(selectedColorVariant?(imageIndex===0?" · vista frontal":" · vista trasera"):" · imagen "+(imageIndex+1));}
 }));
}

function renderProduct() {
  document.title = `${currentProduct.name} — ${CONFIG.storeName}`;
  const isDigitalProduct=currentProduct.category==='Streaming'||currentProduct.deliveryType==='digital';

  $('#breadcrumbCategory').textContent = currentProduct.category;
  $('#breadcrumbProduct').textContent = currentProduct.name;
  $('#breadcrumbCategory').href = isDigitalProduct ? 'streaming.html' : `index.html?category=${encodeURIComponent(currentProduct.category)}#productos`;

  $('#productCategory').textContent = currentProduct.category.toUpperCase();
  $('#productName').textContent = currentProduct.name;
  // Public ratings are calculated only from actual approved customer reviews.
  const ratingRow = document.querySelector('.rating-row');
  if(ratingRow) ratingRow.hidden = true;
  $('#productRating').textContent = '';
  $('#productReviews').textContent = '';
  $('#productPrice').textContent = money(currentProduct.price);
  $('#productOldPrice').textContent = currentProduct.oldPrice ? money(currentProduct.oldPrice) : '';
  $('#productDiscount').textContent = currentProduct.oldPrice ? currentProduct.tag : '';
  $('#productDescription').textContent = currentProduct.description;
  $('#longDescription').textContent = currentProduct.description;
  $('#longDescriptionHeading').textContent = isDigitalProduct ? 'Sobre este servicio' : 'Descripción del producto';
  $('#productFeaturesHeading').textContent = isDigitalProduct ? 'Qué debes saber' : 'Características';

  const fulfillmentPanel=$('#productFulfillmentPanel');
  fulfillmentPanel.className='product-fulfillment-panel '+(isDigitalProduct?'is-digital':'is-physical');
  $('#productFulfillmentIcon').textContent=isDigitalProduct?'✦':'✓';
  $('#productFulfillmentTitle').textContent=isDigitalProduct?'Antes de pagar, confirma los detalles':'Entrega clara, sin sorpresas';
  $('#productFulfillmentText').textContent=isDigitalProduct
    ? 'Es un servicio digital y no necesita envío físico. Confirma disponibilidad, duración, modalidad de acceso y condiciones con NovaShop antes de pagar.'
    : 'Con Bold, el envío del producto físico es gratis. Si consultas contraentrega, el flete se cotiza según tu destino y se paga por anticipado a la transportadora.';
  $('#productTrust1').textContent=isDigitalProduct?'No requiere envío físico':'Envío gratis pagando con Bold';
  $('#productTrust2').textContent=isDigitalProduct?'Pago en línea con Bold':'Consulta contraentrega según tu destino';
  $('#productTrust3').textContent=isDigitalProduct?'Confirma disponibilidad y condiciones antes de comprar':'Consulta dudas sobre el producto por WhatsApp';
  $('#productShippingTitle').textContent=isDigitalProduct?'Entrega digital':'Envíos y entrega';
  $('#productShipping').textContent = currentProduct.shipping;

  const stockNote=$('#productAvailabilityNote');
  const stockKnown=currentProduct.stockQuantity!=null&&Number.isFinite(Number(currentProduct.stockQuantity));
  const stock=stockKnown?Number(currentProduct.stockQuantity):null;
  const soldOut=stockKnown&&stock<=0;
  if(stockNote){
    stockNote.hidden=!stockKnown;
    stockNote.className='product-availability-note'+(soldOut?' is-sold-out':'');
    stockNote.textContent=soldOut?'Agotado por ahora':stock===1?'Disponible · 1 unidad':`Disponible · ${stock} unidades`;
  }
  $('#addProductToCart').disabled=soldOut;
  $('#addProductToCart').textContent=soldOut?'Agotado':'Agregar al carrito';
  $('#buyNow').disabled=soldOut;
  $('#buyNow').textContent=soldOut?'Agotado':'Comprar ahora';
  if(stockKnown&&stock>0)quantity=Math.min(quantity,stock);
  if(soldOut)quantity=1;
  refreshProductQuantityControls();
  const askProduct=$('#askProductWhatsApp');
  if(askProduct){
    const question="Hola, tengo una consulta sobre "+currentProduct.name+". ¿Me pueden ayudar con información del producto?";
    askProduct.href="https://wa.me/"+CONFIG.whatsapp+"?text="+encodeURIComponent(question);
    askProduct.setAttribute("aria-label","Consultar por WhatsApp sobre "+currentProduct.name);
  }
  $('#productTag').textContent = isDigitalProduct ? 'SERVICIO DIGITAL' : (currentProduct.tag||'PRODUCTO');

  $('#productRatingStars').textContent = '';

  const variants=Array.isArray(currentProduct.colorVariants)?currentProduct.colorVariants:[];
  if(!variants.length)selectedColorVariant=null;
  else if(!selectedColorVariant||!variants.some(v=>v.name===selectedColorVariant.name))selectedColorVariant=variants[0];
  renderProductColorOptions();
  renderProductMedia();
  $('#productFeatures').innerHTML = (Array.isArray(currentProduct.features)?currentProduct.features:[]).map(item => `<li>✓ ${escProduct(item)}</li>`).join('');
}

$('#qtyMinus').addEventListener('click', () => {
  quantity = Math.max(1, quantity - 1);
  refreshProductQuantityControls();
});

$('#qtyPlus').addEventListener('click', () => {
  if(currentProduct.stockQuantity!=null&&quantity>=Number(currentProduct.stockQuantity)){showToast('No hay más unidades disponibles');return;}
  quantity += 1;
  refreshProductQuantityControls();
});

$('#addProductToCart').addEventListener('click', () => addCurrentProduct());
$('#toggleProductFavorite')?.addEventListener('click',toggleCurrentProductFavorite);
$('#productReviewForm')?.addEventListener('submit',submitProductReview);
initReviewStarPicker();
$('#buyNow').addEventListener('click', openProductCheckout);
$('#productCheckoutClose').addEventListener('click', closeProductCheckout);
$('#productCheckoutModal').addEventListener('click', (event) => {
  if (event.target.id === 'productCheckoutModal') closeProductCheckout();
});
$('#productCheckoutForm').addEventListener('submit', submitProductCheckout);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeProductCheckout();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') updateCartCount();
});

renderProduct();
updateCartCount();
refreshProductFavorite();
loadProductReviews();
window.NovaShopDB?.syncCatalog?.(products).then(()=>{currentProduct=products.find(p=>p.id===productId)||currentProduct;renderProduct();refreshProductFavorite();loadProductReviews();}).catch(err=>console.warn('Catálogo Supabase:',err));
