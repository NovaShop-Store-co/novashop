/* NovaShop account flow:
   - registration step 1: contact and password
   - registration step 2: delivery address and exact map pin
   - instant account activation; password support via WhatsApp
   - email or phone + password login
*/
(() => {
const $=s=>document.querySelector(s), db=window.NovaShopDB, client=db?.client;
const money=v=>new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:0}).format(Number(v)||0);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const msg=(txt,kind="info")=>{const n=$("#message");if(!n)return;n.textContent=txt;n.className="account-message "+kind;n.hidden=!txt;};
let mapState={},session=null,adminRouteUserId=null,adminRoutePromise=null,authActionInProgress=false;
async function routeAuthorizedAdmin(user){
 if(!user?.id||!db?.adminCall)return false;
 if(adminRouteUserId!==user.id){
  adminRouteUserId=user.id;
  adminRoutePromise=(async()=>{
   try{return await db.adminCall({action:"whoami"});}
   catch(_){return null;}
  })();
 }
 const who=await adminRoutePromise;
 if(who?.isAdmin!==true||!["owner","admin","catalog_manager","analyst"].includes(who.role))return false;
 const {data:{session:latest}}=await client.auth.getSession();
 if(latest?.user?.id!==user.id)return false;
 location.replace("admin.html");
 return true;
}
function e164(value){let n=String(value||"").replace(/[^0-9+]/g,"");if(n.startsWith("+"))return n;if(n.startsWith("00"))return "+"+n.slice(2);n=n.replace(/\D/g,"");if(n.startsWith("57")&&n.length>=12)return "+"+n;return "+57"+n;}
function setVisible(which){
 const register=["register","registerAddress"].includes(which);
 $("#authPanel").hidden=which==="dashboard";
 $("#registerForm").hidden=!register;
 $("#loginForm").hidden=which!=="login";
 $("#dashboard").hidden=which!=="dashboard";
 $("#registerContactStep").hidden=which!=="register";
 $("#registerAddressStep").hidden=which!=="registerAddress";
 $("#registerProgress1").classList.toggle("active",which==="register");
 $("#registerProgress1").classList.toggle("done",which==="registerAddress");
 $("#registerProgress2").classList.toggle("active",which==="registerAddress");
 document.querySelectorAll("[data-tab]").forEach(b=>b.classList.toggle("active",b.dataset.tab===(which==="login"?"login":"register")));
 if(which==="registerAddress")setTimeout(()=>mapState.registerMap?.map.invalidateSize(),140);
 if(which==="dashboard")setTimeout(()=>mapState.profileMap?.map.invalidateSize(),140);
}
function validateStep(root){
 const controls=[...root.querySelectorAll("input,select,textarea")].filter(el=>!el.disabled&&el.type!=="hidden");
 for(const el of controls){if(!el.checkValidity()){el.reportValidity();return false;}}
 return true;
}
function createMap(id,latName,lngName,statusId,coordsId,useButtonId){
 if(!window.L||!$("#"+id))return;
 const map=L.map(id,{scrollWheelZoom:false}).setView([4.5709,-74.2973],5);
 L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'}).addTo(map);
 let marker=null;
 function put(lat,lng,zoom=16,userInitiated=false){
  lat=Number(lat);lng=Number(lng);if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return;
  if(userInitiated){const mapForm=document.getElementById(id)?.closest("form");if(mapForm)mapForm.dataset.mapTouched="1";}
  $("#"+latName).value=lat.toFixed(7);$("#"+lngName).value=lng.toFixed(7);
  if(!marker)marker=L.marker([lat,lng],{draggable:true}).addTo(map);else marker.setLatLng([lat,lng]);
  marker.off("dragend").on("dragend",()=>{const p=marker.getLatLng();put(p.lat,p.lng,16,true);});
  map.setView([lat,lng],zoom);
  $("#"+statusId).textContent="Pin seleccionado. Arrástralo hasta la entrada correcta.";
  $("#"+coordsId).textContent=lat.toFixed(6)+", "+lng.toFixed(6);
  mapState[id]={map,put,marker:()=>marker};
 }
 map.on("click",e=>put(e.latlng.lat,e.latlng.lng,16,true));
 $("#"+useButtonId)?.addEventListener("click",()=>{
  if(!navigator.geolocation){msg("Tu navegador no permite obtener la ubicación. Puedes marcar el mapa manualmente.","error");return;}
  $("#"+statusId).textContent="Solicitando permiso de ubicación…";
  navigator.geolocation.getCurrentPosition(pos=>put(pos.coords.latitude,pos.coords.longitude,17,true),()=>{
   $("#"+statusId).textContent="No se obtuvo la ubicación; toca el mapa para colocar el pin.";
   msg("No pudimos obtener tu ubicación. Revisa los permisos o marca el mapa manualmente.","error");
  },{enableHighAccuracy:true,timeout:12000,maximumAge:0});
 });
 mapState[id]={map,put,marker:()=>marker};
 return mapState[id];
}
function formObj(form){
 const f=new FormData(form);
 return {
  firstName:String(f.get("firstName")||"").trim(),
  lastName:String(f.get("lastName")||"").trim(),
  phone:e164(f.get("phone")),
  email:String(f.get("email")||"").trim().toLowerCase(),
  address:String(f.get("address")||"").trim(),
  neighborhood:String(f.get("neighborhood")||"").trim(),
  city:String(f.get("city")||"").trim(),
  department:String(f.get("department")||"").trim(),
  postalCode:String(f.get("postalCode")||"").trim(),
  deliveryReference:String(f.get("deliveryReference")||"").trim(),
  latitude:String(f.get("latitude")||"").trim(),
  longitude:String(f.get("longitude")||"").trim(),
  marketingOptIn:f.get("marketingOptIn")==="on"
 };
}
function profilePayload(user,values){
 const data={id:user.id,full_name:values.fullName||[values.firstName,values.lastName].filter(Boolean).join(" "),
  phone:values.phone||"",email:String(values.email||user.email||"").trim().toLowerCase(),
  address:values.address||"",neighborhood:values.neighborhood||"",city:values.city||"",
  department:values.department||"",postal_code:values.postalCode||"",delivery_reference:values.deliveryReference||"",
  updated_at:new Date().toISOString()};
 // Do not erase map coordinates when the customer edits profile fields on a form without a map.
 if(Object.prototype.hasOwnProperty.call(values,"latitude"))data.latitude=values.latitude?Number(values.latitude):null;
 if(Object.prototype.hasOwnProperty.call(values,"longitude"))data.longitude=values.longitude?Number(values.longitude):null;
 if(Object.prototype.hasOwnProperty.call(values,"marketingOptIn"))data.marketing_opt_in=!!values.marketingOptIn;
 return data;
}
async function saveProfile(user,values){
 const {error}=await client.from("profiles").upsert(profilePayload(user,values),{onConflict:"id"});
 if(error)throw error;
}
async function updateCustomerMetadata(user,values){
 const previous=user?.user_metadata||{};
 const fullName=String(values.fullName||[values.firstName,values.lastName].filter(Boolean).join(" ")||previous.full_name||"").trim();
 const parts=fullName.split(/\s+/).filter(Boolean);
 const metadata={
  ...previous,
  full_name:fullName,
  first_name:values.firstName??previous.first_name??parts[0]??"",
  last_name:values.lastName??previous.last_name??parts.slice(1).join(" "),
  phone:values.phone??previous.phone??"",
  email:String(values.email||user?.email||previous.email||"").trim().toLowerCase(),
  address:values.address??previous.address??"",
  neighborhood:values.neighborhood??previous.neighborhood??"",
  city:values.city??previous.city??"",
  department:values.department??previous.department??"",
  postal_code:values.postalCode??previous.postal_code??"",
  delivery_reference:values.deliveryReference??previous.delivery_reference??""
 };
 if(Object.prototype.hasOwnProperty.call(values,"latitude"))metadata.latitude=values.latitude?Number(values.latitude):null;
 if(Object.prototype.hasOwnProperty.call(values,"longitude"))metadata.longitude=values.longitude?Number(values.longitude):null;
 if(Object.prototype.hasOwnProperty.call(values,"marketingOptIn"))metadata.marketing_opt_in=!!values.marketingOptIn;
 const {error}=await client.auth.updateUser({data:metadata});
 if(error)console.warn("No se pudo sincronizar la copia de respaldo del perfil:",error.message);
}
async function continueToAddress(){
 const step=$("#registerContactStep");
 if(!validateStep(step))return;
 const form=$("#registerForm"),pass=form.elements.password.value,confirm=form.elements.confirmPassword.value;
 if(pass.length<8){msg("La contraseña debe tener al menos 8 caracteres.","error");return;}
 if(pass!==confirm){msg("Las contraseñas no coinciden. Revísalas antes de continuar.","error");form.elements.confirmPassword.focus();return;}
 const phone=e164(form.elements.phone.value);
 if(!/^\+[1-9]\d{7,14}$/.test(phone)){msg("Escribe un teléfono válido con prefijo de país, por ejemplo +57 300 123 4567.","error");return;}
 if(!client||!db?.isConfigured?.()){msg("Supabase no está conectado. Inténtalo más tarde.","error");return;}
 $("#registerForm").dataset.passwordReady="true";
 msg("");
 setVisible("registerAddress");
}
async function submitSignup(event){
 event.preventDefault();
 if(!validateStep($("#registerAddressStep")))return;
 const form=$("#registerForm");
 const values=formObj(form);
 values.fullName=[values.firstName,values.lastName].filter(Boolean).join(" ");
 const password=form.elements.password.value;
 const button=$("#registerSubmit");
 button.disabled=true;button.textContent="Creando cuenta…";
 let createdUser=null;
 try{
  const metadata={
   full_name:values.fullName,first_name:values.firstName,last_name:values.lastName,
   phone:values.phone,email:values.email,address:values.address,neighborhood:values.neighborhood,
   city:values.city,department:values.department,postal_code:values.postalCode,
   delivery_reference:values.deliveryReference,
   latitude:values.latitude?Number(values.latitude):null,longitude:values.longitude?Number(values.longitude):null,
   marketing_opt_in:values.marketingOptIn
  };
  authActionInProgress=true;
  const result=await client.auth.signUp({email:values.email,password,options:{data:metadata}});
  if(result.error)throw result.error;
  if(!result.data?.user)throw new Error("Supabase no devolvió una cuenta. Inténtalo de nuevo.");
  let signedUser=result.data.user;
  let justCreated=true;
  // Supabase puede devolver una lista de identidades vacía si este correo ya se registró en una prueba anterior.
  // Intentar el inicio de sesión permite a la persona legítima terminar de guardar su perfil.
  if(Array.isArray(signedUser.identities)&&signedUser.identities.length===0){
   const existing=await client.auth.signInWithPassword({email:values.email,password});
   if(existing.error||!existing.data?.user){
    throw new Error("Este correo ya tiene una cuenta. Inicia sesión con su contraseña o contacta por WhatsApp si necesitas recuperar el acceso.");
   }
   signedUser=existing.data.user;
   justCreated=false;
  }else if(!result.data.session){
   const existing=await client.auth.signInWithPassword({email:values.email,password});
   if(existing.error||!existing.data?.user){
    throw new Error("La cuenta se registró, pero Supabase aún no permite iniciar sesión. Comprueba que «Confirm email» esté desactivado en Authentication.");
   }
   signedUser=existing.data.user;
  }
  createdUser=signedUser;
  // Guardar primero en la tabla del perfil; los metadatos sirven como respaldo para precargar perfil/checkout.
  await saveProfile(signedUser,values);
  await updateCustomerMetadata(signedUser,values);
  location.replace("index.html?registro="+(justCreated?"creado":"acceso"));
 }catch(e){
  const text=String(e?.message||"");
  if(createdUser){
   msg("La cuenta se inició correctamente, pero no pudimos guardar los datos de entrega: "+text,"error");
  }else{
   msg(/already registered|already been registered|user already/i.test(text)
    ?"Ese correo ya tiene una cuenta. Inicia sesión o contacta por WhatsApp para recuperar el acceso."
    :text||"No pudimos crear la cuenta. Inténtalo de nuevo.","error");
  }
 }finally{
  authActionInProgress=false;
  button.disabled=false;button.textContent="Crear mi cuenta y entrar";
 }
}

