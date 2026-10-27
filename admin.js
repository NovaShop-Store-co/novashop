/* Admin catalog UI. Every privileged action is checked again in the server Edge Function. */
(() => {
const $=s=>document.querySelector(s), db=window.NovaShopDB;
const money=n=>new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:0}).format(Number(n)||0);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let products=[], editingImages=[], editingVideo=null, pendingVideoPreviewUrl=null, editingColorVariants=[], metrics=null, currentRole=null, adminUsers=[], adminOrders=[], adminCoupons=[], adminReviews=[], ordersOffset=0, ordersHasMore=false, ordersLoading=false, ordersReloadQueued=false, ordersTotalCount=0, ordersPage=1, ordersPageSize=10, ordersSearchTimer=null, productEditorReturnFocus=null;
function status(text,kind="info"){const el=$("#adminStatus");el.textContent=text;el.className="admin-status "+kind;}
function setAdminSection(name){
 const nav=$("#adminSectionNav");
 const buttons=Array.from(nav?.querySelectorAll("[data-admin-tab]")||[]).filter(button=>!button.hidden);
 if(!buttons.length)return;
 if(!buttons.some(button=>button.dataset.adminTab===name))name=buttons[0].dataset.adminTab;
 document.querySelectorAll("[data-admin-section]").forEach(panel=>{
  panel.classList.toggle("admin-panel-active",panel.dataset.adminSection===name);
 });
 buttons.forEach(button=>{
  const active=button.dataset.adminTab===name;
  button.setAttribute("aria-current",active?"page":"false");
  button.classList.toggle("is-active",active);
 });
}
function syncPaymentMethodControls({resetPhysical=false}={}) {
 const form = $("#adminProductForm");
 if (!form) return;
 const digital = form.elements.delivery_type?.value === "digital";
 const printful = !!form.elements.printful_enabled?.checked;
 const requiresBold = digital || printful;
 const bold = form.querySelector('input[name="payment_methods"][value="bold"]');
 const cod = form.querySelector('input[name="payment_methods"][value="cash_on_delivery"]');
 if (cod) {
  cod.disabled = requiresBold;
  if (requiresBold) cod.checked = false;
  else if (resetPhysical) cod.checked = true;
  const label = cod.closest("label");
  if (label) label.style.opacity = requiresBold ? ".55" : "1";
 }
 if (bold && requiresBold) bold.checked = true;
 const help = $("#paymentMethodsHelp");
 if (help) help.textContent = digital
  ? "Los servicios digitales solo admiten pago anticipado con Bold. La contraentrega está desactivada."
  : printful
   ? "Los productos configurados para Printful requieren pago anticipado con Bold. La contraentrega está desactivada."
   : "Marca al menos una forma de pago. En productos físicos puedes habilitar una o ambas.";
}
function formData(){const f=$("#adminProductForm"),v=new FormData(f);return {id:v.get("id")?Number(v.get("id")):null,name:String(v.get("name")||"").trim(),category:String(v.get("category")||""),delivery_type:v.get("delivery_type"),price_cop:Number(v.get("price_cop")),old_price_cop:v.get("old_price_cop")?Number(v.get("old_price_cop")):null,stock_quantity:v.get("stock_quantity")===""?null:Number(v.get("stock_quantity")),description:String(v.get("description")||"").trim(),features:String(v.get("features")||"").split("\n").map(s=>s.trim()).filter(Boolean),images:editingImages.map(item=>item.url).filter(Boolean),video_url:editingVideo,tag:String(v.get("tag")||"").trim(),shipping:String(v.get("shipping")||"").trim(),payment_methods:v.getAll("payment_methods").map(value=>String(value)),is_active:!!f.elements.is_active.checked,printful_enabled:!!f.elements.printful_enabled.checked,printful_sync_variant_id:v.get("printful_sync_variant_id")===""?null:Number(v.get("printful_sync_variant_id")),sort_order:v.get("sort_order")?Number(v.get("sort_order")):(v.get("id")?Number(v.get("id")):100)};}
async function call(body){if(!db?.isConfigured?.())throw new Error("Supabase no está conectado.");return db.adminCall(body);}
async function upload(file){const signed=await call({action:"upload-url",filename:file.name,contentType:file.type,size:file.size});const {error}=await db.client.storage.from("products-media").uploadToSignedUrl(signed.path,signed.token,file,{contentType:file.type,upsert:false});if(error)throw error;return signed.publicUrl;}


