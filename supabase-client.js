/* Supabase client shared by static pages. Browser only receives a publishable key. */
(() => {
 const cfg=window.NOVASHOP_SUPABASE_CONFIG||{},key=cfg.publishableKey||"";
 const configured=/^https:\/\//.test(cfg.url||"")&&key.startsWith("sb_publishable_");
 let client=null;
 if(configured&&window.supabase?.createClient)client=window.supabase.createClient(cfg.url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 async function createOrder(customer,items){
  if(!client)throw new Error("La base de datos no está conectada.");
  const {data:{session}}=await client.auth.getSession(),token=session?.access_token||key;
  const response=await fetch(cfg.url.replace(/\/$/,"")+(cfg.functionsPath||"/functions/v1/create-order"),{
   method:"POST",headers:{"Content-Type":"application/json","apikey":key,"Authorization":"Bearer "+token},
   body:JSON.stringify({customer,items})
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||"No se pudo registrar el pedido.");
  return result.order;
 }
 async function callBold(action,orderId){
  if(!client)throw new Error("Supabase no está conectado.");
  const {data:{session}}=await client.auth.getSession();
  const token=session?.access_token||key;
  const response=await fetch(cfg.url.replace(/\/$/,"")+"/functions/v1/bold-payments",{
   method:"POST",headers:{"Content-Type":"application/json","apikey":key,"Authorization":"Bearer "+token},
   body:JSON.stringify({action,order_id:String(orderId||"")})
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||"No pudimos conectar con la pasarela de Bold.");
  return result;
 }
 async function createBoldCheckout(orderId){return callBold("create-checkout",orderId);}
 async function verifyBoldPayment(orderId){return callBold("verify-checkout",orderId);}
 async function checkBoldConfigured(){
  const result=await callBold("status","");
  if(result.configured===true)return true;
  const names=Array.isArray(result.missing)?result.missing:[];
  const labels={
    BOLD_API_KEY:"BOLD_API_KEY (llave de identidad de Bold)",
    BOLD_SECRET_KEY:"BOLD_SECRET_KEY (llave secreta de Bold)",
    BOLD_ENVIRONMENT:"BOLD_ENVIRONMENT (debe ser test o live)"
  };
  const missing=names.map(name=>labels[name]||name);
  throw new Error("Bold aún no está configurado en Supabase. Falta configurar: "+(missing.length?missing.join(", "):"las llaves del comercio y el ambiente")+". Abre Supabase → Edge Functions → Secrets. No compartas tus llaves en el chat ni las publiques en GitHub.");
 }
 async function syncCatalog(localProducts){
  if(!client||!Array.isArray(localProducts))return localProducts;
  const {data,error}=await client.from("products").select("id,name,category,price_cop,delivery_type,is_active,updated_at,old_price_cop,description,images,video_url,features,rating,reviews,tag,shipping,sort_order,stock_quantity").eq("is_active",true).order("sort_order");
  if(error||!data)return localProducts;
  for(const row of data){
   let local=localProducts.find(p=>Number(p.id)===Number(row.id));
   const images=(row.images||[]).filter(Boolean);
   if(local){
    local.name=row.name;local.category=row.category;local.price=Number(row.price_cop);local.deliveryType=row.delivery_type;
    if(images.length){local.images=images;local.description=row.description||local.description;local.features=row.features||local.features;local.shipping=row.shipping||local.shipping;local.videoUrl=row.video_url||null;}
    if(row.old_price_cop!=null)local.oldPrice=Number(row.old_price_cop);
    else if(row.category==="Streaming")local.oldPrice=null;
    local.tag=row.category==="Streaming"?"DIGITAL":(row.old_price_cop!=null?(row.tag||"OFERTA"):(row.tag||local.tag||"DESTACADO"));
    local.sortOrder=row.sort_order;local.stockQuantity=row.stock_quantity==null?null:Number(row.stock_quantity);
   }else{
    localProducts.push({id:Number(row.id),name:row.name,category:row.category,price:Number(row.price_cop),
     oldPrice:row.old_price_cop==null?null:Number(row.old_price_cop),rating:row.rating==null?null:Number(row.rating),
     reviews:Number(row.reviews)||0,tag:row.category==="Streaming"?"DIGITAL":(row.old_price_cop!=null?(row.tag||"OFERTA"):(row.tag||"NUEVO")),
     images:images.length?images:["images/streaming-placeholder.svg"],description:row.description||"",
     features:row.features||[],shipping:row.shipping||"",videoUrl:row.video_url||null,
     deliveryType:row.delivery_type,sortOrder:row.sort_order,stockQuantity:row.stock_quantity==null?null:Number(row.stock_quantity)});
   }
  }
  return localProducts;
 }
 async function prefillCheckout(form){
  if(!client||!form)return;
  const {data:{session}}=await client.auth.getSession();if(!session?.user)return;
  const {data:p,error:profileError}=await client.from("profiles").select("*").eq("id",session.user.id).maybeSingle();
  if(profileError)console.warn("No se pudo leer el perfil para el checkout; se usarán los metadatos disponibles.",profileError.message);
  const metadata=session.user.user_metadata||{};
  const put=(name,value)=>{const el=form.elements[name];if(el&&value!=null&&value!==""&&!el.value)el.value=value;};
  const fullName=String(p?.full_name||metadata.full_name||"").trim();
  const splitAt=fullName.indexOf(" ");
  put("firstName",metadata.first_name||(splitAt<0?fullName:fullName.slice(0,splitAt)));
  put("lastName",metadata.last_name||(splitAt<0?"":fullName.slice(splitAt+1)));
  put("fullName",fullName);
  const value=(stored,backup)=>stored!=null&&String(stored).trim()!==""?stored:backup;
  for(const [name,saved,backup] of [
   ["phone",p?.phone,session.user.phone||metadata.phone],
   ["email",p?.email,session.user.email||metadata.email],
   ["address",p?.address,metadata.address],
   ["neighborhood",p?.neighborhood,metadata.neighborhood],
   ["city",p?.city,metadata.city],
   ["department",p?.department,metadata.department],
   ["postalCode",p?.postal_code,metadata.postal_code],
   ["reference",p?.delivery_reference,metadata.delivery_reference],
   ["deliveryReference",p?.delivery_reference,metadata.delivery_reference],
   ["latitude",p?.latitude,metadata.latitude],
   ["longitude",p?.longitude,metadata.longitude]
  ])put(name,value(saved,backup));
  form.dispatchEvent(new Event("novashop:profile-prefilled"));
 }

 const FAVORITES_KEY="novashop-favorites-v1";
 function localFavoriteIds(){try{const value=JSON.parse(localStorage.getItem(FAVORITES_KEY)||"[]");return Array.isArray(value)?value.map(Number).filter(Number.isFinite):[];}catch(_){return [];}}
 function saveLocalFavoriteIds(ids){try{localStorage.setItem(FAVORITES_KEY,JSON.stringify([...new Set(ids.map(Number).filter(Number.isFinite))]));}catch(_){}}
 async function getFavoriteIds(){
  const localIds=localFavoriteIds();
  const {data:{session}}=client?await client.auth.getSession():{data:{session:null}};
  if(!session?.user)return localIds;
  const {data,error}=await client.from("customer_favorites").select("product_id").eq("user_id",session.user.id);
  if(error){console.warn("No se pudieron sincronizar los favoritos; se usarán los guardados en este dispositivo.",error.message);return localIds;}
  const merged=new Set((data||[]).map(row=>Number(row.product_id)).filter(Number.isFinite));
  // Transfer guest favorites to the account once the customer signs in; keep existing cloud favorites.
  for(const id of localIds){
   if(merged.has(id))continue;
   const {error:insertError}=await client.from("customer_favorites").insert({user_id:session.user.id,product_id:id});
   if(!insertError||insertError.code==="23505")merged.add(id);
  }
  const ids=[...merged];
  saveLocalFavoriteIds(ids);return ids;
 }
 async function toggleFavorite(productId){
  const id=Number(productId);if(!Number.isInteger(id)||id<=0)throw new Error("Producto no válido.");
  const {data:{session}}=client?await client.auth.getSession():{data:{session:null}};
  if(session?.user){
   const {data:existing,error:readError}=await client.from("customer_favorites").select("product_id").eq("user_id",session.user.id).eq("product_id",id).maybeSingle();
   if(readError)throw readError;
   const local=localFavoriteIds();
   if(existing){
    const {error}=await client.from("customer_favorites").delete().eq("user_id",session.user.id).eq("product_id",id);if(error)throw error;
    saveLocalFavoriteIds(local.filter(value=>value!==id));
   }else{
    const {error}=await client.from("customer_favorites").insert({user_id:session.user.id,product_id:id});if(error)throw error;
    saveLocalFavoriteIds([...local,id]);
   }
   return await getFavoriteIds();
  }
  const ids=localFavoriteIds(),exists=ids.includes(id),next=exists?ids.filter(x=>x!==id):[...ids,id];
  saveLocalFavoriteIds(next);return next;
 }
 async function loginWithIdentifier(identifier,password){
  if(!client)throw new Error("Supabase no está conectado.");
  const value=String(identifier||"").trim();
  const isEmail=value.includes("@");
  const normalizedPhone=(()=>{
   let n=value.replace(/[^0-9+]/g,"");
   if(n.startsWith("+"))return n;
   if(n.startsWith("00"))return "+"+n.slice(2);
   n=n.replace(/\D/g,"");
   if(n.startsWith("57")&&n.length>=12)return "+"+n;
   return "+57"+n;
  })();
  // First try the native Auth identifier; only use the server alias lookup if the customer uses the other saved contact.
  const direct=await client.auth.signInWithPassword(isEmail?{email:value.toLowerCase(),password}:{phone:normalizedPhone,password});
  if(!direct.error)return direct.data;
  const url=cfg.url.replace(/\/$/,"")+"/functions/v1/auth-login";
  const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","apikey":key,"Authorization":"Bearer "+key},body:JSON.stringify({identifier:value,password})});
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result?.session)throw new Error(result?.error||"Correo/teléfono o contraseña incorrectos.");
  const {data,error}=await client.auth.setSession({access_token:result.session.access_token,refresh_token:result.session.refresh_token});
  if(error)throw error;
  return data;
 }
;
})();
