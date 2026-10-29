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
let selectedSize = null;
let currentGalleryImages = [];
let currentGalleryTitle = "";
let currentGalleryIndex = 0;
let lightboxPreviousOverflow = "";

const RECENT_PRODUCTS_KEY = "novashop-recent-products-v1";
function readRecentProductIds(){
  try{
    const value=JSON.parse(localStorage.getItem(RECENT_PRODUCTS_KEY)||"[]");
    return Array.isArray(value)?value.map(Number).filter(Number.isFinite):[];
  }catch(_){return [];}
}
function rememberAndRenderRecentlyViewed(){
  const id=Number(currentProduct?.id);
  let ids=readRecentProductIds();
  if(id)ids=[id,...ids.filter(item=>item!==id)].slice(0,12);
  try{localStorage.setItem(RECENT_PRODUCTS_KEY,JSON.stringify(ids));}catch(_){}
  renderRecentlyViewed(ids.filter(item=>item!==id));
}
function renderRecentlyViewed(recentIds){
  const section=$("#recentlyViewedSection"),grid=$("#recentlyViewedGrid");
  if(!section||!grid)return;
  const all=typeof products!=="undefined"&&Array.isArray(products)?products:[];
  const currentId=Number(currentProduct?.id);
  const ids=Array.isArray(recentIds)?recentIds:readRecentProductIds().filter(id=>id!==currentId);
  const recent=ids.filter(id=>id!==currentId).map(id=>all.find(p=>Number(p.id)===Number(id))).filter(Boolean);
  const used=new Set([currentId,...recent.map(p=>Number(p.id))]);
  const sameCategory=all.filter(p=>!used.has(Number(p.id))&&p.category===currentProduct?.category);
  const others=all.filter(p=>!used.has(Number(p.id))&&p.category!==currentProduct?.category);
  const recommendations=[...recent,...sameCategory,...others].slice(0,6);
  section.hidden=!recommendations.length;
  if(!recommendations.length){grid.innerHTML="";return;}
  const eyebrow=$("#recentlyViewedEyebrow"),title=$("#recentlyViewedTitle"),summary=$("#recentlyViewedSummary");
  if(eyebrow)eyebrow.textContent=recent.length?"TU RECORRIDO":"DESCUBRE MÁS";
  if(title)title.textContent=recent.length?"Vistos recientemente":"También te puede interesar";
  if(summary)summary.textContent=recent.length?"Retoma los productos que estuviste mirando o descubre algo parecido.":"Explora más opciones de la tienda que podrían encajar contigo.";
  grid.innerHTML=recommendations.map(p=>{
    const image=Array.isArray(p.images)&&p.images[0]?p.images[0]:"images/streaming-placeholder.svg";
    const old=Number(p.oldPrice)>Number(p.price)&&Number(p.price)>0;
    return '<article class="recent-product-card"><a class="recent-product-link" href="producto.html?id='+encodeURIComponent(p.id)+'"><div class="recent-product-media"><img src="'+escProduct(image)+'" alt="'+escProduct(p.name)+'" loading="lazy">'+(old?'<span class="recent-product-badge">OFERTA</span>':"")+'</div><div class="recent-product-body"><span class="recent-product-category">'+escProduct(p.category||"NovaShop")+'</span><strong>'+escProduct(p.name)+'</strong><div class="recent-product-price">'+(old?'<del>'+money(p.oldPrice)+'</del>':"")+'<b>'+money(p.price)+'</b></div><span class="recent-product-cta">Ver producto <span aria-hidden="true">→</span></span></div></a></article>';
  }).join("");
}