function normalizeColorVariant(value={}){
 const images=Array.isArray(value.images)?value.images:[];
 return {name:String(value.name||"").slice(0,40),hex:/^#[0-9a-f]{6}$/i.test(String(value.hex||""))?String(value.hex):"#1f2937",printful_sync_variant_id:value.printful_sync_variant_id==null||value.printful_sync_variant_id===""?"":String(value.printful_sync_variant_id),frontImage:String(value.front_image||value.frontImage||images[0]||""),backImage:String(value.back_image||value.backImage||images[1]||""),frontFile:null,backFile:null,previewFrontUrl:null,previewBackUrl:null};
}
function disposeColorVariantPreviews(){
 editingColorVariants.forEach(variant=>["previewFrontUrl","previewBackUrl"].forEach(key=>{if(variant[key]){URL.revokeObjectURL(variant[key]);variant[key]=null;}}));
}
function renderColorVariants(){
 const box=$("#adminColorVariantsList");if(!box)return;
 disposeColorVariantPreviews();
 if(!editingColorVariants.length){box.innerHTML='<p class="admin-help">Todavía no has añadido variantes de color. Si el producto solo tiene una versión, puedes dejarlo vacío.</p>';return;}
 const photo=(variant,index,side,label)=>{
  const file=variant[side+"File"],imageUrl=variant[side==="front"?"frontImage":"backImage"];
  let src=imageUrl;
  if(file){const key=side==="front"?"previewFrontUrl":"previewBackUrl";variant[key]=URL.createObjectURL(file);src=variant[key];}
  const image=src?'<img data-variant-preview="'+side+'" src="'+esc(src)+'" alt="'+esc(variant.name||"Color "+(index+1))+' · '+label+'">':'<div class="admin-color-photo-empty" data-variant-empty="'+side+'">Sin foto de '+label.toLowerCase()+'</div>';
  const fileHelp=file?esc(file.name)+" · "+(file.size/1024/1024).toFixed(1)+" MB":(imageUrl?"La foto actual se conserva si no la reemplazas.":"Selecciona una foto para esta vista.");
  return '<div class="admin-color-variant-photo" data-photo-panel="'+side+'">'+image+'<label>'+label+' *<input type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" data-variant-file="'+side+'"><small data-variant-file-help>'+fileHelp+'</small></label></div>';
 };
 box.innerHTML=editingColorVariants.map((variant,index)=>'<article class="admin-color-variant-row" data-color-variant-index="'+index+'">'+
  '<div class="admin-color-variant-top"><div class="admin-color-variant-summary"><span class="admin-color-variant-swatch" style="background:'+esc(variant.hex)+'"></span><strong>Variante de color '+(index+1)+'</strong></div><button type="button" data-remove-color-variant="'+index+'">Eliminar color</button></div>'+
  '<div class="admin-color-variant-fields"><label>Nombre del color *<input type="text" data-variant-field="name" maxlength="40" value="'+esc(variant.name)+'" placeholder="Ej. Negro, Blanco, Azul marino" required></label><label>Muestra de color<input type="color" data-variant-field="hex" value="'+esc(variant.hex)+'" aria-label="Muestra de color '+(index+1)+'"></label><label class="admin-color-printful-field">Printful Sync Variant ID (opcional)<input type="number" min="1" step="1" data-variant-field="printful_sync_variant_id" value="'+esc(variant.printful_sync_variant_id)+'" placeholder="ID de este color"><small>Si activas envío automático a Printful, vincula el color y talla exactos.</small></label></div>'+
  '<div class="admin-color-variant-photos">'+photo(variant,index,"front","Foto frontal")+photo(variant,index,"back","Foto trasera")+'</div>'+
  '<p class="admin-help">Las dos fotos se mostrarán al comprador cuando seleccione este color. Se recomienda usar el mismo fondo, encuadre y tamaño de imagen.</p>'+
 '</article>').join("");
 box.querySelectorAll("[data-remove-color-variant]").forEach(button=>button.addEventListener("click",()=>{
  const index=Number(button.dataset.removeColorVariant);
  if(!Number.isInteger(index)||index<0||index>=editingColorVariants.length)return;
  if(!confirm("¿Eliminar esta variante de color del producto?"))return;
  const removed=editingColorVariants[index];if(removed){if(removed.previewFrontUrl)URL.revokeObjectURL(removed.previewFrontUrl);if(removed.previewBackUrl)URL.revokeObjectURL(removed.previewBackUrl);}
  editingColorVariants.splice(index,1);
  const form=$("#adminProductForm");if(form)form.dataset.dirty="1";
  renderColorVariants();
 }));
 box.querySelectorAll("[data-variant-field]").forEach(input=>input.addEventListener("input",()=>{
  const row=input.closest("[data-color-variant-index]"),index=Number(row?.dataset.colorVariantIndex),variant=editingColorVariants[index];
  if(!variant)return;
  if(input.dataset.variantField==="name")variant.name=input.value;
  if(input.dataset.variantField==="hex"){variant.hex=input.value;const swatch=row.querySelector(".admin-color-variant-swatch");if(swatch)swatch.style.background=input.value;}
  if(input.dataset.variantField==="printful_sync_variant_id")variant.printful_sync_variant_id=input.value.trim();
  const form=$("#adminProductForm");if(form?.elements.id.value)form.dataset.dirty="1";
 }));
 box.querySelectorAll("[data-variant-file]").forEach(input=>input.addEventListener("change",()=>{
  const row=input.closest("[data-color-variant-index]"),index=Number(row?.dataset.colorVariantIndex),variant=editingColorVariants[index],side=input.dataset.variantFile;
  if(!variant)return;const file=input.files?.[0]||null;if(!file)return;
  const allowed=["image/jpeg","image/png","image/webp","image/avif","image/gif"];
  if(!allowed.includes(file.type)){status("La imagen de color debe ser JPG, PNG, WEBP, AVIF o GIF.","error");input.value="";return;}
  if(file.size>12*1024*1024){status("Cada imagen de color debe pesar máximo 12 MB.","error");input.value="";return;}
  const previewKey=side==="front"?"previewFrontUrl":"previewBackUrl";if(variant[previewKey])URL.revokeObjectURL(variant[previewKey]);
  variant[side+"File"]=file;variant[previewKey]=URL.createObjectURL(file);
  const panel=row.querySelector('[data-photo-panel="'+side+'"]'),prior=panel.querySelector("[data-variant-preview], [data-variant-empty]");
  const image=document.createElement("img");image.dataset.variantPreview=side;image.src=variant[previewKey];image.alt=(variant.name||"Variante")+" · "+side;
  if(prior)prior.replaceWith(image);else panel.insertBefore(image,panel.querySelector("label"));
  const help=panel.querySelector("[data-variant-file-help]");if(help)help.textContent=file.name+" · "+(file.size/1024/1024).toFixed(1)+" MB";
  const form=$("#adminProductForm");if(form)form.dataset.dirty="1";
 }));
}

function roleLabel(role){return ({owner:"Propietario",admin:"Administrador",catalog_manager:"Gestor de catálogo",analyst:"Analista",customer:"Cliente"})[role]||role||"Cliente";}
function userStatus(text,kind="info"){const el=$("#adminUsersStatus");if(el){el.textContent=text;el.className="admin-status "+kind;}}
async function loadAdminUsers(){
 if(!["owner","admin"].includes(currentRole))return;
 const refresh=$("#refreshAdminUsers");
 if(refresh){refresh.disabled=true;refresh.textContent="Actualizando…";}
 try{
  const result=await call({action:"list-users"});adminUsers=result.users||[];renderAdminUsers();
  userStatus("Lista sincronizada directamente con Supabase Authentication. "+adminUsers.length+" cuenta(s) activa(s).","success");
 }catch(e){userStatus(e.message||"No pudimos cargar los usuarios.","error");}
 finally{if(refresh){refresh.disabled=false;refresh.textContent="Actualizar usuarios";}}
}
function renderAdminUsers(){
 const box=$("#adminUsersList");if(!box)return;
 const normalize=value=>String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
 const query=normalize($("#adminUserSearch")?.value||"");
 const roleFilter=$("#adminUserRoleFilter")?.value||"all";
 const filtered=adminUsers.filter(u=>{
  if(roleFilter!=="all"&&u.role!==roleFilter)return false;
  if(!query)return true;
  return normalize([u.full_name,u.username,u.email,u.phone,u.address,u.delivery_reference,u.neighborhood,u.city,u.department].join(" ")).includes(query);
 });
 const count=$("#adminUsersCount");
 if(count)count.textContent=filtered.length===adminUsers.length?String(adminUsers.length):filtered.length+" / "+adminUsers.length;
 const customers=adminUsers.filter(u=>u.role==="customer").length;
 const staff=adminUsers.filter(u=>["admin","catalog_manager","analyst"].includes(u.role)).length;
 const stats=$("#adminUsersStats");
 if(stats)stats.innerHTML='<span><strong>'+adminUsers.length+'</strong> cuentas</span><span><strong>'+customers+'</strong> clientes</span><span><strong>'+staff+'</strong> equipo</span>';
 if(!filtered.length){
  box.innerHTML='<div class="admin-users-empty"><span>⌕</span><strong>'+(adminUsers.length?'No encontramos coincidencias':'Todavía no hay usuarios registrados')+'</strong><p>'+(adminUsers.length?'Prueba otro nombre, correo, teléfono o rol.':'Invita al primer usuario desde el formulario.')+'</p></div>';
  return;
 }
 box.innerHTML=filtered.map(u=>{
  const id=esc(u.id);
  const options=[["customer","Cliente"],["catalog_manager","Gestor de catálogo"],["analyst","Analista"],["admin","Administrador"]];
  const editableRole=u.role!=="owner"&&(currentRole==="owner"||u.role!=="admin");
  const safeOptions=options.filter(([value])=>value!=="admin"||currentRole==="owner"||u.role==="admin");
  const select=safeOptions.map(([value,label])=>'<option value="'+value+'" '+(u.role===value?'selected':'')+'>'+label+'</option>').join("");
  const isOwner=u.role==="owner";
  const canEdit=!isOwner&&(currentRole==="owner"||u.role!=="admin");
  const canDelete=currentRole==="owner"&&!isOwner;
  const address=[u.address,u.neighborhood,u.city,u.department,u.postal_code].filter(Boolean).join(", ");
  const hasMapPin=u.latitude!==null&&u.latitude!==undefined&&u.longitude!==null&&u.longitude!==undefined&&Number.isFinite(Number(u.latitude))&&Number.isFinite(Number(u.longitude));
  const customerMapUrl=hasMapPin?'https://www.google.com/maps?q='+Number(u.latitude)+','+Number(u.longitude):(address?'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(address):"");
  const customerMapLink=customerMapUrl?'<div class="admin-user-mapline"><span class="admin-user-map-icon" aria-hidden="true">⌖</span><div><a href="'+esc(customerMapUrl)+'" target="_blank" rel="noopener noreferrer">'+(hasMapPin?'Abrir ubicación exacta en Google Maps ↗':'Buscar dirección en Google Maps ↗')+'</a><small>'+(hasMapPin?'Pin guardado por el cliente':'No hay pin guardado; se muestra una búsqueda por dirección')+'</small>'+(hasMapPin?'<small>Coordenadas: '+Number(u.latitude).toFixed(6)+', '+Number(u.longitude).toFixed(6)+'</small>':"")+'</div></div>':"";
  const deliveryReference=String(u.delivery_reference||"").trim();
  const reset=currentRole==="owner"&&!isOwner
   ? '<div class="admin-password-reset"><button type="button" class="admin-password-toggle" data-password-panel-toggle="'+id+'">Establecer contraseña temporal</button><form class="admin-password-form" data-password-reset-form="'+id+'" hidden><p class="admin-help">Para '+esc(u.email||u.full_name||"este usuario")+'. Solo el propietario puede realizar este cambio.</p><label>Contraseña temporal<input name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password" placeholder="Mínimo 12 caracteres"></label><label>Confirmar contraseña<input name="confirmPassword" type="password" required minlength="12" maxlength="128" autocomplete="new-password" placeholder="Escríbela otra vez"></label><div class="admin-password-actions"><button type="button" data-password-generate="'+id+'">Generar segura</button><button type="button" data-password-reveal="'+id+'">Mostrar</button><button type="submit">Guardar contraseña</button></div><p class="admin-help">Comparte una contraseña temporal únicamente por un canal privado.</p></form></div>'
   : "";
  const edit=canEdit
   ? '<details class="admin-user-edit"><summary>Editar datos del usuario</summary><form class="admin-user-edit-form" data-user-edit-form="'+id+'"><div class="admin-user-edit-grid"><label>Nombre completo *<input name="full_name" required maxlength="100" value="'+esc(u.full_name||"")+'"></label><label>Correo de acceso *<input name="email" type="email" required maxlength="120" value="'+esc(u.email||"")+'" '+(currentRole!=="owner"?'readonly aria-readonly="true" title="Solo el propietario puede cambiar el correo"':'')+'></label><label>Nombre de usuario<input name="username" maxlength="60" pattern="[A-Za-z0-9._-]{3,60}" value="'+esc(u.username||"")+'" placeholder="usuario"></label><label>Teléfono<input name="phone" maxlength="30" value="'+esc(u.phone||"")+'" placeholder="+57…"></label><label class="wide">Dirección<input name="address" maxlength="250" value="'+esc(u.address||"")+'"></label><label class="wide">Indicaciones para la entrega<input name="delivery_reference" maxlength="220" value="'+esc(u.delivery_reference||"")+'"></label><label>Barrio<input name="neighborhood" maxlength="120" value="'+esc(u.neighborhood||"")+'"></label><label>Ciudad<input name="city" maxlength="100" value="'+esc(u.city||"")+'"></label><label>Departamento<input name="department" maxlength="100" value="'+esc(u.department||"")+'"></label><label>Código postal<input name="postal_code" maxlength="20" value="'+esc(u.postal_code||"")+'"></label></div><p class="admin-help">'+(currentRole==="owner"?'Los cambios de correo se aplican a la cuenta de acceso y al perfil.':'El correo de acceso solo lo puede modificar el propietario.')+'</p><button type="submit" class="admin-user-save-profile">Guardar datos del usuario</button></form></details>'
   : (isOwner?'':'<p class="admin-help admin-owner-lock">Solo el propietario puede editar una cuenta de administrador.</p>');
  const deleteButton=canDelete
   ? '<button type="button" class="admin-user-delete" data-user-delete="'+id+'"><span aria-hidden="true">×</span> Eliminar cuenta</button>'
   : "";
  return '<article class="admin-user '+(isOwner?'admin-user-protected':'')+'" data-user-row="'+id+'"><div class="admin-user-top"><div><div class="admin-user-name">'+esc(u.full_name||u.username||"Usuario")+'</div><div class="admin-user-email">'+esc(u.email||u.phone||"Sin correo")+'</div></div><span class="admin-pill '+(u.role==="customer"?"off":"")+'">'+esc(roleLabel(u.role))+'</span></div><div class="admin-user-meta"><span class="admin-user-state '+(u.email_confirmed?'is-confirmed':'')+'"><i></i>'+(u.email_confirmed?"Correo confirmado":"Correo pendiente")+'</span><span>Alta: '+esc(new Date(u.created_at).toLocaleDateString("es-CO"))+'</span>'+(u.last_sign_in_at?'<span>Último acceso: '+esc(new Date(u.last_sign_in_at).toLocaleDateString("es-CO"))+'</span>':'')+'</div>'+(address?'<div class="admin-user-address"><span aria-hidden="true">⌖</span><span>'+esc(address)+'</span></div>':'<div class="admin-user-meta">Dirección aún no guardada</div>')+customerMapLink+(deliveryReference?'<div class="admin-user-delivery-reference"><strong>Indicaciones para la entrega</strong><p>'+esc(deliveryReference)+'</p></div>':'<div class="admin-user-delivery-reference is-empty">El cliente no ha añadido indicaciones adicionales.</div>')+'<div class="admin-user-stats"><span>Pedidos <strong>'+Number(u.order_count||0)+'</strong></span><span>Pagados <strong>'+Number(u.paid_orders||0)+'</strong></span><span>Compras confirmadas <strong>'+money(u.lifetime_spend_cop||0)+'</strong></span></div><div class="admin-user-controls"><label>Asignar rol<select data-role-select="'+id+'" '+(!editableRole?"disabled":"")+'>'+select+'</select></label><button type="button" data-role-save="'+id+'" '+(!editableRole?"disabled":"")+'>'+((u.role==="owner"||!editableRole)?"Rol protegido":"Guardar rol")+'</button></div>'+edit+reset+(deleteButton?'<div class="admin-user-danger-zone"><span>Esta acción elimina la cuenta de acceso en Supabase.</span>'+deleteButton+'</div>':isOwner?'<p class="admin-help admin-owner-lock">La cuenta propietaria está protegida.</p>':'')+'</article>';
 }).join("");
 box.querySelectorAll("[data-role-save]").forEach(button=>button.addEventListener("click",()=>saveUserRole(button.dataset.roleSave)));
 box.querySelectorAll("[data-user-edit-form]").forEach(form=>form.addEventListener("submit",event=>saveAdminUserProfile(event,form)));
 box.querySelectorAll("[data-user-delete]").forEach(button=>button.addEventListener("click",()=>deleteAdminUser(button.dataset.userDelete)));
 box.querySelectorAll("[data-password-panel-toggle]").forEach(button=>button.addEventListener("click",()=>{
  const form=box.querySelector('[data-password-reset-form="'+CSS.escape(button.dataset.passwordPanelToggle)+'"]');
  if(!form)return;form.hidden=!form.hidden;
  button.textContent=form.hidden?"Establecer contraseña temporal":"Cerrar formulario";
  if(!form.hidden)form.querySelector('input[name="password"]').focus();
 }));
 box.querySelectorAll("[data-password-generate]").forEach(button=>button.addEventListener("click",()=>{
  const form=box.querySelector('[data-password-reset-form="'+CSS.escape(button.dataset.passwordGenerate)+'"]');
  if(!form)return;
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_";
  const random=new Uint32Array(20);crypto.getRandomValues(random);
  const value=Array.from(random,n=>chars[n%chars.length]).join("");
  form.elements.password.value=value;form.elements.confirmPassword.value=value;
  form.elements.password.type="text";form.elements.confirmPassword.type="text";
 }));
 box.querySelectorAll("[data-password-reveal]").forEach(button=>button.addEventListener("click",()=>{
  const form=box.querySelector('[data-password-reset-form="'+CSS.escape(button.dataset.passwordReveal)+'"]');
  if(!form)return;
  const show=form.elements.password.type==="password";
  form.elements.password.type=show?"text":"password";form.elements.confirmPassword.type=show?"text":"password";
  button.textContent=show?"Ocultar":"Mostrar";
 }));
 box.querySelectorAll("[data-password-reset-form]").forEach(form=>form.addEventListener("submit",event=>setUserPassword(event,form)));
}
let lastAdminUsersFocusSync=0;
function syncAdminUsersWhenFocused(){
 if(!["owner","admin"].includes(currentRole)||document.visibilityState!=="visible")return;
 const now=Date.now();if(now-lastAdminUsersFocusSync<5000)return;lastAdminUsersFocusSync=now;loadAdminUsers();
}
async function saveAdminUserProfile(event,form){
 event.preventDefault();if(!form.reportValidity())return;
 const userId=form.dataset.userEditForm;
 const button=form.querySelector('[type="submit"]');
 const data=new FormData(form);
 const payload={action:"update-user",user_id:userId,
  full_name:String(data.get("full_name")||"").trim(),email:String(data.get("email")||"").trim().toLowerCase(),
  username:String(data.get("username")||"").trim(),phone:String(data.get("phone")||"").trim(),
  address:String(data.get("address")||"").trim(),delivery_reference:String(data.get("delivery_reference")||"").trim(),neighborhood:String(data.get("neighborhood")||"").trim(),
  city:String(data.get("city")||"").trim(),department:String(data.get("department")||"").trim(),
  postal_code:String(data.get("postal_code")||"").trim()};
 button.disabled=true;button.textContent="Guardando…";
 try{const result=await call(payload);await loadAdminUsers();userStatus(result.message||"Datos del usuario actualizados.","success");}
 catch(error){userStatus(error.message||"No se pudieron guardar los datos del usuario.","error");}
 finally{button.disabled=false;button.textContent="Guardar datos del usuario";}
}
async function deleteAdminUser(userId){
 if(currentRole!=="owner"){userStatus("Solo el propietario puede eliminar cuentas.","error");return;}
 const target=adminUsers.find(u=>u.id===userId);if(!target||target.role==="owner")return;
 const label=target.email||target.full_name||"este usuario";
 const confirmed=confirm("Vas a eliminar definitivamente la cuenta de "+label+" en Supabase Authentication. Se borrarán su perfil, rol, favoritos y reseñas. Los pedidos históricos se conservarán y quedarán desvinculados de la cuenta; pueden mantener datos necesarios para respaldar las compras. Esta acción no se puede deshacer. ¿Deseas continuar?");
 if(!confirmed)return;
 const button=$('[data-user-delete="'+CSS.escape(userId)+'"]');
 if(button){button.disabled=true;button.textContent="Eliminando…";}
 try{const result=await call({action:"delete-user",user_id:userId});await loadAdminUsers();userStatus(result.message||"Cuenta eliminada correctamente.","success");}
 catch(error){userStatus(error.message||"No se pudo eliminar la cuenta.","error");if(button){button.disabled=false;button.innerHTML='<span aria-hidden="true">×</span> Eliminar cuenta';}}
}

async function setUserPassword(event,form){
 event.preventDefault();
 if(currentRole!=="owner"){userStatus("Solo el propietario puede cambiar contraseñas desde el panel.","error");return;}
 if(!form.reportValidity())return;
 const userId=form.dataset.passwordResetForm;
 const password=String(form.elements.password.value||""),confirmation=String(form.elements.confirmPassword.value||"");
 if(password.length<12){userStatus("La contraseña debe tener al menos 12 caracteres.","error");return;}
 if(password!==confirmation){userStatus("Las contraseñas no coinciden.","error");return;}
 const button=form.querySelector('[type="submit"]');button.disabled=true;button.textContent="Guardando…";
 try{
  await call({action:"set-user-password",user_id:userId,password});
  form.elements.password.type="text";form.elements.confirmPassword.type="text";
  button.textContent="Contraseña guardada";
  const target=adminUsers.find(u=>u.id===userId);
  userStatus("Contraseña temporal actualizada para "+(target?.email||target?.full_name||"el usuario")+". Copia la clave y compártela solo por un chat privado.","success");
 }catch(error){userStatus(error.message||"No se pudo cambiar la contraseña. Inténtalo otra vez.","error");button.textContent="Guardar contraseña";}
 finally{button.disabled=false;}
}
async function saveUserRole(userId){
 const select=$('[data-role-select="'+CSS.escape(userId)+'"]');if(!select)return;
 const button=$('[data-role-save="'+CSS.escape(userId)+'"]');if(button){button.disabled=true;button.textContent="Guardando…";}
 try{await call({action:"set-role",user_id:userId,role:select.value});await loadAdminUsers();userStatus("Rol actualizado correctamente.","success");}
 catch(e){userStatus(e.message||"No se pudo cambiar el rol.","error");}
 finally{if(button){button.disabled=false;button.textContent="Guardar rol";}}
}
async function inviteUser(event){
 event.preventDefault();const form=event.currentTarget;if(!form.reportValidity())return;
 const button=form.querySelector('[type="submit"]');button.disabled=true;button.textContent="Enviando invitación…";
 try{
  const data=new FormData(form);
  const result=await call({action:"invite-user",full_name:String(data.get("full_name")||"").trim(),email:String(data.get("email")||"").trim().toLowerCase(),role:String(data.get("role")||"customer")});
  userStatus("Invitación creada para "+result.user.email+". Si no llega, revisa la configuración de correo de Supabase.","success");
  form.reset();await loadAdminUsers();
 }catch(e){userStatus(e.message||"No pudimos invitar al usuario.","error");}
 finally{button.disabled=false;button.textContent="Enviar invitación por correo";}
}

function couponNotice(message,kind="info"){const el=$("#adminCouponsStatus");if(el){el.textContent=message;el.className="admin-status "+kind;}}
function reviewNotice(message,kind="info"){const el=$("#adminReviewsStatus");if(el){el.textContent=message;el.className="admin-status "+kind;}}
function toLocalInputDate(value){if(!value)return "";const d=new Date(value);if(Number.isNaN(d.getTime()))return "";return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
function loadAdminCoupons(){
 if(!["owner","admin"].includes(currentRole))return;
 call({action:"list-coupons"}).then(result=>{adminCoupons=result.coupons||[];renderAdminCoupons();couponNotice("Cupones cargados. Los descuentos se validan en el servidor al comprar.","success");}).catch(e=>couponNotice(e.message||"No pudimos cargar los cupones.","error"));
}
function renderAdminCoupons(){
 const box=$("#adminCouponsList");if(!box)return;
 if(!adminCoupons.length){box.innerHTML='<div class="admin-orders-empty">Todavía no hay cupones. Crea el primero desde el formulario.</div>';return;}
 box.innerHTML=adminCoupons.map(c=>{
  const discount=c.discount_type==="percent"?Number(c.discount_value)+"%":money(c.discount_value);
  const usage=c.max_uses==null?Number(c.uses_count||0)+" usos · sin límite":Number(c.uses_count||0)+" / "+Number(c.max_uses)+" usos";
  const expiry=c.ends_at?"Vence: "+new Date(c.ends_at).toLocaleString("es-CO",{dateStyle:"medium",timeStyle:"short"}):"Sin vencimiento";
  return '<article class="admin-coupon-row"><div class="admin-coupon-top"><div><div class="admin-coupon-code">'+esc(c.code)+'</div><div class="admin-coupon-info">'+esc(c.description||"Sin descripción")+'<br>'+esc(discount)+' de descuento · Compra mínima '+money(c.minimum_subtotal_cop||0)+'<br>'+esc(usage)+' · '+esc(expiry)+'</div></div><span class="admin-pill '+(c.is_active?"":"off")+'">'+(c.is_active?"Activo":"Pausado")+'</span></div><div class="admin-coupon-actions"><button type="button" data-coupon-edit="'+esc(c.id)+'">Editar</button><button type="button" data-coupon-toggle="'+esc(c.id)+'">'+(c.is_active?"Pausar":"Activar")+'</button></div></article>';
 }).join("");
 box.querySelectorAll("[data-coupon-edit]").forEach(button=>button.addEventListener("click",()=>editAdminCoupon(button.dataset.couponEdit)));
 box.querySelectorAll("[data-coupon-toggle]").forEach(button=>button.addEventListener("click",()=>toggleAdminCoupon(button.dataset.couponToggle)));
}
function editAdminCoupon(id){
 const c=adminCoupons.find(x=>x.id===id),f=$("#adminCouponForm");if(!c||!f)return;
 f.elements.id.value=c.id;f.elements.code.value=c.code;f.elements.description.value=c.description||"";
 f.elements.discount_type.value=c.discount_type;f.elements.discount_value.value=c.discount_value;
 f.elements.minimum_subtotal_cop.value=c.minimum_subtotal_cop||0;f.elements.max_uses.value=c.max_uses??"";
 f.elements.starts_at.value=toLocalInputDate(c.starts_at);f.elements.ends_at.value=toLocalInputDate(c.ends_at);
 f.elements.is_active.checked=!!c.is_active;f.scrollIntoView({behavior:"smooth",block:"center"});
 couponNotice("Editando el cupón "+c.code+".","info");
}
async function saveAdminCoupon(event){
 event.preventDefault();const f=event.currentTarget;if(!f.reportValidity())return;
 const v=new FormData(f),button=f.querySelector('[type="submit"]');
 const starts=v.get("starts_at")?new Date(v.get("starts_at")).toISOString():new Date().toISOString();
 let ends=null;try{ends=v.get("ends_at")?new Date(v.get("ends_at")).toISOString():null;}catch(_){ends=null;}
 if(v.get("ends_at")&&!ends){couponNotice("La fecha de vencimiento no es válida.","error");return;}
 const payload={action:"save-coupon",id:v.get("id")||null,code:String(v.get("code")||"").trim().toUpperCase(),description:String(v.get("description")||"").trim(),discount_type:v.get("discount_type"),discount_value:Number(v.get("discount_value")),minimum_subtotal_cop:Number(v.get("minimum_subtotal_cop")||0),max_uses:v.get("max_uses")===""?null:Number(v.get("max_uses")),starts_at:starts,ends_at:ends,is_active:f.elements.is_active.checked};
 button.disabled=true;button.textContent="Guardando…";
 try{const result=await call(payload);couponNotice("Cupón "+result.coupon.code+" guardado correctamente.","success");f.reset();f.elements.id.value="";f.elements.minimum_subtotal_cop.value="0";f.elements.is_active.checked=true;loadAdminCoupons();}
 catch(e){couponNotice(e.message||"No pudimos guardar el cupón.","error");}
 finally{button.disabled=false;button.textContent="Guardar cupón";}
}
async function toggleAdminCoupon(id){
 const c=adminCoupons.find(x=>x.id===id);if(!c)return;
 try{await call({action:"save-coupon",id:c.id,code:c.code,description:c.description,discount_type:c.discount_type,discount_value:c.discount_value,minimum_subtotal_cop:c.minimum_subtotal_cop,max_uses:c.max_uses,starts_at:c.starts_at,ends_at:c.ends_at,is_active:!c.is_active});couponNotice("Estado del cupón actualizado.","success");loadAdminCoupons();}
 catch(e){couponNotice(e.message||"No pudimos cambiar el estado del cupón.","error");}
}
function loadAdminReviews(){
 if(!["owner","admin"].includes(currentRole))return;
 call({action:"list-reviews"}).then(result=>{adminReviews=result.reviews||[];renderAdminReviews();reviewNotice("Reseñas cargadas: "+adminReviews.length+".","success");}).catch(e=>reviewNotice(e.message||"No pudimos cargar las reseñas.","error"));
}
function renderAdminReviews(){
 const box=$("#adminReviewsList");if(!box)return;
 if(!adminReviews.length){box.innerHTML='<div class="admin-orders-empty">Todavía no hay reseñas.</div>';return;}
 box.innerHTML=adminReviews.map(r=>{
  const name=typeof r.products==="object"?(Array.isArray(r.products)?r.products[0]?.name:r.products?.name):"Producto";
  return '<article class="admin-review-row"><div class="admin-review-top"><div><strong>'+esc(name||"Producto")+'</strong><div class="admin-review-meta">'+esc(r.customer_name||"Cliente")+' · '+esc(formatDate(r.created_at))+'</div></div><div class="admin-review-stars">'+("★".repeat(Number(r.rating)||0))+("☆".repeat(5-(Number(r.rating)||0)))+'</div></div>'+(r.title?'<strong>'+esc(r.title)+'</strong>':"")+'<div class="admin-review-body">'+esc(r.body)+'</div><div class="admin-review-actions"><span class="admin-pill '+(r.is_approved?"":"off")+'">'+(r.is_approved?"Publicada":"Pendiente")+'</span><button type="button" data-review-toggle="'+esc(r.id)+'" data-next="'+(!r.is_approved)+'">'+(r.is_approved?"Ocultar reseña":"Aprobar reseña")+'</button></div></article>';
 }).join("");
 box.querySelectorAll("[data-review-toggle]").forEach(button=>button.addEventListener("click",()=>setReviewStatus(button.dataset.reviewToggle,button.dataset.next==="true")));
}
async function setReviewStatus(id,isApproved){
 try{await call({action:"set-review-status",id,is_approved:isApproved});reviewNotice(isApproved?"Reseña aprobada y visible en la tienda.":"Reseña ocultada de la tienda.","success");loadAdminReviews();}
 catch(e){reviewNotice(e.message||"No pudimos cambiar el estado de la reseña.","error");}
}

function configureRolePanels(){
 document.body.classList.add("admin-authorized");
 const users=$("#adminUsersWrap"),ordersWrap=$("#adminOrdersWrap"),couponsWrap=$("#adminCouponsWrap"),reviewsWrap=$("#adminReviewsWrap"),editor=document.querySelector(".admin-grid > section:first-of-type"),catalog=document.querySelector(".admin-grid > section:nth-of-type(2)"),metricsWrap=document.querySelector(".admin-metrics-wrap");
 const canManage=["owner","admin"].includes(currentRole),canEdit=["owner","admin","catalog_manager"].includes(currentRole),canAnalyze=["owner","admin","analyst"].includes(currentRole);
 if(users)users.hidden=!canManage;
 if(ordersWrap)ordersWrap.hidden=!canManage;
 if(couponsWrap)couponsWrap.hidden=!canManage;
 if(reviewsWrap)reviewsWrap.hidden=!canManage;
 if(editor)editor.hidden=true;
 if(catalog)catalog.hidden=!canEdit&&currentRole!=="analyst";
 if(metricsWrap)metricsWrap.hidden=!canAnalyze;
 const addProduct=$("#addAdminProduct");if(addProduct)addProduct.hidden=!canEdit;
 const permissions={overview:canAnalyze,orders:canManage,catalog:canEdit||currentRole==="analyst",coupons:canManage,reviews:canManage,users:canManage};
 const nav=$("#adminSectionNav");if(nav)nav.hidden=false;
 nav?.querySelectorAll("[data-admin-tab]").forEach(button=>{button.hidden=!permissions[button.dataset.adminTab];});
 setAdminSection(canAnalyze?"overview":"catalog");
}
async function loadProducts(){
 try{
  const r=await call({action:"list"});products=r.products||[];renderProducts();
  if(["owner","admin","analyst"].includes(currentRole)){
   try{await loadAdminMetrics();}
   catch(e){status("Catálogo cargado, pero las métricas no están disponibles: "+(e.message||""),"error");}
  }else{metrics=null;renderMetrics(null);}
  if(!["owner","admin","catalog_manager","analyst"].includes(currentRole))status("Permiso insuficiente.","error");
  else status("Sesión lista. El servidor confirmó el rol: "+roleLabel(currentRole)+".","success");
  configureRolePanels();
 }catch(e){products=[];renderProducts();renderMetrics(null);status(e.message||"No se pudo cargar el catálogo.","error");}
}
const ORDER_STATES=[
 ["pending_payment","Pendiente de pago"],["paid","Pago confirmado"],["preparing","En preparación"],
 ["shipped","Enviado"],["delivered","Entregado"],["cancelled","Cancelado"],
 ["payment_failed","Pago rechazado"],["refunded","Reembolsado"]
];
const orderStateLabel=value=>(ORDER_STATES.find(([key])=>key===value)||[value||"","Sin estado"])[1];
const paymentLabel=value=>({pending:"Pendiente",approved:"Aprobado",rejected:"Rechazado",cancelled:"Cancelado",refunded:"Reembolsado"})[value]||value||"Sin estado";
function orderStatusNotice(message,kind="info"){
 const el=$("#adminOrdersStatus");if(!el)return;
 el.textContent=message;el.className="admin-status "+kind;
}
function formatDate(value){
 const date=new Date(value);
 return Number.isNaN(date.getTime())?"Fecha no disponible":date.toLocaleString("es-CO",{dateStyle:"medium",timeStyle:"short"});
}
function whatsappHref(phone){
 let digits=String(phone||"").replace(/\D/g,"");
 if(digits.startsWith("00"))digits=digits.slice(2);
 if(digits.length===10)digits="57"+digits;
 if(digits.length<10||digits.length>15)return "";
 return "https://wa.me/"+digits;
}
function orderMatchesSearch(order,query){
 if(!query)return true;
 const customer=[order.customer_first_name,order.customer_last_name,order.customer_email,order.customer_phone,order.order_number,order.address,order.city].join(" ").toLocaleLowerCase("es");
 return customer.includes(query);
}
async function loadAdminOrders(reset=false,preservePage=false){
 if(!["owner","admin"].includes(currentRole))return;
 if(ordersLoading){
  if(reset)ordersReloadQueued=true;
  return;
 }
 const previousPage=ordersPage;
 if(reset){
  adminOrders=[];ordersOffset=0;ordersHasMore=true;ordersTotalCount=0;
  ordersPage=preservePage?previousPage:1;
 }
 if(!ordersHasMore&&!reset)return;
 ordersLoading=true;
 const refresh=$("#refreshAdminOrders"),more=$("#loadMoreOrders");
 if(refresh){refresh.disabled=true;refresh.textContent="Cargando…";}
 if(more&&!reset){more.disabled=true;more.textContent="Cargando…";}
 orderStatusNotice("Consultando pedidos de forma segura…");
 renderAdminOrders();
 try{
  const state=$("#adminOrderStatusFilter")?.value||"all";
  const search=String($("#adminOrderSearch")?.value||"").trim().slice(0,100);
  const result=await call({action:"list-orders",status:state,search,limit:40,offset:ordersOffset});
  const rows=Array.isArray(result.orders)?result.orders:[];
  adminOrders=reset?rows:adminOrders.concat(rows);
  ordersOffset=Number(result.offset||0)+rows.length;
  ordersHasMore=!!result.hasMore;
  ordersTotalCount=Number(result.totalCount??adminOrders.length);
  renderAdminOrders();
  orderStatusNotice("Esta consulta coincide con "+ordersTotalCount.toLocaleString("es-CO")+" pedido(s). La lista muestra 10 por página; los pendientes de pago no cuentan como ventas pagadas hasta confirmar el pago del producto.","success");
 }catch(error){
  orderStatusNotice(error.message||"No pudimos consultar los pedidos. Vuelve a intentarlo.","error");
  if(reset){adminOrders=[];ordersTotalCount=0;}
  renderAdminOrders();
 }finally{
  ordersLoading=false;
  if(refresh){refresh.disabled=false;refresh.textContent="Actualizar pedidos";}
  if(more){more.disabled=false;more.textContent="Cargar 40 más pedidos";}
  renderAdminOrders();
  if(ordersReloadQueued){
   ordersReloadQueued=false;
   void loadAdminOrders(true);
  }
 }
}
async function changeAdminOrdersPage(direction){
 if(ordersLoading)return;
 if(direction==="prev"){
  if(ordersPage>1)ordersPage--;
 }else if(direction==="next"){
  const loadedPages=Math.ceil(adminOrders.length/ordersPageSize);
  if(ordersPage<loadedPages){
   ordersPage++;
  }else if(ordersHasMore){
   const before=adminOrders.length;
   await loadAdminOrders(false);
   if(adminOrders.length>before)ordersPage++;
  }
 }
 renderAdminOrders();
 $("#adminOrdersPaginationTop")?.scrollIntoView({behavior:"smooth",block:"nearest"});
}
function updateAdminOrdersPagination(){
 const total=Math.max(0,ordersTotalCount);
 const loaded=adminOrders.length;
 const loadedPages=Math.max(1,Math.ceil(loaded/ordersPageSize));
 const totalPages=Math.max(1,Math.ceil(total/ordersPageSize));
 ordersPage=Math.max(1,Math.min(ordersPage,loadedPages));
 const from=loaded?((ordersPage-1)*ordersPageSize)+1:0;
 const to=Math.min(ordersPage*ordersPageSize,loaded);
 const summary=total===0
  ?"No hay pedidos que coincidan con estos filtros."
  :"Mostrando "+from+"–"+to+" de "+total.toLocaleString("es-CO")+" pedido(s)"+(loaded<total?" · "+loaded+" cargados":"");
 document.querySelectorAll("[data-orders-summary]").forEach(el=>el.textContent=summary);
 document.querySelectorAll("[data-orders-page-label]").forEach(el=>el.textContent="Página "+ordersPage+" de "+totalPages);
 document.querySelectorAll("[data-orders-page='prev']").forEach(button=>button.disabled=ordersLoading||ordersPage<=1);
 document.querySelectorAll("[data-orders-page='next']").forEach(button=>button.disabled=ordersLoading||(ordersPage>=totalPages&&!ordersHasMore));
 const count=$("#adminOrdersCount");if(count)count.textContent=total.toLocaleString("es-CO");
 const more=$("#loadMoreOrders");if(more){more.hidden=!ordersHasMore;more.disabled=ordersLoading;more.textContent=ordersLoading?"Cargando…":"Cargar 40 más pedidos";}
}
function renderAdminOrders(){
 const box=$("#adminOrdersList");if(!box)return;
 const query=String($("#adminOrderSearch")?.value||"").trim();
 const shown=adminOrders;
 const totalPages=Math.max(1,Math.ceil(ordersTotalCount/ordersPageSize));
 const loadedPages=Math.max(1,Math.ceil(shown.length/ordersPageSize));
 ordersPage=Math.max(1,Math.min(ordersPage,loadedPages));
 const pageStart=(ordersPage-1)*ordersPageSize;
 const pageOrders=shown.slice(pageStart,pageStart+ordersPageSize);
 if(!pageOrders.length){
  box.innerHTML='<div class="admin-orders-empty">'+(query?'No encontramos pedidos que coincidan con esa búsqueda. Prueba con otro dato del cliente o número de pedido.':'No hay pedidos para el estado seleccionado todavía. Cuando un cliente termine una compra, aparecerá aquí.')+'</div>';
 }else{
  box.innerHTML=pageOrders.map(order=>{
   const customer=[order.customer_first_name,order.customer_last_name].filter(Boolean).join(" ")||"Cliente sin nombre";
   const address=[order.address,order.neighborhood,order.city,order.department,order.postal_code].filter(Boolean).join(", ");
   const items=Array.isArray(order.order_items)?order.order_items:[];
   const itemRows=items.map(item=>'<li><span>'+esc(item.product_name||"Producto")+(item.selected_variant?' · Color: '+esc(item.selected_variant):"")+' ×'+Number(item.quantity||0)+'</span><strong>'+money(item.line_total_cop??(Number(item.unit_price_cop||0)*Number(item.quantity||0)))+'</strong></li>').join("");
   const wa=whatsappHref(order.customer_phone);
   const validCoords=order.latitude!==null&&order.latitude!==undefined&&order.longitude!==null&&order.longitude!==undefined&&Number.isFinite(Number(order.latitude))&&Number.isFinite(Number(order.longitude));
   const mapUrl=validCoords?'https://www.google.com/maps?q='+Number(order.latitude)+','+Number(order.longitude):(address?'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(address):"");
   const coords=mapUrl?'<a target="_blank" rel="noopener noreferrer" href="'+mapUrl+'">Abrir mapa para entrega ↗</a>':"";
   const badges='<span class="admin-order-badge '+(order.status==="pending_payment"?"pending":(["paid","preparing","shipped","delivered"].includes(order.status)?"paid":(["cancelled","payment_failed","refunded"].includes(order.status)?"cancelled":"")))+'">'+esc(orderStateLabel(order.status))+'</span><span class="admin-order-badge">Pago: '+esc(paymentLabel(order.payment_status))+'</span>';
   const availableStates=order.payment_provider==="cash_on_delivery"?ORDER_STATES.filter(([value])=>value!=="paid"):ORDER_STATES;
   const options=availableStates.map(([value,label])=>'<option value="'+value+'" '+(order.status===value?"selected":"")+'>'+label+'</option>').join("");
   const email=order.customer_email?'<div>Correo: <a href="mailto:'+esc(order.customer_email)+'">'+esc(order.customer_email)+'</a></div>':"";
   const phone=order.customer_phone?'<div>Teléfono: <a href="tel:'+esc(String(order.customer_phone).replace(/[^+\d]/g,""))+'">'+esc(order.customer_phone)+'</a> '+(wa?'<a target="_blank" rel="noopener noreferrer" href="'+wa+'">WhatsApp ↗</a>':"")+'</div>':"";
   const subtotal=Number(order.subtotal_cop)||0,discount=Number(order.discount_cop)||0,total=Number(order.total_cop??(subtotal-discount));
   const printfulLabels={pending:"Pendiente de envío",processing:"Enviando…",submitted:"Enviado a Printful",partial:"Enviado parcialmente",failed:"Error al enviar",not_applicable:"No aplica"};
   const printfulSummary=order.printful_status&&order.printful_status!=="not_applicable"?'<div class="admin-order-meta">Printful: <strong>'+esc(printfulLabels[order.printful_status]||order.printful_status)+'</strong>'+(order.printful_order_id?' · Orden Printful #'+esc(order.printful_order_id):"")+(order.printful_error?'<div class="admin-order-meta">'+esc(order.printful_error)+'</div>':"")+((["pending","failed"].includes(order.printful_status)&&order.payment_provider==="bold"&&order.payment_status==="approved")?'<div style="margin-top:8px"><button type="button" data-printful-submit="'+esc(order.id)+'">'+(order.printful_status==="failed"?"Reintentar envío a Printful":"Enviar a Printful")+"</button></div>":"")+"</div>":"";
   const fixedCODFreight=order.payment_provider==="cash_on_delivery"&&order.cash_on_delivery_due_cop!=null;
   const shippingSummary=order.delivery_type==="digital"?"":
    (order.payment_provider==="bold"
      ?'<div class="admin-order-meta">Envío: <strong>Gratis con pago Bold</strong></div>'
      :'<div class="admin-order-meta">'+(fixedCODFreight?'Anticipo de envío por Bold':'Flete transportadora')+': <strong>'+(order.shipping_fee_cop==null?'Pendiente de cotizar':money(order.shipping_fee_cop))+'</strong> · '+(order.shipping_payment_status==="approved"?(fixedCODFreight?'Pagado por Bold':'Pagado por anticipado'):(fixedCODFreight?'Pendiente de pago por Bold':'Pendiente de pago previo'))+'</div>');
   const priceInfo=(order.coupon_code?'<div class="admin-order-meta">Cupón: <strong>'+esc(order.coupon_code)+'</strong> · Descuento: '+money(discount)+'</div>':(discount>0?'<div class="admin-order-meta">Descuento: '+money(discount)+'</div>':""));
   const isShippable=order.delivery_type!=="digital";
   const isBoldOrder=order.payment_provider==="bold";
   const shippingFeeValue=order.shipping_fee_cop==null?"":String(Number(order.shipping_fee_cop));
   const shippingStatusText=isBoldOrder
    ?"Envío gratis: pago en línea con Bold."
    :(fixedCODFreight
      ?(order.shipping_payment_status==="approved"?"Anticipo de $12.000 pagado y confirmado por Bold. Saldo al recibir: "+money(order.cash_on_delivery_due_cop)+".":"Anticipo de $12.000 pendiente de pago por Bold. No despachar hasta la confirmación.")
      :(order.shipping_fee_cop==null
        ?"Flete pendiente de cotizar. No despachar hasta registrar el pago anticipado."
        :(order.shipping_payment_status==="approved"
          ?"Flete "+money(order.shipping_fee_cop)+" pagado a la transportadora."
          :"Flete "+money(order.shipping_fee_cop)+" cotizado; falta su pago anticipado.")));
   const shipping=isShippable?`<div class="admin-shipping-editor" data-shipping-editor="${esc(order.id)}">
     <div class="admin-shipping-freight">
       <label>Flete de la transportadora (COP)<input type="number" min="1" max="100000000" step="1" data-shipping-fee="${esc(order.id)}" value="${esc(shippingFeeValue)}" placeholder="${isBoldOrder?"0 · gratis con Bold":"Cotizar flete"}" ${(isBoldOrder||fixedCODFreight)?"readonly":""}></label>
       <label class="admin-shipping-paid-control"><span>Verificación del flete</span><span><input type="checkbox" data-shipping-paid="${esc(order.id)}" ${order.shipping_payment_status==="approved"?"checked":""} ${(isBoldOrder||fixedCODFreight)?"disabled":""}> ${fixedCODFreight?"Anticipo pagado con Bold":"Flete pagado por anticipado"}</span></label>
     </div>
     <div class="admin-shipping-current">${shippingStatusText}</div>
     <label>Transportadora<input type="text" maxlength="80" data-shipping-carrier="${esc(order.id)}" value="${esc(order.shipping_carrier||"")}" placeholder="Ej. Inter Rapidísimo"></label>
     <label>Número de guía<input type="text" maxlength="100" data-tracking-number="${esc(order.id)}" value="${esc(order.tracking_number||"")}" placeholder="Guía de envío"></label>
     <label>Entrega estimada<input type="date" data-estimated-date="${esc(order.id)}" value="${esc(String(order.estimated_delivery_date||"").slice(0,10))}"></label>
     <div class="admin-shipping-current">${order.tracking_number?'Guía guardada: <strong>'+esc(order.tracking_number)+'</strong> · ':''}${order.shipping_carrier?'Transportadora: '+esc(order.shipping_carrier)+' · ':''}${order.estimated_delivery_date?'Fecha estimada: '+esc(String(order.estimated_delivery_date).slice(0,10)):''}</div>
     <div class="admin-shipping-actions"><button type="button" data-shipping-save="${esc(order.id)}">Guardar flete y envío</button>${(wa&&order.tracking_number)?'<a class="admin-order-open-link admin-shipping-notify" target="_blank" rel="noopener noreferrer" href="'+whatsappShippingHref(order)+'">Avisar por WhatsApp ↗</a>':""}</div>
   </div>`:'<div class="admin-shipping-current">Este pedido es digital; no requiere seguimiento de transportadora.</div>';
   return '<article class="admin-order-card" data-order-card="'+esc(order.id)+'"><div class="admin-order-top"><div><div class="admin-order-id">'+esc(order.order_number||order.id)+'</div><div class="admin-order-date">'+esc(formatDate(order.created_at))+'</div></div><div class="admin-order-badges">'+badges+'</div></div><div class="admin-order-grid"><section><div class="admin-order-label">Datos del comprador</div><div class="admin-order-customer">'+esc(customer)+'</div><div class="admin-order-meta">'+email+phone+(address?'<div>Dirección: '+esc(address)+'</div>':'<div>Dirección: No indicada</div>')+(order.delivery_reference?'<div>Referencia: '+esc(order.delivery_reference)+'</div>':"")+(order.preferred_payment_method?'<div>Pago elegido: '+esc(order.preferred_payment_method)+'</div>':"")+(coords?'<div>'+coords+'</div>':"")+(order.customer_note?'<div>Nota: '+esc(order.customer_note)+'</div>':"")+'</div></section><section><div class="admin-order-label">Resumen del pedido · '+esc(order.delivery_type||"")+'</div><ul class="admin-order-lines">'+(itemRows||'<li>Detalle de productos no disponible.</li>')+'</ul>'+priceInfo+shippingSummary+printfulSummary+'<div class="admin-order-total"><span>'+(discount?'Total de productos con descuento':'Total de productos')+'</span><strong>'+money(total)+'</strong></div>'+(fixedCODFreight?'<div class="admin-order-meta">Anticipo de envío pagado por Bold: <strong>'+money(order.shipping_payment_status==="approved"?12000:0)+'</strong>'+(order.shipping_payment_status==="approved"?'':' · Pendiente: '+money(12000))+'</div><div class="admin-order-total"><span>Saldo por cobrar al recibir</span><strong>'+money(order.cash_on_delivery_due_cop)+'</strong></div>':"")+'</section></div><div class="admin-order-foot"><div class="admin-order-meta">Última actualización: '+esc(formatDate(order.updated_at||order.created_at))+'</div><div class="admin-order-update"><label>Actualizar estado<select data-order-status="'+esc(order.id)+'">'+options+'</select></label><button type="button" data-order-update="'+esc(order.id)+'">Guardar estado</button></div></div>'+shipping+'</article>';
  }).join("");
 }
 updateAdminOrdersPagination();
 box.querySelectorAll("[data-order-update]").forEach(button=>button.addEventListener("click",()=>updateOrderStatus(button.dataset.orderUpdate,button)));
 box.querySelectorAll("[data-printful-submit]").forEach(button=>button.addEventListener("click",()=>submitPrintfulOrder(button.dataset.printfulSubmit,button)));
 box.querySelectorAll("[data-shipping-save]").forEach(button=>button.addEventListener("click",()=>saveOrderShipping(button.dataset.shippingSave,button)));
}
function whatsappShippingHref(order){
 const digits=String(order.customer_phone||"").replace(/\D/g,"");
 if(digits.length<10)return "";
 const number=digits.length===10?"57"+digits:digits;
 const customer=[order.customer_first_name,order.customer_last_name].filter(Boolean).join(" ")||"cliente";
 const message=["Hola "+customer+", te compartimos la actualización de tu pedido "+(order.order_number||"NovaShop")+".","Transportadora: "+(order.shipping_carrier||"por confirmar"),"Número de guía: "+(order.tracking_number||"por confirmar"),order.estimated_delivery_date?"Fecha estimada: "+String(order.estimated_delivery_date).slice(0,10):null,"Gracias por comprar en NovaShop."].filter(Boolean).join("\n");
 return "https://wa.me/"+number+"?text="+encodeURIComponent(message);
}
async function saveOrderShipping(orderId,button){
 if(!["owner","admin"].includes(currentRole)){orderStatusNotice("No tienes permiso para gestionar envíos.","error");return;}
 const id=CSS.escape(orderId);
 const carrier=document.querySelector('input[data-shipping-carrier="'+id+'"]');
 const tracking=document.querySelector('input[data-tracking-number="'+id+'"]');
 const date=document.querySelector('input[data-estimated-date="'+id+'"]');
 const fee=document.querySelector('input[data-shipping-fee="'+id+'"]');
 const paid=document.querySelector('input[data-shipping-paid="'+id+'"]');
 if(!carrier||!tracking||!date||!fee||!paid)return;
 button.disabled=true;button.textContent="Guardando…";
 try{
  const result=await call({action:"update-order-shipping",order_id:orderId,shipping_carrier:carrier.value.trim(),tracking_number:tracking.value.trim(),estimated_delivery_date:date.value||null,shipping_fee_cop:fee.value.trim()===""?null:Number(fee.value),shipping_paid:paid.checked});
  const order=adminOrders.find(x=>x.id===orderId);if(order&&result.order)Object.assign(order,result.order);
  orderStatusNotice(result.message||"Datos de envío guardados.","success");renderAdminOrders();
 }catch(error){orderStatusNotice(error.message||"No pudimos guardar el seguimiento.","error");}
 finally{button.disabled=false;button.textContent="Guardar flete y envío";}
}
async function submitPrintfulOrder(orderId,button){
 if(!["owner","admin"].includes(currentRole)){orderStatusNotice("Solo el propietario o administrador puede enviar pedidos a Printful.","error");return;}
 button.disabled=true;button.textContent="Procesando…";
 try{
  const result=await db.fulfillPrintfulOrder(orderId);
  orderStatusNotice(result.message||"Solicitud enviada a Printful.","success");
  await loadAdminOrders(true);
 }catch(error){
  orderStatusNotice(error.message||"No pudimos enviar el pedido a Printful.","error");
  await loadAdminOrders(true);
 }
}
function csvCell(value){
 const text=String(value??"");
 return '"'+text.replace(/"/g,'""')+'"';
}
function exportAdminOrdersCsv(){
 if(!["owner","admin"].includes(currentRole)){orderStatusNotice("No tienes permiso para exportar pedidos.","error");return;}
 if(!adminOrders.length){orderStatusNotice("No hay pedidos cargados para exportar.","error");return;}
 const headers=["Pedido","Creado","Estado","Pago producto","Nombres","Apellidos","Correo","Teléfono","Dirección","Barrio","Ciudad","Departamento","Código postal","Referencia","Flete COP","Estado del flete","Transportadora","Número de guía","Entrega estimada","Productos","Subtotal COP","Descuento COP","Total productos COP","Cupón","Método de pago"];
 const rows=adminOrders.map(o=>[
  o.order_number,o.created_at,orderStateLabel(o.status),paymentLabel(o.payment_status),o.customer_first_name,o.customer_last_name,o.customer_email,o.customer_phone,
  o.address,o.neighborhood,o.city,o.department,o.postal_code,o.delivery_reference,o.shipping_fee_cop,o.shipping_payment_status,o.shipping_carrier,o.tracking_number,o.estimated_delivery_date,
  (o.order_items||[]).map(it=>(it.product_name||"Producto")+" x"+Number(it.quantity||0)).join(" | "),
  Number(o.subtotal_cop||0),Number(o.discount_cop||0),Number(o.total_cop??(Number(o.subtotal_cop||0)-Number(o.discount_cop||0))),o.coupon_code,o.preferred_payment_method
 ]);
 const csv="\uFEFF"+[headers,...rows].map(row=>row.map(csvCell).join(",")).join("\r\n");
 const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"}));
 const link=document.createElement("a");link.href=url;link.download="novashop-pedidos-"+new Date().toISOString().slice(0,10)+".csv";
 document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
 orderStatusNotice("CSV exportado con "+adminOrders.length+" pedidos cargados. Usa «Cargar más» para incluir más registros.","success");
}
async function updateOrderStatus(orderId,button){
 if(!["owner","admin"].includes(currentRole)){orderStatusNotice("No tienes permiso para actualizar pedidos.","error");return;}
 const select=document.querySelector('[data-order-status="'+CSS.escape(orderId)+'"]');
 if(!select)return;
 const order=adminOrders.find(item=>item.id===orderId);if(!order)return;
 const next=select.value;
 if(next===order.status){orderStatusNotice("El pedido ya tiene ese estado.");return;}
 const productWillBePaid=next==="paid"||next==="delivered"||(["preparing","shipped"].includes(next)&&order.payment_provider!=="cash_on_delivery");
 if(productWillBePaid){
  const accepted=confirm("Vas a marcar "+(order.order_number||"este pedido")+" como «"+orderStateLabel(next)+"». Esto registrará el producto como pagado. Confirma solo si verificaste que el cliente lo pagó o lo recaudó la transportadora.");
  if(!accepted){select.value=order.status;return;}
 }else if(next==="shipped"&&order.payment_provider==="cash_on_delivery"&&!confirm("Solo puedes despachar contraentrega si el flete real ya está cotizado y pagado por anticipado a la transportadora. ¿Ya lo verificaste?")){select.value=order.status;return;}
 else if(next==="refunded"&&!confirm("¿Confirmas que el reembolso del producto ya se realizó?")){select.value=order.status;return;}
 else if(next==="cancelled"&&!confirm("¿Deseas cancelar este pedido?")){select.value=order.status;return;}
 button.disabled=true;button.textContent="Guardando…";
 try{
  await call({action:"update-order-status",order_id:orderId,status:next});
  orderStatusNotice("Estado actualizado para "+(order.order_number||"el pedido")+".","success");
  await Promise.all([loadAdminOrders(true,true),loadProducts()]);
 }catch(error){
  orderStatusNotice(error.message||"No se pudo actualizar el pedido.","error");select.value=order.status;
 }finally{button.disabled=false;button.textContent="Guardar estado";}
}
function metricDateRange(){
 const from=$("#adminMetricsStartDate")?.value||"",to=$("#adminMetricsEndDate")?.value||"";
 if(from&&to&&from>to)throw new Error("La fecha inicial no puede ser posterior a la fecha final.");
 return {
  ...(from?{start_date:new Date(from+"T00:00:00").toISOString()}:{}),
  ...(to?{end_date:new Date(to+"T23:59:59.999").toISOString()}: {})
 };
}
async function loadAdminMetrics(){
 if(!["owner","admin","analyst"].includes(currentRole))return;
 const refresh=$("#refreshAdminMetrics");
 if(refresh){refresh.disabled=true;refresh.textContent="Cargando…";}
 try{
  const result=await call({action:"metrics",...metricDateRange()});
  metrics=result.metrics||null;renderMetrics(metrics);
  if(metrics){
   const p=metrics.periodStart&&metrics.periodEnd?" Período aplicado: "+new Date(metrics.periodStart).toLocaleDateString("es-CO")+" – "+new Date(metrics.periodEnd).toLocaleDateString("es-CO")+".":" Período: todos los registros.";
   status("Métricas actualizadas."+p,"success");
  }
  return metrics;
 }finally{if(refresh){refresh.disabled=false;refresh.textContent="Aplicar fechas";}}
}
function renderMetrics(m){
 const box=$("#adminMetrics");if(!box)return;
 if(!m){
  box.innerHTML=[
   ["Ingresos netos","—"],["Pedidos pagados","—"],["Unidades vendidas","—"],["Pedidos pendientes","—"],
   ["Pedidos cancelados","—"],["Clientes recurrentes","—"],["Descuentos aplicados","—"]
  ].map(([label,value])=>'<div class="admin-metric"><span>'+esc(label)+'</span><strong>'+value+'</strong></div>').join("");
  $("#adminInventoryMetrics").textContent="No se pudieron cargar las métricas.";
  $("#adminSalesMix").textContent="No se pudieron cargar las ventas.";
  if($("#adminCategoryMix"))$("#adminCategoryMix").textContent="No se pudieron cargar las categorías.";
  return;
 }
 box.innerHTML=[
  ["Ingresos netos",money(m.revenueCop)],
  ["Pedidos pagados",Number(m.paidOrders||0)],
  ["Unidades vendidas",Number(m.unitsSold||0)],
  ["Pedidos pendientes",Number(m.pendingOrders||0)],
  ["Pedidos cancelados",Number(m.cancelledOrders||0)],
  ["Clientes recurrentes",Number(m.repeatCustomers||0)],
  ["Descuentos aplicados",money(m.discountsCop||0)]
 ].map(([label,value])=>'<div class="admin-metric"><span>'+esc(label)+'</span><strong>'+value+'</strong></div>').join("");
 const inv=m.inventory||{};
 $("#adminInventoryMetrics").innerHTML=[
  ["Productos activos",inv.activeProducts||0],
  ["Stock configurado",inv.trackedProducts||0],
  ["Unidades en stock",inv.trackedUnits||0],
  ["Sin inventario configurado",inv.untrackedProducts||0],
  ["Stock bajo (≤ 5)",(inv.lowStockProducts||[]).length],
  ["Agotados",(inv.outOfStockProducts||[]).length]
 ].map(([label,value])=>'<div class="admin-inventory-stat"><span>'+esc(label)+'</span><strong>'+Number(value)+'</strong></div>').join("");
 const alertBox=$("#adminInventoryAlerts");
 if(alertBox){
  const out=Array.isArray(inv.outOfStockProducts)?inv.outOfStockProducts:[];
  const low=Array.isArray(inv.lowStockProducts)?inv.lowStockProducts:[];
  const canEditStock=["owner","admin","catalog_manager"].includes(currentRole);
  const listItems=items=>items.slice(0,5).map(p=>'<div class="admin-stock-alert-item"><span>'+esc(p.name)+' · '+Number(p.stock_quantity||0)+' unidades</span>'+(canEditStock?'<button type="button" data-stock-edit="'+Number(p.id)+'">Editar stock</button>':"")+'</div>').join("")+(items.length>5?'<div>Y '+(items.length-5)+' productos más.</div>':"");
  let alertHtml="";
  if(out.length)alertHtml+='<div class="admin-stock-alert critical"><div><strong>Agotados ('+out.length+')</strong>'+listItems(out)+'</div></div>';
  if(low.length)alertHtml+='<div class="admin-stock-alert"><div><strong>Stock bajo ('+low.length+')</strong>'+listItems(low)+'</div></div>';
  if(Number(inv.untrackedProducts||0)>0)alertHtml+='<div class="admin-stock-alert neutral"><div><strong>Inventario sin configurar</strong>'+Number(inv.untrackedProducts)+' productos no tienen cantidad registrada. Introduce las existencias reales desde Catálogo.</div>'+(canEditStock?'<button type="button" data-stock-goto>Ir al catálogo</button>':"")+'</div>';
  if(!alertHtml)alertHtml='<div class="admin-stock-alert neutral"><div><strong>Inventario al día</strong>No hay alertas de stock bajo o agotado en los productos controlados.</div></div>';
  alertBox.innerHTML=alertHtml;
  alertBox.querySelectorAll("[data-stock-edit]").forEach(button=>button.addEventListener("click",()=>{
   const product=products.find(p=>Number(p.id)===Number(button.dataset.stockEdit));
   if(product){editProduct(product.id);const input=$("#adminProductForm").elements.stock_quantity;input.focus();input.scrollIntoView({behavior:"smooth",block:"center"});}
  }));
  alertBox.querySelector("[data-stock-goto]")?.addEventListener("click",()=>{$(".admin-grid")?.scrollIntoView({behavior:"smooth",block:"start"});});
 }
 const mix=Array.isArray(m.salesMix)?m.salesMix:[];
 $("#adminSalesMix").innerHTML=mix.length?mix.map(p=>'<div class="admin-sales-row"><span class="name" title="'+esc(p.name)+'">'+esc(p.name)+'</span><div class="admin-sales-bar"><span style="width:'+Math.min(100,Math.max(0,Number(p.percentage)||0))+'%"></span></div><span class="admin-sales-pct">'+(Number(p.percentage)||0).toLocaleString("es-CO",{maximumFractionDigits:1})+'%</span></div>').join(""):'<p class="admin-help">Todavía no hay ventas con pago confirmado. Los pedidos pendientes por WhatsApp no cuentan como ventas pagadas.</p>';
 const categories=Array.isArray(m.categoryMix)?m.categoryMix:[];
 const categoryBox=$("#adminCategoryMix");
 if(categoryBox)categoryBox.innerHTML=categories.length?categories.map(c=>'<div class="admin-category-row"><span class="name" title="'+esc(c.category)+'">'+esc(c.category)+'</span><div class="admin-category-bar"><span style="width:'+Math.min(100,Math.max(0,Number(c.percentage)||0))+'%"></span></div><span class="admin-sales-pct">'+(Number(c.percentage)||0).toLocaleString("es-CO",{maximumFractionDigits:1})+'%</span></div>').join(""):'<p class="admin-help">Todavía no hay ventas pagadas para agrupar por categoría.</p>';
}
function renderProducts(){
 const box=$("#adminProductList");if(!products.length){box.innerHTML='<p class="admin-help">No hay productos o tu cuenta no está autorizada. Inicia sesión y solicita el permiso de administrador al propietario de la tienda.</p>';return;}
 const canEdit=["owner","admin","catalog_manager"].includes(currentRole);
 box.innerHTML=products.map(p=>'<article class="admin-product"><img src="'+esc((p.images||[])[0]||"images/streaming-placeholder.svg")+'" alt=""><div><h3>'+esc(p.name)+'</h3><p>'+money(p.price_cop)+' · '+esc(p.category)+'</p><small>#'+p.id+' · '+(p.is_active?'Visible':'Oculto')+(p.video_url?' · tiene video':'')+' · '+(p.stock_quantity==null?'Stock sin configurar':(Number(p.stock_quantity)===0?'Agotado':'Stock: '+Number(p.stock_quantity)))+'</small></div>'+(canEdit?'<div class="admin-actions"><button type="button" data-edit="'+p.id+'">Editar</button>'+(p.is_active?'<button type="button" data-off="'+p.id+'">Ocultar</button>':'')+'</div>':'')+'</article>').join("");
 box.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>editProduct(Number(b.dataset.edit))));
 box.querySelectorAll("[data-off]").forEach(b=>b.addEventListener("click",()=>deactivate(Number(b.dataset.off))));
}
function disposeEditingImagePreviews(){
 editingImages.forEach(item=>{if(item?.previewUrl){URL.revokeObjectURL(item.previewUrl);item.previewUrl=null;}});
}
function addProductImages(input){
 const files=Array.from(input?.files||[]);if(!files.length)return;
 const allowed=["image/jpeg","image/png","image/webp","image/avif","image/gif"];
 const invalid=files.find(file=>!allowed.includes(file.type));
 if(invalid){status("La imagen "+invalid.name+" debe ser JPG, PNG, WEBP, AVIF o GIF.","error");input.value="";return;}
 const tooLarge=files.find(file=>file.size>12*1024*1024);
 if(tooLarge){status("La imagen "+tooLarge.name+" supera el máximo de 12 MB.","error");input.value="";return;}
 if(editingImages.length+files.length>8){status("Un producto admite máximo 8 fotos en total. Quita una foto o selecciona menos.","error");input.value="";return;}
 files.forEach(file=>editingImages.push({url:"",file,previewUrl:URL.createObjectURL(file)}));
 input.value="";
 const form=$("#adminProductForm");if(form)form.dataset.dirty="1";
 renderCurrentMedia();
 status("Fotos añadidas. La primera miniatura es la portada; puedes cambiarla con «Usar como portada».","success");
}
function renderCurrentMedia(){
 const form=$("#adminProductForm");
 const imageBox=$("#adminCurrentImages");
 const videoBox=$("#adminCurrentVideo");
 if(imageBox){
  imageBox.hidden=!editingImages.length;
  imageBox.innerHTML=editingImages.map((item,index)=>{
   const src=item.previewUrl||item.url||"";
   const isCover=index===0;
   const label=isCover?"PORTADA PRINCIPAL":"Foto "+(index+1);
   const fileInfo=item.file?("Pendiente de subir · "+esc(item.file.name)+" · "+(item.file.size/1024/1024).toFixed(1)+" MB"):"Guardada en la tienda";
   return '<div class="admin-current-image '+(isCover?"is-cover":"")+'" data-image-index="'+index+'">'+
    '<img src="'+esc(src)+'" alt="'+esc(label)+" del producto"+'" loading="lazy">'+
    (isCover?'<span class="admin-cover-badge">PORTADA</span>':'')+
    '<small><strong>'+label+'</strong><br>'+fileInfo+'</small>'+
    '<div class="admin-image-actions">'+
     (isCover?'<span class="admin-cover-current">✓ Es la portada</span>':'<button type="button" data-make-cover="'+index+'" aria-label="Usar la foto '+(index+1)+' como portada">Usar como portada</button>')+
     '<button type="button" class="admin-image-remove" data-remove-current-image="'+index+'" aria-label="Quitar foto '+(index+1)+'">Quitar</button>'+
    '</div></div>';
  }).join("");
  imageBox.querySelectorAll("[data-make-cover]").forEach(button=>button.addEventListener("click",()=>{
   const index=Number(button.dataset.makeCover);
   if(!Number.isInteger(index)||index<=0||index>=editingImages.length)return;
   const [chosen]=editingImages.splice(index,1);editingImages.unshift(chosen);
   if(form)form.dataset.dirty="1";
   renderCurrentMedia();
   status("Portada actualizada. Guarda el producto para publicar el cambio.","success");
  }));
  imageBox.querySelectorAll("[data-remove-current-image]").forEach(button=>button.addEventListener("click",()=>{
   const index=Number(button.dataset.removeCurrentImage);
   if(!Number.isInteger(index)||index<0||index>=editingImages.length)return;
   const [removed]=editingImages.splice(index,1);
   if(removed?.previewUrl)URL.revokeObjectURL(removed.previewUrl);
   if(form)form.dataset.dirty="1";
   renderCurrentMedia();
   status(editingImages.length?"Foto quitada. Guarda el producto para publicar el cambio.":"Ya no hay fotos. Añade al menos una antes de guardar.","info");
  }));
 }
 if(videoBox){
  const picked=form?.elements.video?.files?.[0]||null;
  if(pendingVideoPreviewUrl){URL.revokeObjectURL(pendingVideoPreviewUrl);pendingVideoPreviewUrl=null;}
  const current=editingVideo?'<video controls playsinline preload="metadata" src="'+esc(editingVideo)+'"></video><div class="admin-current-video-meta"><span>Video guardado en el producto</span><button type="button" id="removeCurrentVideo">Quitar video actual</button></div>':"";
  let pending="";
  if(picked){
   pendingVideoPreviewUrl=URL.createObjectURL(picked);
   pending='<video class="admin-video-editor-preview" controls playsinline preload="metadata" src="'+esc(pendingVideoPreviewUrl)+'"></video><div class="admin-current-video-meta"><span>Vista previa: '+esc(picked.name)+' ('+(picked.size/1024/1024).toFixed(1)+' MB). Reemplazará el video actual al guardar.</span><button type="button" id="clearSelectedVideo">Deshacer selección</button></div>';
  }
  videoBox.innerHTML=current+pending;
  videoBox.hidden=!current&&!pending;
  $("#removeCurrentVideo")?.addEventListener("click",()=>{
   editingVideo=null;
   if(form)form.dataset.dirty="1";
   renderCurrentMedia();
  });
  $("#clearSelectedVideo")?.addEventListener("click",()=>{
   if(form?.elements.video)form.elements.video.value="";
   if(form)form.dataset.dirty="1";
   renderCurrentMedia();
  });
 }
}
function openProductEditor(productId){
 const modal=$("#productEditorModal"),slot=$("#productEditorModalSlot");
 const editor=$("#adminFormTitle")?.closest(".admin-card");
 const placeholder=$("#productEditorPlaceholder");
 if(!modal||!slot||!editor||!placeholder){status("No pudimos abrir el editor. Recarga el panel e inténtalo otra vez.","error");return;}
 productEditorReturnFocus=document.activeElement;
 if(editor.parentNode!==slot){
  if(placeholder.parentNode!==editor.parentNode)editor.parentNode.insertBefore(placeholder,editor);
  slot.appendChild(editor);
 }
 $("#productEditorModalTitle").textContent=productId==null?"Nuevo producto":"Editar producto #"+productId;
 editor.hidden=false;
 modal.hidden=false;modal.setAttribute("aria-hidden","false");
 document.body.classList.add("product-editor-open");
 $("#closeProductEditor")?.focus();
}
function closeProductEditor(force=false){
 const modal=$("#productEditorModal");
 if(!modal||modal.hidden)return;
 const form=$("#adminProductForm");
 if(!force&&form?.dataset.dirty==="1"&&!confirm("Tienes cambios sin guardar. ¿Cerrar el editor sin guardarlos?"))return;
 const editor=$("#adminFormTitle")?.closest(".admin-card");
 const placeholder=$("#productEditorPlaceholder");
 if(editor&&placeholder?.parentNode){
  placeholder.parentNode.insertBefore(editor,placeholder.nextSibling);
  editor.hidden=true;
 }
 modal.hidden=true;modal.setAttribute("aria-hidden","true");
 document.body.classList.remove("product-editor-open");
 if(productEditorReturnFocus?.isConnected)productEditorReturnFocus.focus();
 else $("#adminProductList")?.focus?.();
 productEditorReturnFocus=null;
 resetForm();
}
function editProduct(id){
 const p=products.find(x=>x.id===id);if(!p)return;const f=$("#adminProductForm");
 const categorySelect=f.elements.category;
 if(!Array.from(categorySelect.options).some(option=>option.value===p.category)){
  const option=document.createElement("option");option.value=p.category;option.textContent=p.category;categorySelect.add(option);
 }
 f.elements.id.value=p.id;f.elements.name.value=p.name;f.elements.category.value=p.category;f.elements.delivery_type.value=p.delivery_type;
 f.elements.price_cop.value=p.price_cop;f.elements.old_price_cop.value=p.old_price_cop??"";f.elements.stock_quantity.value=p.stock_quantity==null?"":p.stock_quantity;f.elements.sort_order.value=p.sort_order??100;
 f.elements.description.value=p.description||"";f.elements.features.value=(p.features||[]).join("\n");
 f.elements.tag.value=p.tag||"";f.elements.shipping.value=p.shipping||"";const configuredPaymentMethods=Array.isArray(p.payment_methods)?p.payment_methods:(p.delivery_type==="digital"?["bold"]:["bold","cash_on_delivery"]);f.querySelectorAll('input[name="payment_methods"]').forEach(input=>{input.checked=configuredPaymentMethods.includes(input.value);});syncPaymentMethodControls();f.elements.printful_enabled.checked=!!p.printful_enabled;f.elements.printful_sync_variant_id.value=p.printful_sync_variant_id??"";f.elements.is_active.checked=!!p.is_active;
 disposeEditingImagePreviews();editingImages=(p.images||[]).filter(Boolean).map(url=>({url,file:null,previewUrl:null}));editingVideo=p.video_url||null;disposeColorVariantPreviews();editingColorVariants=(Array.isArray(p.color_variants)?p.color_variants:[]).map(normalizeColorVariant);f.elements.images.value="";f.elements.video.value="";
 f.dataset.dirty="0";renderColorVariants();
 $("#adminFormTitle").textContent="Editar producto #"+p.id;
 $("#resetAdminForm").textContent="Cancelar edición";
 renderCurrentMedia();
 openProductEditor(p.id);
}
function resetForm(){
 const form=$("#adminProductForm");
 form.reset();syncPaymentMethodControls();form.elements.id.value="";form.elements.stock_quantity.value="";form.elements.sort_order.value="100";form.elements.printful_sync_variant_id.value="";form.elements.printful_enabled.checked=false;form.elements.is_active.checked=true;
 form.dataset.dirty="0";disposeEditingImagePreviews();editingImages=[];editingVideo=null;disposeColorVariantPreviews();editingColorVariants=[];renderColorVariants();
 $("#adminFormTitle").textContent="Añadir nuevo producto";
 $("#resetAdminForm").textContent="Limpiar";
 renderCurrentMedia();
}
async function save(e){
 e.preventDefault();const f=e.currentTarget;if(!f.reportValidity())return;
 const selectedPaymentMethods=Array.from(f.querySelectorAll('input[name="payment_methods"]:checked')).map(input=>input.value);
 if(!selectedPaymentMethods.length){status("Selecciona al menos una forma de pago.","error");return;}
 if(f.elements.delivery_type.value==="digital"&&(selectedPaymentMethods.length!==1||selectedPaymentMethods[0]!=="bold")){status("Los servicios digitales solo pueden habilitar el pago anticipado con Bold.","error");return;}
 if(f.elements.printful_enabled.checked&&!selectedPaymentMethods.includes("bold")){status("Printful requiere pago anticipado con Bold; habilita Bold para este producto.","error");return;}
 const submit=f.querySelector('[type="submit"]');submit.disabled=true;submit.textContent="Subiendo y guardando…";
 try{
  const videoFile=f.elements.video.files?.[0]||null;
  if(!editingImages.length)throw new Error("Sube al menos una foto del producto.");
  if(editingImages.length>8)throw new Error("Un producto admite máximo 8 imágenes; quita algunas fotos anteriores o selecciona menos.");
  for(const item of editingImages){if(item.file&&item.file.size>12*1024*1024)throw new Error("La imagen "+item.file.name+" supera 12 MB.");}
  if(videoFile&&videoFile.size>50*1024*1024)throw new Error("El video supera 50 MB.");
  if(editingColorVariants.length>12)throw new Error("Un producto admite hasta 12 variantes de color.");
  if(f.elements.printful_enabled.checked){
   if(editingColorVariants.length&&editingColorVariants.some(v=>!v.printful_sync_variant_id||!Number.isSafeInteger(Number(v.printful_sync_variant_id))||Number(v.printful_sync_variant_id)<=0))throw new Error("Para enviar una camisa con varios colores a Printful, añade el Sync Variant ID correspondiente a cada color.");
   if(!editingColorVariants.length&&(!f.elements.printful_sync_variant_id.value||!Number.isSafeInteger(Number(f.elements.printful_sync_variant_id.value))||Number(f.elements.printful_sync_variant_id.value)<=0))throw new Error("Para activar Printful, configura el Sync Variant ID del producto.");
  }
  const normalizedColorNames=editingColorVariants.map(v=>String(v.name||"").trim().toLocaleLowerCase("es"));
  if(normalizedColorNames.some(name=>!name))throw new Error("Escribe el nombre de cada color.");
  if(new Set(normalizedColorNames).size!==normalizedColorNames.length)throw new Error("No repitas el nombre de un color; usa nombres diferentes para cada variante.");
  for(const v of editingColorVariants){
   if(!/^#[0-9a-f]{6}$/i.test(v.hex||""))throw new Error("Selecciona una muestra de color válida.");
   if(v.printful_sync_variant_id!==""&&v.printful_sync_variant_id!=null&&(!Number.isSafeInteger(Number(v.printful_sync_variant_id))||Number(v.printful_sync_variant_id)<=0))throw new Error("El Sync Variant ID de Printful debe ser un entero positivo.");
   if(!(v.frontImage||v.frontFile)||!(v.backImage||v.backFile))throw new Error("Cada color necesita una foto frontal y otra trasera.");
   for(const file of [v.frontFile,v.backFile].filter(Boolean))if(file.size>12*1024*1024)throw new Error("Cada foto de color debe pesar máximo 12 MB.");
  }
  for(const item of editingImages){
   if(item.file){
    item.url=await upload(item.file);
    item.file=null;
    if(item.previewUrl){URL.revokeObjectURL(item.previewUrl);item.previewUrl=null;}
   }
  }
  renderCurrentMedia();
  if(videoFile)editingVideo=await upload(videoFile);
  const colorVariantsToSave=[];
  for(const variant of editingColorVariants){
   let front=variant.frontImage,back=variant.backImage;
   if(variant.frontFile)front=await upload(variant.frontFile);
   if(variant.backFile)back=await upload(variant.backFile);
   colorVariantsToSave.push({name:String(variant.name).trim(),hex:variant.hex,images:[front,back],printful_sync_variant_id:variant.printful_sync_variant_id?Number(variant.printful_sync_variant_id):null});
  }
  const payload=formData();payload.images=editingImages.map(item=>item.url).filter(Boolean);payload.video_url=editingVideo;payload.color_variants=colorVariantsToSave;
  const result=await call({action:"save",...payload});
  if(result.product){status("Producto guardado: "+result.product.name+". El catálogo de la tienda se actualizará al recargar.", "success");}
  resetForm();
  if(!$("#productEditorModal")?.hidden)closeProductEditor(true);
  await loadProducts();
 }catch(err){renderCurrentMedia();status(err.message||"No se pudo guardar el producto.","error");}
 finally{submit.disabled=false;submit.textContent="Guardar producto";}
}
async function deactivate(id){if(!confirm("¿Ocultar este producto de la tienda? El historial de pedidos se conservará."))return;try{await call({action:"deactivate",id});status("Producto ocultado de la tienda.","success");await loadProducts();}catch(e){status(e.message||"No se pudo ocultar el producto.","error");}}
async function init(){
 const productForm=$("#adminProductForm");
 productForm.addEventListener("submit",save);
 $("#addAdminColorVariant")?.addEventListener("click",()=>{
  if(editingColorVariants.length>=12){status("Puedes añadir máximo 12 colores por producto.","error");return;}
  editingColorVariants.push(normalizeColorVariant({name:"",hex:"#1f2937",images:[]}));
  productForm.dataset.dirty="1";renderColorVariants();
  $("#adminColorVariantsList .admin-color-variant-row:last-child input[data-variant-field=name]")?.focus();
 });
 productForm.addEventListener("input",()=>{if(productForm.elements.id.value)productForm.dataset.dirty="1";});
 productForm.addEventListener("change",event=>{
  if(productForm.elements.id.value)productForm.dataset.dirty="1";
  if(event.target===productForm.elements.delivery_type)syncPaymentMethodControls({resetPhysical:productForm.elements.delivery_type.value==="physical"});
  if(event.target===productForm.elements.printful_enabled)syncPaymentMethodControls();
  if(event.target===productForm.elements.video)renderCurrentMedia();
  if(event.target===productForm.elements.images)addProductImages(event.target);
 });
 syncPaymentMethodControls();
 $("#closeProductEditor")?.addEventListener("click",()=>closeProductEditor());
 document.querySelectorAll("[data-admin-tab]").forEach(button=>button.addEventListener("click",()=>setAdminSection(button.dataset.adminTab)));
 $("#addAdminProduct")?.addEventListener("click",()=>{resetForm();const editor=$("#adminFormTitle")?.closest(".admin-card");if(editor)editor.hidden=false;openProductEditor(null);});
 $("#productEditorModal")?.addEventListener("click",event=>{if(event.target.id==="productEditorModal")closeProductEditor();});
 document.addEventListener("keydown",event=>{if(event.key==="Escape")closeProductEditor();});$("#resetAdminForm").addEventListener("click",resetForm);$("#refreshAdminProducts").addEventListener("click",loadProducts);$("#refreshAdminMetrics")?.addEventListener("click",()=>loadAdminMetrics().catch(e=>status(e.message||"No se pudieron cargar las métricas.","error")));
 $("#refreshAdminOrders")?.addEventListener("click",()=>loadAdminOrders(true));
 $("#exportAdminOrders")?.addEventListener("click",exportAdminOrdersCsv);
 $("#refreshAdminCoupons")?.addEventListener("click",loadAdminCoupons);
 $("#adminCouponForm")?.addEventListener("submit",saveAdminCoupon);
 $("#resetAdminCoupon")?.addEventListener("click",()=>{const f=$("#adminCouponForm");f.reset();f.elements.id.value="";f.elements.minimum_subtotal_cop.value="0";f.elements.is_active.checked=true;couponNotice("Formulario listo para crear un nuevo cupón.");});
 $("#refreshAdminReviews")?.addEventListener("click",loadAdminReviews);
 $("#filterAdminOrders")?.addEventListener("click",()=>loadAdminOrders(true));
 $("#adminOrderStatusFilter")?.addEventListener("change",()=>loadAdminOrders(true));
 let searchField=$("#adminOrderSearch");
 searchField?.addEventListener("input",()=>{
  if(ordersSearchTimer)clearTimeout(ordersSearchTimer);
  ordersSearchTimer=setTimeout(()=>loadAdminOrders(true),300);
 });
 $("#adminOrdersWrap")?.addEventListener("click",event=>{
  const button=event.target.closest("[data-orders-page]");
  if(button&&!button.disabled)void changeAdminOrdersPage(button.dataset.ordersPage);
 });
 $("#loadMoreOrders")?.addEventListener("click",()=>loadAdminOrders(false));
 $("#adminInviteForm")?.addEventListener("submit",inviteUser);$("#refreshAdminUsers")?.addEventListener("click",loadAdminUsers);window.addEventListener("focus",syncAdminUsersWhenFocused);document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")syncAdminUsersWhenFocused();});$("#adminUserSearch")?.addEventListener("input",renderAdminUsers);$("#adminUserRoleFilter")?.addEventListener("change",renderAdminUsers);
 if(!db?.isConfigured?.()){status("Supabase no está conectado.","error");return;}
 const {data}=await db.client.auth.getSession();
 if(!data.session){status("Inicia sesión con una cuenta autorizada para administrar NovaShop.","error");return;}
 try{const me=await call({action:"whoami"});currentRole=me.role;configureRolePanels();}
 catch(e){status(e.message||"Tu cuenta no tiene permisos de administración.","error");return;}
 await loadProducts();
 if(["owner","admin"].includes(currentRole)){await Promise.all([loadAdminUsers(),loadAdminOrders(true)]);loadAdminCoupons();loadAdminReviews();}
 db.client.auth.onAuthStateChange((_event,s)=>{if(!s){products=[];adminUsers=[];renderProducts();status("Sesión cerrada.","error");location.href="cuenta.html?tab=login";}});
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();