async function showDashboard(user){
 session={user};
 // Usuarios con rol administrativo van directo a la interfaz de gestión; no necesitan dirección de entrega.
 if(await routeAuthorizedAdmin(user))return;
 setVisible("dashboard");
 $("#welcome").textContent="Hola, "+(user.user_metadata?.full_name||user.email?.split("@")[0]||user.phone||"cliente");
 $("#userEmail").textContent=user.email||user.phone||"Cuenta verificada";
 const {data:profile,error}=await client.from("profiles").select("*").eq("id",user.id).maybeSingle();
 const form=$("#profileForm"),metadata=user.user_metadata||{};
 if(error)console.warn("No se pudo leer el perfil guardado:",error.message);
 const fields=[
  ["full_name","fullName",metadata.full_name],
  ["phone","phone",metadata.phone||user.phone],
  ["email","email",user.email||metadata.email],
  ["address","address",metadata.address],
  ["neighborhood","neighborhood",metadata.neighborhood],
  ["city","city",metadata.city],
  ["department","department",metadata.department],
  ["postal_code","postalCode",metadata.postal_code],
  ["delivery_reference","deliveryReference",metadata.delivery_reference]
 ];
 for(const [key,name,fallback] of fields){
  const el=form.elements[name];if(!el)continue;
  const saved=profile?.[key];
  el.value=String(saved!=null&&String(saved).trim()!==""?saved:(fallback??""));
 }
 const savedLatitude=profile?.latitude??metadata.latitude??"";
 const savedLongitude=profile?.longitude??metadata.longitude??"";
 form.elements.latitude.value=savedLatitude==null?"":String(savedLatitude);
 form.elements.longitude.value=savedLongitude==null?"":String(savedLongitude);
 form.dataset.mapTouched="0";
 form.dataset.savedAddressKey=deliveryAddressKey(formObj(form));
 if(savedLatitude!==""&&savedLongitude!==""&&Number.isFinite(Number(savedLatitude))&&Number.isFinite(Number(savedLongitude))){
  mapState.profileMap?.put(Number(savedLatitude),Number(savedLongitude),16,false);
  $("#profileMapStatus").textContent="Ubicación guardada. Puedes mover el pin para actualizarla.";
 }else{
  $("#profileMapStatus").textContent="Este perfil no tiene un pin guardado. Marca la nueva ubicación en el mapa.";
  $("#profileMapCoordinates").textContent="Sin pin seleccionado";
 }
 $("#userEmail").textContent=profile?.email||user.email||user.phone||metadata.email||"Cuenta verificada";
 await loadOrders();
 if(new URLSearchParams(location.search).get("registered")==="1")msg("¡Tu cuenta ya está verificada! Guarda tus datos y consulta aquí tus pedidos.","success");
}
async function loadOrders(){
 if(!client||!session?.user)return;
 $("#ordersList").innerHTML='<p class="account-help">Cargando pedidos…</p>';
 const {data,error}=await client.from("orders").select("id,order_number,status,payment_provider,subtotal_cop,discount_cop,total_cop,cash_on_delivery_due_cop,shipping_fee_cop,shipping_payment_status,coupon_code,shipping_carrier,tracking_number,estimated_delivery_date,shipped_at,delivered_at,created_at,order_items(product_name,quantity,unit_price_cop,line_total_cop,selected_variant,selected_size)").order("created_at",{ascending:false}).limit(50);
 if(error){$("#ordersList").innerHTML='<p class="account-help">No pudimos cargar el historial. Comprueba la conexión y las políticas RLS.</p>';return;}
 if(!data?.length){$("#ordersList").innerHTML='<div class="account-order"><strong>Aún no tienes pedidos vinculados</strong><p class="account-help">Cuando compres con tu sesión iniciada, el historial aparecerá aquí.</p><a href="index.html#productos">Explorar productos →</a></div>';return;}
 const labels={pending_payment:"Pendiente de pago",paid:"Pago confirmado",preparing:"En preparación",shipped:"Enviado",delivered:"Entregado",cancelled:"Cancelado",payment_failed:"Pago rechazado",refunded:"Reembolsado"};
 $("#ordersList").innerHTML=data.map(o=>{
  const items=(o.order_items||[]).map(i=>'<li>'+esc(i.product_name)+(i.selected_variant?' · Color: '+esc(i.selected_variant):"")+(i.selected_size?' · Talla: '+esc(i.selected_size):"")+' ×'+Number(i.quantity)+' — '+money(i.line_total_cop??i.unit_price_cop*i.quantity)+'</li>').join("");
  const subtotal=Number(o.subtotal_cop)||0,discount=Number(o.discount_cop)||0,total=Number(o.total_cop??(subtotal-discount));
  const fixedCODFreight=o.payment_provider==="cash_on_delivery"&&o.cash_on_delivery_due_cop!=null;
  const paymentSplit=fixedCODFreight?'<div class="account-order-shipping"><strong>Pago contraentrega</strong><div>Anticipo de envío por Bold: <strong>'+money(12000)+'</strong> · '+(o.shipping_payment_status==="approved"?'Confirmado':'Pendiente de pago')+'</div><div>Saldo por pagar al recibir: <strong>'+money(o.cash_on_delivery_due_cop)+'</strong></div></div>':"";
  const paymentAction=fixedCODFreight&&o.shipping_payment_status!=="approved"&&o.status==="pending_payment"
   ?'<div class="account-order-shipping"><a class="btn btn-primary" href="pedido.html?modo=contraentrega&pedido='+encodeURIComponent(o.order_number||"")+'&id='+encodeURIComponent(o.id)+'">Pagar anticipo de $12.000 con Bold</a></div>'
   :"";
  const shipping=o.tracking_number||o.shipping_carrier||o.estimated_delivery_date?'<div class="account-order-shipping"><strong>Seguimiento del envío</strong>'+(o.shipping_carrier?'<div>Transportadora: '+esc(o.shipping_carrier)+'</div>':'')+(o.tracking_number?'<div>Número de guía: <strong>'+esc(o.tracking_number)+'</strong></div>':'')+(o.estimated_delivery_date?'<div>Entrega estimada: '+esc(String(o.estimated_delivery_date).slice(0,10))+'</div>':'')+'</div>':"";
  return '<article class="account-order"><div class="account-order-head"><div><h3>'+esc(o.order_number)+'</h3><small>'+esc(new Date(o.created_at).toLocaleString("es-CO"))+'</small></div><span class="account-status">'+(labels[o.status]||"En revisión")+'</span></div><ul>'+items+'</ul>'+(o.coupon_code?'<p class="account-help">Cupón aplicado: <strong>'+esc(o.coupon_code)+'</strong></p>':"")+'<div class="account-order-total"><span>Subtotal</span><strong>'+money(subtotal)+'</strong></div>'+(discount>0?'<div class="account-order-total"><span>Descuento</span><strong>−'+money(discount)+'</strong></div>':"")+'<div class="account-order-total"><span>Total del pedido</span><strong>'+money(total)+'</strong></div>'+paymentSplit+paymentAction+shipping+'</article>';
 }).join("");
}
function deliveryAddressKey(values){
 return [values.address,values.neighborhood,values.city,values.department,values.postalCode]
  .map(value=>String(value||"").normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").trim().toLowerCase())
  .join("|");
}
async function saveProfileHandler(event){
 event.preventDefault();if(!session?.user)return;const f=event.currentTarget;if(!f.reportValidity())return;
 const values={fullName:f.elements.fullName.value.trim(),phone:e164(f.elements.phone.value),email:f.elements.email.value.trim().toLowerCase(),address:f.elements.address.value.trim(),neighborhood:f.elements.neighborhood.value.trim(),city:f.elements.city.value.trim(),department:f.elements.department.value.trim(),postalCode:f.elements.postalCode.value.trim(),deliveryReference:f.elements.deliveryReference.value.trim(),latitude:f.elements.latitude.value.trim(),longitude:f.elements.longitude.value.trim()};
 const savedAddressKey=f.dataset.savedAddressKey||deliveryAddressKey(values);
 const addressChanged=deliveryAddressKey(values)!==savedAddressKey;
 if(addressChanged&&f.dataset.mapTouched!=="1"){
  msg("Cambiaste la dirección. Para evitar conservar el pin de la casa anterior, marca el nuevo punto en el mapa o pulsa «Usar mi ubicación» antes de guardar.","error");
  $("#profileDeliveryMap")?.scrollIntoView({behavior:"smooth",block:"center"});
  return;
 }
 if((values.latitude&&!values.longitude)||(!values.latitude&&values.longitude)){
  msg("La ubicación no está completa. Selecciona el punto en el mapa y vuelve a guardar.","error");
  $("#profileDeliveryMap")?.scrollIntoView({behavior:"smooth",block:"center"});
  return;
 }
 try{
  await saveProfile(session.user,values);
  await updateCustomerMetadata(session.user,values);
  // Actualizar la sesión local para que los pedidos futuros usen los datos guardados.
  const {data}=await client.auth.getUser();if(data?.user)session={user:data.user};
  f.dataset.savedAddressKey=deliveryAddressKey(values);
  f.dataset.mapTouched="0";
  msg("Tus datos de entrega y la ubicación del mapa se guardaron correctamente. Se usarán en tus próximas compras.","success");
 }catch(e){msg("No pudimos guardar el perfil: "+e.message,"error");}
}
function init(){
 const params=new URLSearchParams(location.search);
 setVisible(params.get("tab")==="login"?"login":"register");
 if(params.get("registered")==="1")msg("Tu cuenta se creó correctamente.", "success");
 document.querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click",()=>{setVisible(b.dataset.tab);msg("");}));
 document.querySelectorAll("[data-password-toggle]").forEach(button=>button.addEventListener("click",()=>{
   const input=button.parentElement.querySelector("input");if(!input)return;
   const reveal=input.type==="password";input.type=reveal?"text":"password";
   button.textContent=reveal?"🙈":"👁";button.setAttribute("aria-label",reveal?"Ocultar contraseña":"Mostrar contraseña");
   button.setAttribute("aria-pressed",String(reveal));
 }));
 $("#registerNext").addEventListener("click",continueToAddress);
 $("#registerBack")?.addEventListener("click",()=>{setVisible("register");msg("");});
 $("#registerForm").addEventListener("submit",submitSignup);
 $("#loginForm").addEventListener("submit",async e=>{
  e.preventDefault();const f=e.currentTarget;if(!f.reportValidity())return;
  if(!db?.isConfigured?.()){msg("Supabase no está conectado.","error");return;}
  const btn=f.querySelector('[type="submit"]');btn.disabled=true;btn.textContent="Iniciando sesión…";
  try{
   authActionInProgress=true;
   await db.loginWithIdentifier(f.elements.identity.value.trim(),f.elements.password.value);
   f.reset();const {data}=await client.auth.getSession();
   if(data.session?.user){
    if(!await routeAuthorizedAdmin(data.session.user))location.replace("index.html");
   }else throw new Error("La sesión no se pudo iniciar. Inténtalo de nuevo.");
  }catch(err){msg(/invalid|incorrect|credentials|not found|contraseña/i.test(err?.message||"")?"Correo/teléfono o contraseña incorrectos.":err?.message||"No pudimos iniciar sesión.","error");}
  finally{authActionInProgress=false;btn.disabled=false;btn.textContent="Iniciar sesión";}
 });
 $("#profileForm").addEventListener("submit",saveProfileHandler);
 $("#refreshOrders").addEventListener("click",loadOrders);
 $("#signOut").addEventListener("click",async()=>{await client.auth.signOut();session=null;setVisible("login");msg("Has cerrado sesión.","success");});
 // El mapa se inicializa aquí y actualiza su tamaño cuando se muestra el paso de dirección.
 createMap("registerMap","registerLatitude","registerLongitude","registerMapStatus","registerMapCoordinates","useRegisterLocation");
 createMap("profileDeliveryMap","profileLatitude","profileLongitude","profileMapStatus","profileMapCoordinates","useProfileLocation");
 if(!client||!db?.isConfigured?.()){msg("Supabase no está conectado. Revisa la URL y la clave publicable.","error");return;}
 client.auth.onAuthStateChange((event,s)=>{
  if(s?.user){session={user:s.user};if(!authActionInProgress)showDashboard(s.user);}else{session=null;}
 });
 client.auth.getSession().then(({data})=>{if(data.session?.user)showDashboard(data.session.user);});
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