function productGalleryAlt(index){
  return (currentGalleryTitle||currentProduct?.name||"Producto")+
    (selectedColorVariant?(index===0?" · vista frontal":" · vista trasera"):" · imagen "+(index+1));
}
function syncProductLightbox(){
  const image=$("#productLightboxImage"),caption=$("#productLightboxCaption"),counter=$("#productLightboxCounter");
  const total=currentGalleryImages.length;
  if(image){image.src=currentGalleryImages[currentGalleryIndex]||"";image.alt=productGalleryAlt(currentGalleryIndex);}
  if(caption)caption.textContent=productGalleryAlt(currentGalleryIndex);
  if(counter)counter.textContent=(currentGalleryIndex+1)+" / "+Math.max(total,1);
  const previous=$("#productLightboxPrev"),next=$("#productLightboxNext");
  if(previous)previous.disabled=total<2;
  if(next)next.disabled=total<2;
}
function resetProductVideoFrame(){
 const frame=$("#productMediaFrame");if(!frame)return;
 frame.style.aspectRatio="";frame.style.width="";frame.style.maxWidth="";frame.style.maxHeight="";frame.style.marginInline="";
}
function fitProductVideoFrame(){
 const video=$("#productMainVideo"),frame=$("#productMediaFrame");
 if(!video||!frame||video.hidden||!frame.classList.contains("is-video")||!video.videoWidth||!video.videoHeight)return false;
 const parentWidth=frame.parentElement?.clientWidth||frame.clientWidth||0;
 if(!parentWidth)return false;
 const ratio=video.videoWidth/video.videoHeight;
 const maxHeight=Math.max(220,Math.min(650,(window.innerHeight||900)*.72));
 const width=Math.min(parentWidth,maxHeight*ratio);
 frame.style.aspectRatio=video.videoWidth+" / "+video.videoHeight;
 frame.style.width=Math.round(width)+"px";
 frame.style.maxWidth="100%";
 frame.style.maxHeight=Math.round(maxHeight)+"px";
 frame.style.marginInline="auto";
 return true;
}
function setProductGalleryImage(index){
  const total=currentGalleryImages.length;if(!total)return;
  currentGalleryIndex=((Number(index)||0)%total+total)%total;
  const image=$("#productMainImage"),video=$("#productMainVideo"),frame=$("#productMediaFrame");
  if(video){video.pause();video.hidden=true;}
  if(image){image.hidden=false;image.src=currentGalleryImages[currentGalleryIndex];image.alt=productGalleryAlt(currentGalleryIndex);image.setAttribute("aria-label","Ampliar "+image.alt);}
  resetProductVideoFrame();
  frame?.classList.remove("is-video");
  $("#productThumbnails")?.querySelectorAll(".thumbnail").forEach(button=>{
    button.classList.toggle("active",button.dataset.video!=="true"&&Number(button.dataset.index)===currentGalleryIndex);
  });
  if(!$("#productImageLightbox")?.hidden)syncProductLightbox();
}
function openProductImageLightbox(){
  const modal=$("#productImageLightbox");
  if(!modal||!currentGalleryImages.length||$("#productMainVideo")?.hidden===false)return;
  lightboxPreviousOverflow=document.body.style.overflow;
  modal.hidden=false;modal.setAttribute("aria-hidden","false");document.body.style.overflow="hidden";
  syncProductLightbox();$("#productLightboxClose")?.focus();
}
function closeProductImageLightbox(){
  const modal=$("#productImageLightbox");if(!modal||modal.hidden)return;
  modal.hidden=true;modal.setAttribute("aria-hidden","true");document.body.style.overflow=lightboxPreviousOverflow;
  $("#productMainImage")?.focus();
}
function stepProductImageLightbox(direction){
  if(!currentGalleryImages.length)return;
  setProductGalleryImage(currentGalleryIndex+direction);
}

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
  const variants=productColorVariants();
  const sizes=productSizes();
  if(variants.length&&!selectedColorVariant){showToast("Selecciona el color que quieres comprar.");$("#productColorOptions")?.scrollIntoView({behavior:"smooth",block:"center"});return;}
  if(sizes.length&&(!selectedSize||!sizes.includes(selectedSize))){showToast("Selecciona la talla que quieres comprar.");$("#productSizeOptions")?.scrollIntoView({behavior:"smooth",block:"center"});return;}
  const selectedVariant=selectedColorVariant?.name||null;
  const existing = cart.find(item => Number(item.id) === Number(currentProduct.id) && (item.selectedVariant||null)===selectedVariant && (item.selectedSize||null)===(selectedSize||null));
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
      selectedSize:selectedSize||null,
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
      <li>${escProduct(currentProduct.name)}${selectedColorVariant?" · Color: "+escProduct(selectedColorVariant.name):""}${selectedSize?" · Talla: "+escProduct(selectedSize):""} ×${quantity} — <strong>${money(total)}</strong></li>
    </ul>
    <div class="checkout-summary-total"><span>Subtotal de productos</span><strong>${money(total)}</strong></div>
  `;
}

function configureProductPaymentMethods(form){
  const allowContraentrega=currentProduct.deliveryType==="physical";
  const select=form?.querySelector('select[name="paymentMethod"]');
  const boldOption=select?.querySelector('option[value="bold"]');
  const codOption=select?.querySelector('option[value="cash_on_delivery"]');
  if(boldOption)boldOption.textContent=allowContraentrega?"Pago en línea · envío gratis":"Pago en línea";
  if(codOption){codOption.hidden=!allowContraentrega;codOption.disabled=!allowContraentrega;}
  if(select&&!allowContraentrega)select.value="bold";
  const policy=form?.querySelector("[data-payment-policy]");
  const intro=form?.querySelector("[data-payment-intro]");
  if(allowContraentrega){
    if(intro)intro.textContent="Completa tus datos y elige la forma de pago disponible. Al pagar en línea, el envío es gratis. Si eliges contraentrega, el producto se paga al recibirlo y el envío se paga por anticipado a la transportadora.";
    if(policy)policy.textContent="Al pagar en línea, el envío es gratis. Con contraentrega pagas el producto al recibirlo y el envío, según tu destino, por anticipado a la transportadora.";
  }else{
    if(intro)intro.textContent="Completa tus datos y continúa al pago en línea. Este servicio es digital, así que no requiere envío físico ni permite contraentrega. Si tienes dudas, escríbenos antes de comprar.";
    if(policy)policy.textContent="Este es un servicio digital: se paga por anticipado en línea y no requiere envío físico. Si tienes preguntas, escríbenos por WhatsApp antes de comprar.";
  }
}
function openProductCheckout() {
  const variants=productColorVariants();
  if(variants.length&&!selectedColorVariant){showToast("Selecciona el color antes de comprar.");$("#productColorOptions")?.scrollIntoView({behavior:"smooth",block:"center"});return;}
  const sizes=productSizes();
  if(sizes.length&&(!selectedSize||!sizes.includes(selectedSize))){showToast("Selecciona la talla antes de comprar.");$("#productSizeOptions")?.scrollIntoView({behavior:"smooth",block:"center"});return;}
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
    if(!window.NovaShopBold?.prepare){showToast("El pago en línea no está disponible en este momento. Recarga la página e inténtalo de nuevo.");return;}
    if(formButton){formButton.disabled=true;formButton.textContent="Preparando pago…";}
    try{
      await window.NovaShopBold.prepare(form.dataset.boldOrderId,formButton,closeProductCheckout);
      window.NovaShopBold.setMessage(form,"Tu pedido ya está registrado. Pulsa «Continuar al pago» para completar el pago seguro.");
    }catch(error){
      if(formButton){formButton.type="submit";formButton.onclick=null;formButton.disabled=false;formButton.textContent="Reintentar pago en línea";}
      window.NovaShopBold.setMessage(form,(error?.message||"No pudimos preparar el pago.")+" Tu pedido está guardado; puedes reintentar sin crear otro pedido.");
      showToast(error?.message||"No pudimos preparar el pago en línea.");
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
  if(!useBold&&!useCOD){showToast("Elige una forma de pago para continuar.");return;}
  if(useCOD&&currentProduct.deliveryType!=="physical"){
    showToast("La contraentrega solo está disponible para productos físicos. Los servicios digitales se pagan por anticipado en línea.");return;
  }
  data.paymentMethod=useBold?"Pago en línea":"Contraentrega";
  const configuredVariants=productColorVariants();
  if(configuredVariants.length&&(!selectedColorVariant||!configuredVariants.some(v=>v.name===selectedColorVariant.name))){showToast("Selecciona un color para continuar.");$("#productColorOptions")?.scrollIntoView({behavior:"smooth",block:"center"});return;}
  const configuredSizes=productSizes();
  if(configuredSizes.length&&(!selectedSize||!configuredSizes.includes(selectedSize))){showToast("Selecciona una talla para continuar.");$("#productSizeOptions")?.scrollIntoView({behavior:"smooth",block:"center"});return;}
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
      if(!configured){showToast("El pago en línea todavía está en configuración. Inténtalo más tarde o consulta las formas de pago disponibles.");return;}
    }catch(error){showToast(error?.message||"No pudimos comprobar la configuración del pago en línea.");return;}
  }
  if(!window.NovaShopDB?.isConfigured?.()){
    showToast("El sistema de pedidos no está disponible en este momento. No se ha registrado ni cobrado tu pedido.");return;
  }
  let savedOrder=null;
  const button=form.querySelector('button[type="submit"]');
  if(button){button.disabled=true;button.textContent="Registrando pedido…";}
  try{
    savedOrder=await window.NovaShopDB.createOrder(data,[{product_id:Number(currentProduct.id),quantity:Number(quantity),selected_variant:selectedColorVariant?.name||null,selected_size:selectedSize||null}]);
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
    window.NovaShopBold.setMessage(form,"Pedido "+(savedOrder.order_number||"registrado")+". Pulsa «Continuar al pago» para pagar y recibir envío gratis.");
  }catch(error){
    if(button){button.type="submit";button.onclick=null;button.disabled=false;button.textContent="Reintentar pago en línea";}
    window.NovaShopBold?.setMessage(form,(error?.message||"No pudimos preparar el pago.")+" Tu pedido está guardado; al reintentar no se creará otro pedido.");
    showToast(error?.message||"No pudimos preparar el pago en línea.");
  }
}


function productSizes(){
 const raw=currentProduct?.sizeVariants??currentProduct?.size_variants;
 if(!Array.isArray(raw))return [];
 return [...new Set(raw.map(value=>String(value??"").trim()).filter(Boolean))].slice(0,20);
}
function renderProductSizeOptions(){
 const box=$("#productSizeOptions");if(!box)return;
 const sizes=productSizes();
 if(!sizes.length){box.hidden=true;box.innerHTML="";selectedSize=null;return;}
 if(selectedSize&&!sizes.includes(selectedSize))selectedSize=null;
 box.hidden=false;
 box.innerHTML='<div class="product-size-options-head"><strong>Elige tu talla</strong>'+(selectedSize?'<span aria-live="polite">Elegida: '+escProduct(selectedSize)+'</span>':'<span>Selecciona antes de comprar</span>')+'</div><div class="product-size-list">'+sizes.map((size,index)=>'<button type="button" class="product-size-choice" data-product-size="'+index+'" aria-pressed="'+(selectedSize===size?'true':'false')+'">'+escProduct(size)+'</button>').join("")+'</div><p class="product-size-help">Confirma la talla antes de añadir el producto al carrito.</p>';
 box.querySelectorAll("[data-product-size]").forEach(button=>button.addEventListener("click",()=>{
  const size=sizes[Number(button.dataset.productSize)];if(!size)return;
  selectedSize=size;renderProductSizeOptions();renderProductCheckoutSummary();
 }));
}
function productColorVariants(){
 if(!Array.isArray(currentProduct?.colorVariants))return [];
 return currentProduct.colorVariants.filter(v=>v&&typeof v.name==="string"&&v.name.trim()).map(v=>{
  const images=Array.isArray(v.images)?v.images.filter(Boolean):[v.front_image||v.frontImage,v.back_image||v.backImage].filter(Boolean);
  return {...v,images};
 });
}
function renderProductColorOptions(){
 const box=$("#productColorOptions");if(!box)return;
 const variants=productColorVariants();
 if(!variants.length){box.hidden=true;box.innerHTML="";selectedColorVariant=null;return;}
 if(selectedColorVariant&&!variants.some(v=>v.name===selectedColorVariant.name))selectedColorVariant=null;
 const safeHex=value=>/^#[0-9a-f]{6}$/i.test(String(value||""))?String(value):"#d1d5db";
 box.hidden=false;
 box.innerHTML='<div class="product-color-options-head"><strong>Colores disponibles</strong>'+(selectedColorVariant?'<span class="product-color-selected"><span aria-hidden="true">✓</span> Elegido: '+escProduct(selectedColorVariant.name)+'</span>':'<span class="product-color-help">Explora el producto y elige un color cuando quieras</span>')+'</div><div class="product-color-swatch-list">'+variants.map((variant,index)=>{
  const active=variant.name===selectedColorVariant?.name;
  return '<button type="button" class="product-color-swatch" data-color-variant="'+index+'" aria-pressed="'+(active?"true":"false")+'" aria-label="Ver color '+escProduct(variant.name)+'" title="'+escProduct(variant.name)+'">'+(variant.images?.[0]?'<img class="product-color-preview" src="'+escProduct(variant.images[0])+'" alt="" loading="lazy">':'<span class="product-color-dot" style="background:'+safeHex(variant.hex)+'"></span>')+'<span>'+escProduct(variant.name)+'</span>'+(active?'<span class="product-color-check" aria-hidden="true">✓</span>':'')+'</button>';
 }).join("")+'</div><p class="product-color-help">'+(selectedColorVariant?"El color elegido se añadirá al carrito.":"Debes elegir un color al momento de comprar.")+' Las imágenes cambian al seleccionar una opción.</p>';
 box.querySelectorAll("[data-color-variant]").forEach(button=>button.addEventListener("click",()=>{
  const variant=variants[Number(button.dataset.colorVariant)];if(!variant)return;
  selectedColorVariant=variant;
  renderProductColorOptions();renderProductMedia();renderProductCheckoutSummary();
 }));
}
function renderProductMedia(){
 const mainImage=$("#productMainImage"),mainVideo=$("#productMainVideo"),mediaFrame=$("#productMediaFrame"),thumbs=$("#productThumbnails");
 const variantImages=selectedColorVariant&&Array.isArray(selectedColorVariant.images)?selectedColorVariant.images.filter(Boolean):[];
 const galleryImages=variantImages.length?variantImages:(Array.isArray(currentProduct.images)?currentProduct.images.filter(Boolean):[]);
 const titlePrefix=selectedColorVariant?currentProduct.name+" · "+selectedColorVariant.name:currentProduct.name;
 const firstImage=galleryImages[0]||"images/streaming-placeholder.svg";
 currentGalleryImages=galleryImages.slice();currentGalleryTitle=titlePrefix;currentGalleryIndex=0;
 mainImage.tabIndex=0;mainImage.setAttribute("role","button");mainImage.setAttribute("aria-haspopup","dialog");mainImage.setAttribute("aria-label","Ampliar "+titlePrefix);
 mainImage.src=firstImage;mainImage.alt=titlePrefix+(selectedColorVariant?" · vista frontal":"");
 mainImage.hidden=!!currentProduct.videoUrl;
 mainVideo.onloadedmetadata=null;mainVideo.onerror=null;
 mainVideo.pause();mainVideo.hidden=!currentProduct.videoUrl;mainVideo.removeAttribute("src");mainVideo.removeAttribute("poster");
 mainVideo.controls=true;mainVideo.playsInline=true;mainVideo.preload="metadata";
 resetProductVideoFrame();
 mediaFrame?.classList.toggle("is-video",!!currentProduct.videoUrl);
 const videoStatus=$("#productVideoStatus");
 if(videoStatus){videoStatus.hidden=true;videoStatus.textContent="";}
 if(currentProduct.videoUrl){
  mainVideo.style.position="absolute";mainVideo.style.inset="0";mainVideo.style.width="100%";mainVideo.style.height="100%";mainVideo.style.maxHeight="none";mainVideo.style.objectFit="contain";
  mainVideo.onloadedmetadata=()=>{
   const hasPicture=fitProductVideoFrame();
   if(videoStatus){
    videoStatus.hidden=hasPicture;
    videoStatus.textContent=hasPicture?"":"El archivo no expone una imagen de video compatible. Expórtalo como MP4 H.264 con audio AAC y vuelve a subirlo.";
   }
  };
  mainVideo.onerror=()=>{
   if(videoStatus){videoStatus.hidden=false;videoStatus.textContent="No pudimos reproducir este archivo. Prueba exportarlo como MP4 H.264 con audio AAC y volver a subirlo.";}
  };
  mainVideo.src=String(currentProduct.videoUrl).trim();mainVideo.poster=firstImage;mainVideo.load();
  if(mainVideo.readyState>=1)fitProductVideoFrame();
 }else{
  mainVideo.style.position="";mainVideo.style.inset="";mainVideo.style.width="";mainVideo.style.height="";mainVideo.style.maxHeight="";mainVideo.style.objectFit="";
  mainVideo.load();
 }
 const imageButtons=galleryImages.map((image,index)=>{
  const label=selectedColorVariant?(index===0?"Vista frontal":index===1?"Vista trasera":"Imagen "+(index+1)):("Ver imagen "+(index+1));
  return '<button class="thumbnail" type="button" data-index="'+index+'" aria-label="'+escProduct(label+(selectedColorVariant?" del color "+selectedColorVariant.name:""))+'"><img src="'+escProduct(image)+'" alt="'+escProduct(titlePrefix+" · "+label)+'" loading="lazy">'+(selectedColorVariant?'<span class="product-thumbnail-label">'+(index===0?"FRENTE":index===1?"ESPALDA":"FOTO")+'</span>':"")+'</button>';
 }).join("");
 const videoButton=currentProduct.videoUrl?'<button class="thumbnail video-thumbnail active" type="button" data-video="true" aria-label="Ver video del producto"><span>▶</span><small>Video del producto</small></button>':"";
 thumbs.innerHTML=videoButton+imageButtons;
 if(!currentProduct.videoUrl)thumbs.querySelector(".thumbnail")?.classList.add("active");
 thumbs.querySelectorAll(".thumbnail").forEach(button=>button.addEventListener("click",()=>{
  thumbs.querySelectorAll(".thumbnail").forEach(item=>item.classList.remove("active"));button.classList.add("active");
  if(button.dataset.video==="true"){mainImage.hidden=true;mainVideo.hidden=false;mediaFrame?.classList.add("is-video");if(mainVideo.readyState>=1)fitProductVideoFrame();if(mainVideo.paused)mainVideo.play().catch(()=>{});}
  else{mainVideo.pause();mainVideo.hidden=true;mainImage.hidden=false;setProductGalleryImage(Number(button.dataset.index));}
 }));
}
function renderProduct() {
  document.title = `${currentProduct.name} — ${CONFIG.storeName}`;
  const seoDescription = String(currentProduct.description || `Compra ${currentProduct.name} en NovaShop Colombia.`)
    .replace(/\s+/g, " ").trim().slice(0, 155);
  const descriptionMeta = document.querySelector('meta[name="description"]');
  if (descriptionMeta) descriptionMeta.setAttribute("content", seoDescription);
  const productCanonical = new URL(`producto.html?id=${encodeURIComponent(currentProduct.id)}`, window.location.origin + "/").href;
  let canonicalMeta = document.querySelector('link[rel="canonical"]');
  if (!canonicalMeta) {
    canonicalMeta = document.createElement("link");
    canonicalMeta.rel = "canonical";
    document.head.appendChild(canonicalMeta);
  }
  canonicalMeta.href = productCanonical;
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
  const codPaymentInfo=$('#productCODPaymentInfo');
  const paymentMethods=Array.isArray(currentProduct.paymentMethods)&&currentProduct.paymentMethods.length
    ? currentProduct.paymentMethods
    : (isDigitalProduct?['bold']:['bold','cash_on_delivery']);
  const allowsCOD=!isDigitalProduct&&paymentMethods.includes('cash_on_delivery')&&!currentProduct.printfulEnabled;
  if(codPaymentInfo){
    codPaymentInfo.hidden=!allowsCOD;
    if(allowsCOD&&Number(currentProduct.price)>12000){
      codPaymentInfo.textContent='Si eliges contraentrega: paga $12.000 como anticipo de envío; se resta del total de la compra. Por una unidad, el saldo estimado al recibir es '+money(Number(currentProduct.price)-12000)+'. En pedidos con varias unidades, el anticipo se aplica una sola vez.';
    }else if(allowsCOD){
      codPaymentInfo.textContent='Para usar contraentrega, el total debe superar el anticipo de envío de $12.000.';
    }
  }
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
    : 'Al pagar en línea, el envío del producto físico es gratis. Si eliges contraentrega, el costo del envío depende de tu destino y se paga por anticipado a la transportadora.';
  $('#productTrust1').textContent=isDigitalProduct?'No requiere envío físico':'Envío gratis al pagar en línea';
  $('#productTrust2').textContent=isDigitalProduct?'Pago en línea':'Consulta contraentrega según tu destino';
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
  else if(selectedColorVariant&&!variants.some(v=>v.name===selectedColorVariant.name))selectedColorVariant=null;
  renderProductColorOptions();
  renderProductSizeOptions();
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

$('#productMainImage')?.addEventListener('click',openProductImageLightbox);
$('#productMainImage')?.addEventListener('keydown',event=>{
  if(event.key==="Enter"||event.key===" "){event.preventDefault();openProductImageLightbox();}
});
$('#productLightboxClose')?.addEventListener('click',closeProductImageLightbox);
$('#productLightboxPrev')?.addEventListener('click',()=>stepProductImageLightbox(-1));
$('#productLightboxNext')?.addEventListener('click',()=>stepProductImageLightbox(1));
$('#productImageLightbox')?.addEventListener('click',event=>{
  if(event.target.id==="productImageLightbox")closeProductImageLightbox();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape'){closeProductCheckout();closeProductImageLightbox();}
  if(!$("#productImageLightbox")?.hidden&&event.key==="ArrowRight"){event.preventDefault();stepProductImageLightbox(1);}
  if(!$("#productImageLightbox")?.hidden&&event.key==="ArrowLeft"){event.preventDefault();stepProductImageLightbox(-1);}
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') updateCartCount();
});

window.addEventListener("resize",fitProductVideoFrame,{passive:true});
renderProduct();
rememberAndRenderRecentlyViewed();
updateCartCount();
refreshProductFavorite();
loadProductReviews();
window.NovaShopDB?.syncCatalog?.(products).then(()=>{currentProduct=products.find(p=>p.id===productId)||currentProduct;renderProduct();rememberAndRenderRecentlyViewed();refreshProductFavorite();loadProductReviews();}).catch(err=>console.warn('Catálogo Supabase:',err));
