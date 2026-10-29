import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUCKET = "products-media";
const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  "image/avif": "avif", "image/gif": "gif", "video/mp4": "mp4",
  "video/webm": "webm", "video/quicktime": "mov"
};
const IMAGE_TYPES = new Set(["image/jpeg","image/png","image/webp","image/avif","image/gif"]);
const VIDEO_TYPES = new Set(["video/mp4","video/webm","video/quicktime"]);
const json = (body: unknown, status = 200, origin = "*") =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": origin,
      "Vary": "Origin",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    }
  });
const clean = (v: unknown, max = 3000) => String(v ?? "").trim().slice(0,max);
function parseKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try { const x = JSON.parse(raw); return typeof x.default === "string" ? x.default : undefined; }
  catch { return undefined; }
}
function safeMediaUrl(value: unknown, supabaseUrl: string, allowExternalImage = false): boolean {
  try {
    const u = new URL(String(value));
    if (u.protocol !== "https:") return false;
    const local = u.origin === supabaseUrl && u.pathname.startsWith("/storage/v1/object/public/" + BUCKET + "/");
    const unsplash = allowExternalImage && u.hostname === "images.unsplash.com";
    return local || unsplash;
  } catch { return false; }
}
function slug(name: string) {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
    .replace(/[^a-z0-9._-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,90) || "media";
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin") || "*";
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: {
      "Access-Control-Allow-Origin": origin, "Vary": "Origin",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    }
  });
  if (req.method !== "POST") return json({error:"Método no permitido."},405,origin);

  let currentAction = "";
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const publishable = parseKey(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")) || Deno.env.get("SUPABASE_ANON_KEY");
    const secret = parseKey(Deno.env.get("SUPABASE_SECRET_KEYS")) || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !publishable || !secret) {
      console.error("admin-products: required Supabase environment variables are missing");
      return json({error:"El servidor administrativo no está configurado."},500,origin);
    }
    const auth = req.headers.get("Authorization") || "";
    const token = auth.replace(/^Bearer\s+/i,"");
    if (!token || token === publishable || token.split(".").length !== 3) {
      return json({error:"Inicia sesión para acceder al panel de administración."},401,origin);
    }
    const admin = createClient(supabaseUrl, secret, {auth:{persistSession:false,autoRefreshToken:false}});
    const {data:userResult,error:userError} = await admin.auth.getUser(token);
    if (userError || !userResult.user) return json({error:"Tu sesión no es válida. Inicia sesión de nuevo."},401,origin);
    const user = userResult.user;
    const {data:roleRecord,error:roleError} = await admin.from("store_user_roles").select("role").eq("user_id",user.id).maybeSingle();
    if (roleError) throw roleError;
    const {data:legacyGrant,error:grantError} = await admin.from("store_admins").select("user_id").eq("user_id",user.id).maybeSingle();
    if (grantError) throw grantError;
    const role = roleRecord?.role || (legacyGrant ? "owner" : null);
    if (!role || role === "customer") return json({error:"Esta cuenta no tiene permisos para el panel administrativo."},403,origin);
    const isOwner = role === "owner";
    const canManageUsers = isOwner || role === "admin";
    const canEditCatalog = isOwner || role === "admin" || role === "catalog_manager";
    const canSeeMetrics = isOwner || role === "admin" || role === "analyst";

    const raw = await req.text();
    if (raw.length > 1_500_000) return json({error:"La solicitud excede el tamaño permitido."},413,origin);
    let body: any;
    try { body = JSON.parse(raw); } catch { return json({error:"Solicitud JSON no válida."},400,origin); }
    const action = String(body?.action || "");
    currentAction = action;

    if (action === "whoami") return json({ok:true,isAdmin:true,userId:user.id,email:user.email || null,role},200,origin);

    if (action === "list-coupons") {
      if (!canManageUsers) return json({error:"Solo propietario y administrador pueden gestionar cupones."},403,origin);
      const {data,error} = await admin.from("coupons").select("*").order("created_at",{ascending:false}).limit(200);
      if (error) throw error;
      return json({ok:true,coupons:data||[]},200,origin);
    }

    if (action === "save-coupon") {
      if (!canManageUsers) return json({error:"Solo propietario y administrador pueden gestionar cupones."},403,origin);
      const id = clean(body.id,50);
      const code = clean(body.code,32).toUpperCase();
      const description = clean(body.description,180);
      const discountType = clean(body.discount_type,20);
      const discountValue = Number(body.discount_value);
      const minimum = Number(body.minimum_subtotal_cop||0);
      const maxUses = body.max_uses==null || body.max_uses==="" ? null : Number(body.max_uses);
      const startsAt = body.starts_at ? new Date(body.starts_at) : new Date();
      const endsAt = body.ends_at ? new Date(body.ends_at) : null;
      const isActive = body.is_active !== false;
      if (!/^[A-Z0-9_-]{3,32}$/.test(code)) return json({error:"El código debe tener entre 3 y 32 caracteres: letras, números, guion o guion bajo."},400,origin);
      if (!["percent","fixed"].includes(discountType) || !Number.isSafeInteger(discountValue) || discountValue<1 || (discountType==="percent"&&discountValue>100) || (discountType==="fixed"&&discountValue>100000000)) {
        return json({error:"El descuento no es válido. Usa un porcentaje entre 1 y 100 o un valor fijo en pesos."},400,origin);
      }
      if (!Number.isSafeInteger(minimum)||minimum<0||minimum>100000000) return json({error:"El mínimo de compra no es válido."},400,origin);
      if (maxUses!==null&&(!Number.isSafeInteger(maxUses)||maxUses<1||maxUses>100000000)) return json({error:"El límite de usos debe ser un entero positivo o quedar vacío."},400,origin);
      if (Number.isNaN(startsAt.getTime())||(endsAt&&Number.isNaN(endsAt.getTime()))||(endsAt&&endsAt<=startsAt)) return json({error:"Revisa las fechas de inicio y vencimiento del cupón."},400,origin);
      const payload = {code,description,discount_type:discountType,discount_value:discountValue,minimum_subtotal_cop:minimum,max_uses:maxUses,starts_at:startsAt.toISOString(),ends_at:endsAt?endsAt.toISOString():null,is_active:isActive,updated_at:new Date().toISOString()};
      const query = id
        ? admin.from("coupons").update(payload).eq("id",id).select("*").single()
        : admin.from("coupons").insert(payload).select("*").single();
      const {data,error}=await query;
      if(error) {
        if(error.code==="23505") return json({error:"Ya existe un cupón con ese código."},409,origin);
        throw error;
      }
      return json({ok:true,coupon:data},200,origin);
    }

    if (action === "list-reviews") {
      if (!canManageUsers) return json({error:"Solo propietario y administrador pueden moderar reseñas."},403,origin);
      const {data,error}=await admin.from("product_reviews").select("id,product_id,user_id,rating,title,body,is_approved,created_at,products(name)").order("created_at",{ascending:false}).limit(200);
      if(error) throw error;
      const ids=[...new Set((data||[]).map((r:any)=>r.user_id))];
      const {data:profiles,error:profileError}=ids.length
        ? await admin.from("profiles").select("id,full_name,email").in("id",ids)
        : {data:[],error:null};
      if(profileError) throw profileError;
      const map=new Map((profiles||[]).map((p:any)=>[p.id,p]));
      return json({ok:true,reviews:(data||[]).map((r:any)=>({...r,customer_name:map.get(r.user_id)?.full_name||map.get(r.user_id)?.email||"Cliente"}))},200,origin);
    }

    if (action === "set-review-status") {
      if (!canManageUsers) return json({error:"Solo propietario y administrador pueden moderar reseñas."},403,origin);
      const id=clean(body.id,50);
      if(!/^[0-9a-f-]{36}$/i.test(id))return json({error:"Identificador de reseña no válido."},400,origin);
      const isApproved=body.is_approved===true;
      const {data,error}=await admin.from("product_reviews").update({is_approved:isApproved,updated_at:new Date().toISOString()}).eq("id",id).select("id,is_approved").single();
      if(error)throw error;
      return json({ok:true,review:data},200,origin);
    }

    if (action === "update-order-shipping") {
      if (!canManageUsers) return json({error:"Solo propietario y administrador pueden gestionar envíos."},403,origin);
      const orderId=clean(body.order_id,50);
      const carrier=clean(body.shipping_carrier,80);
      const tracking=clean(body.tracking_number,100);
      const eta=clean(body.estimated_delivery_date,10);
      const feeRaw=body.shipping_fee_cop;
      const fee=feeRaw===null||feeRaw===undefined||String(feeRaw).trim()===""?null:Number(feeRaw);
      const shippingPaid=body.shipping_paid===true;
      if(!/^[0-9a-f-]{36}$/i.test(orderId))return json({error:"Identificador de pedido no válido."},400,origin);
      if(carrier.length>80||tracking.length>100||(eta&&!/^\d{4}-\d{2}-\d{2}$/.test(eta)))return json({error:"Revisa la transportadora, guía y fecha estimada."},400,origin);
      if(fee!==null&&(!Number.isSafeInteger(fee)||fee<0||fee>100000000))return json({error:"El costo del envío debe ser un importe entero entre $0 y $100.000.000."},400,origin);
      const {data:current,error:lookupError}=await admin.from("orders")
        .select("id,order_number,payment_provider,delivery_type,shipping_fee_cop,shipping_payment_status,cash_on_delivery_due_cop,shipping_payment_reference").eq("id",orderId).maybeSingle();
      if(lookupError)throw lookupError;
      if(!current)return json({error:"No encontramos ese pedido."},404,origin);
      if(current.delivery_type==="digital")return json({error:"Los pedidos digitales no requieren una transportadora."},400,origin);

      let shippingFee: number|null=fee;
      let shippingPaymentStatus="pending";
      const fixedCODFreight = current.payment_provider==="cash_on_delivery" && current.cash_on_delivery_due_cop!==null && current.cash_on_delivery_due_cop!==undefined;
      if(current.payment_provider==="bold"){
        shippingFee=0;
        shippingPaymentStatus="not_required";
      }else if(fixedCODFreight){
        if(fee!==12000)return json({error:"El anticipo de envío de estos pedidos está fijado en $12.000 COP y no se puede cambiar manualmente."},400,origin);
        if(shippingPaid && current.shipping_payment_status!=="approved")return json({error:"El anticipo de $12.000 solo puede marcarse como pagado después de que Bold confirme el pago."},409,origin);
        if(!shippingPaid && current.shipping_payment_status==="approved")return json({error:"El pago de flete ya fue confirmado por Bold y no puede desmarcarse aquí."},409,origin);
        shippingFee=12000;
        shippingPaymentStatus=current.shipping_payment_status==="approved"?"approved":"pending";
      }else{
        if(shippingFee===0)return json({error:"Los pedidos contraentrega no tienen envío gratis; registra el costo real de la transportadora."},400,origin);
        if(shippingPaid&&shippingFee===null)return json({error:"Registra primero el costo del flete antes de marcarlo como pagado."},400,origin);
        shippingPaymentStatus=shippingPaid?"approved":"pending";
      }
      const {data:updated,error}=await admin.from("orders").update({
        shipping_carrier:carrier||null,
        tracking_number:tracking||null,
        estimated_delivery_date:eta||null,
        shipping_fee_cop:shippingFee,
        shipping_payment_status:shippingPaymentStatus,
        updated_at:new Date().toISOString()
      }).eq("id",orderId).select("id,order_number,payment_provider,shipping_carrier,tracking_number,estimated_delivery_date,shipping_fee_cop,shipping_payment_status,updated_at").single();
      if(error)throw error;
      return json({ok:true,order:updated,message:shippingPaymentStatus==="not_required"?"Envío gratis con pago en línea Bold.":(fixedCODFreight?(shippingPaymentStatus==="approved"?"Anticipo de envío de $12.000 pagado y confirmado por Bold.":"Datos guardados; el anticipo de $12.000 sigue pendiente de pago por Bold."):shippingPaymentStatus==="approved"?"Datos guardados; flete marcado como pagado.":"Cotización de envío guardada; falta registrar el pago anticipado del flete.")},200,origin);
    }

    if (action === "list-orders") {
      if (!canManageUsers) return json({error:"Solo propietario y administrador pueden consultar pedidos."},403,origin);
      const allowedStatuses = new Set(["pending_payment","paid","preparing","shipped","delivered","cancelled","payment_failed","refunded"]);
      const requestedStatus = clean(body.status,40);
      const requestedSearch = clean(body.search,100)
        .replace(/[^\p{L}\p{N}@.+\- ]/gu," ")
        .replace(/\s+/g," ").trim();
      const limit = Math.max(1,Math.min(100,Math.trunc(Number(body.limit)||40)));
      const offset = Math.max(0,Math.min(100000,Math.trunc(Number(body.offset)||0)));
      if (requestedStatus && requestedStatus !== "all" && !allowedStatuses.has(requestedStatus)) {
        return json({error:"Filtro de estado no válido."},400,origin);
      }
      let query = admin.from("orders").select(
        "id,order_number,user_id,status,payment_status,payment_provider,payment_reference,currency,subtotal_cop,discount_cop,total_cop,coupon_code,delivery_type,customer_first_name,customer_last_name,customer_email,customer_phone,address,neighborhood,city,department,postal_code,delivery_reference,preferred_payment_method,customer_note,shipping_carrier,tracking_number,estimated_delivery_date,shipping_fee_cop,shipping_payment_status,cash_on_delivery_due_cop,shipping_payment_reference,shipping_payment_transaction_id,shipped_at,delivered_at,created_at,updated_at,latitude,longitude,order_items(id,product_id,product_name,quantity,unit_price_cop,line_total_cop,delivery_type,selected_variant,selected_size)",
        {count:"exact"}
      );
      if (requestedStatus && requestedStatus !== "all") query = query.eq("status",requestedStatus);
      if (requestedSearch) {
        const safeSearch = requestedSearch.replace(/\\/g,"\\\\").replace(/"/g,'\\"');
        const pattern = '"%' + safeSearch + '%"';
        query = query.or([
          "order_number.ilike."+pattern,
          "customer_first_name.ilike."+pattern,
          "customer_last_name.ilike."+pattern,
          "customer_email.ilike."+pattern,
          "customer_phone.ilike."+pattern,
          "city.ilike."+pattern
        ].join(","));
      }
      query = query.order("created_at",{ascending:false}).range(offset,offset+limit-1);
      const {data,error,count} = await query;
      if (error) throw error;
      const rows = data || [];
      const orderItems = rows.flatMap((order: any)=>Array.isArray(order.order_items)?order.order_items:[]);
      const orderItemIds = orderItems.map((item: any)=>Number(item.id)).filter((value: number)=>Number.isSafeInteger(value));
      const relatedProductIds = [...new Set(orderItems.map((item: any)=>Number(item.product_id)).filter((value: number)=>Number.isSafeInteger(value)))];
      const dropiByOrderItem = new Map<number,string>();
      const dropiByProduct = new Map<number,string>();
      if (orderItemIds.length) {
        const {data:refs,error:refsError} = await admin.from("order_item_supplier_refs").select("order_item_id,dropi_product_id").in("order_item_id",orderItemIds);
        if (refsError) throw refsError;
        for (const ref of refs || []) dropiByOrderItem.set(Number(ref.order_item_id),String(ref.dropi_product_id || ""));
      }
      if (relatedProductIds.length) {
        const {data:refs,error:refsError} = await admin.from("product_supplier_refs").select("product_id,dropi_product_id").in("product_id",relatedProductIds);
        if (refsError) throw refsError;
        for (const ref of refs || []) dropiByProduct.set(Number(ref.product_id),String(ref.dropi_product_id || ""));
      }
      for (const item of orderItems) item.dropi_product_id = dropiByOrderItem.get(Number(item.id)) || dropiByProduct.get(Number(item.product_id)) || null;
      return json({ok:true,orders:rows,offset,limit,hasMore:offset+rows.length<(count||0),totalCount:count??rows.length},200,origin);
    }

    if (action === "update-order-status") {
      if (!canManageUsers) return json({error:"Solo propietario y administrador pueden actualizar pedidos."},403,origin);
      const orderId = clean(body.order_id,50);
      const nextStatus = clean(body.status,40);
      const allowedStatuses = new Set(["pending_payment","paid","preparing","shipped","delivered","cancelled","payment_failed","refunded"]);
      if (!/^[0-9a-f-]{36}$/i.test(orderId)) return json({error:"Identificador de pedido no válido."},400,origin);
      if (!allowedStatuses.has(nextStatus)) return json({error:"Selecciona un estado válido."},400,origin);
      const {data:currentOrder,error:lookupError} = await admin.from("orders")
        .select("id,status,payment_status,payment_provider,shipping_fee_cop,shipping_payment_status,order_number,shipped_at,delivered_at").eq("id",orderId).maybeSingle();
      if (lookupError) throw lookupError;
      if (!currentOrder) return json({error:"No encontramos ese pedido."},404,origin);
      if (["cancelled","refunded","payment_failed"].includes(currentOrder.status) && nextStatus !== currentOrder.status) {
        return json({error:"Este pedido ya está cerrado y no se puede reactivar. Si el cliente quiere comprar de nuevo, crea un nuevo pedido."},409,origin);
      }
      if (nextStatus === "pending_payment" && ["approved","refunded"].includes(currentOrder.payment_status)) {
        return json({error:"Este pedido ya tiene un pago aprobado o reembolsado y no puede volver a pendiente de pago."},409,origin);
      }
      if (nextStatus === "paid" && currentOrder.payment_provider === "cash_on_delivery") {
        return json({error:"En contraentrega, el producto se paga al recibirlo. Marca el pedido como Entregado cuando hayas confirmado la entrega y el cobro del producto."},409,origin);
      }
      if (["shipped","delivered"].includes(nextStatus) && currentOrder.payment_provider === "cash_on_delivery" &&
          (!(Number(currentOrder.shipping_fee_cop)>0) || currentOrder.shipping_payment_status !== "approved")) {
        return json({error:"No se puede despachar o marcar como entregado un pedido contraentrega hasta registrar el costo del flete y verificar que fue pagado por anticipado a la transportadora."},409,origin);
      }
      const now=new Date().toISOString();
      const update:any = {status:nextStatus,updated_at:now};
      if (nextStatus==="shipped"&&!currentOrder.shipped_at) update.shipped_at=now;
      if (nextStatus==="delivered"&&!currentOrder.delivered_at) update.delivered_at=now;
      if (nextStatus === "paid" || nextStatus === "delivered" ||
          (["preparing","shipped"].includes(nextStatus) && currentOrder.payment_provider !== "cash_on_delivery")) {
        update.payment_status = "approved";
      } else if (nextStatus === "payment_failed") update.payment_status = "rejected";
      else if (nextStatus === "refunded") update.payment_status = "refunded";
      else if (nextStatus === "cancelled" && currentOrder.payment_status !== "approved") update.payment_status = "cancelled";
      else if (nextStatus === "pending_payment") update.payment_status = "pending";
      const {data:updated,error:updateError} = await admin.from("orders").update(update)
        .eq("id",orderId).select("id,order_number,status,payment_status,payment_provider,shipping_fee_cop,shipping_payment_status,updated_at").single();
      if (updateError) throw updateError;
      return json({ok:true,order:updated,message:"Estado del pedido actualizado."},200,origin);
    }

    if (action === "update-user") {
      if (!canManageUsers) return json({error:"Solo owner/admin pueden editar usuarios."},403,origin);
      const targetId = clean(body.user_id,50);
      if (!/^[0-9a-f-]{36}$/i.test(targetId)) return json({error:"Identificador de usuario no válido."},400,origin);
      if (targetId === user.id) return json({error:"Edita tus propios datos desde Mi perfil para evitar cambios de acceso accidentales."},409,origin);
      const [targetRoleResult,targetLegacyResult,targetAuthResult] = await Promise.all([
        admin.from("store_user_roles").select("role").eq("user_id",targetId).maybeSingle(),
        admin.from("store_admins").select("user_id").eq("user_id",targetId).maybeSingle(),
        admin.auth.admin.getUserById(targetId)
      ]);
      if (targetRoleResult.error) throw targetRoleResult.error;
      if (targetLegacyResult.error) throw targetLegacyResult.error;
      if (targetAuthResult.error || !targetAuthResult.data?.user) return json({error:"La cuenta ya no existe en Supabase Authentication. Actualiza la lista."},404,origin);
      const targetRole = targetRoleResult.data?.role || (targetLegacyResult.data ? "owner" : "customer");
      if (targetRole === "owner") return json({error:"La cuenta propietaria está protegida."},409,origin);
      if (targetRole === "admin" && !isOwner) return json({error:"Solo el propietario puede editar la cuenta de otro administrador."},403,origin);
      const fullName = clean(body.full_name,100);
      const email = clean(body.email,120).toLowerCase();
      const username = clean(body.username,60);
      const phone = clean(body.phone,30);
      const address = clean(body.address,250);
      const neighborhood = clean(body.neighborhood,120);
      const city = clean(body.city,100);
      const department = clean(body.department,100);
      const postalCode = clean(body.postal_code,20);
      if (!fullName) return json({error:"El nombre completo es obligatorio."},400,origin);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({error:"Introduce un correo electrónico válido."},400,origin);
      if (username && !/^[a-zA-Z0-9._-]{3,60}$/.test(username)) return json({error:"El usuario debe tener entre 3 y 60 caracteres: letras, números, punto, guion o guion bajo."},400,origin);
      const currentAuthUser = targetAuthResult.data.user;
      const currentEmail = String(currentAuthUser.email || "").toLowerCase();
      if (email !== currentEmail && !isOwner) return json({error:"Solo el propietario puede cambiar el correo de acceso."},403,origin);
      const meta = {...(currentAuthUser.user_metadata || {}), full_name:fullName};
      const authPatch:any = {user_metadata:meta};
      if (email !== currentEmail) authPatch.email = email;
      const {error:authUpdateError} = await admin.auth.admin.updateUserById(targetId,authPatch);
      if (authUpdateError) {
        const msg = String(authUpdateError.message || "").toLowerCase();
        if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) return json({error:"Ese correo ya está asociado a otra cuenta."},409,origin);
        throw authUpdateError;
      }
      const deliveryReference = clean(body.delivery_reference,220);
      const profilePayload = {id:targetId,full_name:fullName,email,username:username || null,phone,
        address:address || null,delivery_reference:deliveryReference || null,neighborhood:neighborhood || null,city:city || null,
        department:department || null,postal_code:postalCode || null,updated_at:new Date().toISOString()};
      const {data:profile,error:profileError} = await admin.from("profiles")
        .upsert(profilePayload,{onConflict:"id"}).select("id,full_name,email,username,phone,address,neighborhood,city,department,postal_code").single();
      if (profileError) throw profileError;
      return json({ok:true,user:{id:targetId,...profile,auth_email:email},message:"Datos del usuario actualizados."},200,origin);
    }

    if (action === "delete-user") {
      if (!isOwner) return json({error:"Solo el propietario puede eliminar cuentas de usuario."},403,origin);
      const targetId = clean(body.user_id,50);
      if (!/^[0-9a-f-]{36}$/i.test(targetId)) return json({error:"Identificador de usuario no válido."},400,origin);
      if (targetId === user.id) return json({error:"No puedes eliminar la cuenta con la que has iniciado sesión."},409,origin);
      const [targetRoleResult,targetLegacyResult,targetAuthResult] = await Promise.all([
        admin.from("store_user_roles").select("role").eq("user_id",targetId).maybeSingle(),
        admin.from("store_admins").select("user_id").eq("user_id",targetId).maybeSingle(),
        admin.auth.admin.getUserById(targetId)
      ]);
      if (targetRoleResult.error) throw targetRoleResult.error;
      if (targetLegacyResult.error) throw targetLegacyResult.error;
      if (targetAuthResult.error || !targetAuthResult.data?.user) return json({error:"La cuenta ya no existe en Supabase Authentication. Actualiza la lista; si solo borraste el perfil, la cuenta de acceso sigue activa."},404,origin);
      const targetRole = targetRoleResult.data?.role || (targetLegacyResult.data ? "owner" : "customer");
      if (targetRole === "owner") return json({error:"La cuenta propietaria está protegida y no se puede eliminar desde este panel."},409,origin);
      const {error:deleteError} = await admin.auth.admin.deleteUser(targetId,false);
      if (deleteError) {
        const msg = String(deleteError.message || "").toLowerCase();
        if (msg.includes("storage") || msg.includes("object")) return json({error:"No se pudo eliminar la cuenta porque todavía es propietaria de archivos en Supabase Storage. Reasigna o elimina esos archivos y vuelve a intentarlo."},409,origin);
        throw deleteError;
      }
      return json({ok:true,user_id:targetId,removed_email:targetAuthResult.data.user.email || null,
        message:"Cuenta eliminada de Supabase Authentication. El perfil, los roles, los favoritos y las reseñas asociados se eliminan; los pedidos históricos se conservan sin vincularlos al usuario y pueden mantener los datos necesarios para respaldar esas compras."},200,origin);
    }

    if (action === "list-users") {
      if (!canManageUsers) return json({error:"Solo owner/admin pueden administrar usuarios y roles."},403,origin);
      const allUsers:any[] = [];
      for (let page = 1; page <= 10; page++) {
        const {data,error} = await admin.auth.admin.listUsers({page,perPage:200});
        if (error) throw error;
        const batch = data?.users || [];
        allUsers.push(...batch);
        if (batch.length < 200) break;
      }
      const ids = allUsers.map((u:any)=>u.id);
      if (!ids.length) return json({ok:true,users:[]},200,origin);
      const [rolesResult,profilesResult,legacyResult,ordersResult] = await Promise.all([
        admin.from("store_user_roles").select("user_id,role,created_at").in("user_id",ids),
        admin.from("profiles").select("id,full_name,username,phone,email,address,neighborhood,city,department,postal_code,delivery_reference,latitude,longitude").in("id",ids),
        admin.from("store_admins").select("user_id").in("user_id",ids),
        admin.from("orders").select("user_id,status,payment_status,subtotal_cop,discount_cop,total_cop").in("user_id",ids).limit(50000)
      ]);
      if (rolesResult.error) throw rolesResult.error;
      if (profilesResult.error) throw profilesResult.error;
      if (legacyResult.error) throw legacyResult.error;
      if (ordersResult.error) throw ordersResult.error;
      const roleMap = new Map((rolesResult.data||[]).map((x:any)=>[x.user_id,x.role]));
      const profileMap = new Map((profilesResult.data||[]).map((x:any)=>[x.id,x]));
      const legacy = new Set((legacyResult.data||[]).map((x:any)=>x.user_id));
      const orderMap = new Map<string,any>();
      for (const order of ordersResult.data||[]) {
        if (!order.user_id) continue;
        const row:any=orderMap.get(order.user_id)||{order_count:0,paid_orders:0,lifetime_spend_cop:0};
        row.order_count++;
        if (order.payment_status==="approved") {
          row.paid_orders++;
          row.lifetime_spend_cop+=Number(order.total_cop ?? (Number(order.subtotal_cop||0)-Number(order.discount_cop||0)));
        }
        orderMap.set(order.user_id,row);
      }
      const users = allUsers.map((u:any)=>{
        const p:any = profileMap.get(u.id) || {};
        const stats:any=orderMap.get(u.id)||{order_count:0,paid_orders:0,lifetime_spend_cop:0};
        return {id:u.id,email:u.email || p.email || null,phone:p.phone ?? u.phone ?? null,
          full_name:p.full_name || u.user_metadata?.full_name || "",
          username:p.username || "",address:p.address || "",neighborhood:p.neighborhood || "",
          city:p.city || "",department:p.department || "",postal_code:p.postal_code || "",
          delivery_reference:p.delivery_reference || "",latitude:p.latitude ?? null,longitude:p.longitude ?? null,
          order_count:stats.order_count,paid_orders:stats.paid_orders,lifetime_spend_cop:stats.lifetime_spend_cop,
          role:roleMap.get(u.id) || (legacy.has(u.id)?"owner":"customer"),
          created_at:u.created_at,last_sign_in_at:u.last_sign_in_at || null,
          email_confirmed:!!u.email_confirmed_at,phone_confirmed:!!u.phone_confirmed_at};
      });
      return json({ok:true,users},200,origin);
    }

    if (action === "invite-user") {
      if (!canManageUsers) return json({error:"Solo owner/admin pueden crear usuarios."},403,origin);
      const email = clean(body.email,120).toLowerCase();
      const fullName = clean(body.full_name,100);
      const wantedRole = clean(body.role,30);
      if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) return json({error:"Introduce un correo válido."},400,origin);
      if (!fullName) return json({error:"Introduce el nombre del usuario."},400,origin);
      if (!["admin","catalog_manager","analyst","customer"].includes(wantedRole)) return json({error:"Selecciona un rol válido."},400,origin);
      if (wantedRole === "admin" && !isOwner) return json({error:"Solo el propietario puede conceder el rol admin."},403,origin);
      const {data:inviteData,error:inviteError} = await admin.auth.admin.inviteUserByEmail(email,{
        data:{full_name:fullName},
        redirectTo:"https://adrianmarin05.github.io/novashop/cuenta.html"
      });
      if (inviteError) throw inviteError;
      const newUser = inviteData?.user;
      if (!newUser?.id) return json({error:"Supabase no devolvió el usuario invitado."},500,origin);
      const {error:profileError} = await admin.from("profiles").upsert({
        id:newUser.id,full_name:fullName,email,username:null,updated_at:new Date().toISOString()
      },{onConflict:"id"});
      if (profileError) throw profileError;
      const {error:roleSaveError} = await admin.from("store_user_roles").upsert({
        user_id:newUser.id,role:wantedRole,granted_by:user.id,updated_at:new Date().toISOString()
      },{onConflict:"user_id"});
      if (roleSaveError) throw roleSaveError;
      if (wantedRole === "customer") await admin.from("store_admins").delete().eq("user_id",newUser.id);
      else {
        const {error:legacySaveError} = await admin.from("store_admins").upsert({user_id:newUser.id,granted_by:user.id},{onConflict:"user_id"});
        if (legacySaveError) throw legacySaveError;
      }
      return json({ok:true,user:{id:newUser.id,email:newUser.email,full_name:fullName,role:wantedRole},message:"Invitación creada. El usuario deberá abrir el correo y completar el acceso."},201,origin);
    }

    if (action === "set-role") {
      if (!canManageUsers) return json({error:"Solo owner/admin pueden asignar roles."},403,origin);
      const targetId = clean(body.user_id,50);
      const wantedRole = clean(body.role,30);
      if (!/^[0-9a-f-]{36}$/i.test(targetId)) return json({error:"Identificador de usuario no válido."},400,origin);
      if (!["admin","catalog_manager","analyst","customer"].includes(wantedRole)) return json({error:"Selecciona un rol válido."},400,origin);
      if (wantedRole === "admin" && !isOwner) return json({error:"Solo el propietario puede conceder el rol admin."},403,origin);
      if (targetId === user.id) return json({error:"No puedes cambiar tu propio rol desde esta pantalla."},409,origin);
      const {data:targetRole,error:targetRoleError} = await admin.from("store_user_roles").select("role").eq("user_id",targetId).maybeSingle();
      if (targetRoleError) throw targetRoleError;
      const {data:targetLegacy,error:targetLegacyError} = await admin.from("store_admins").select("user_id").eq("user_id",targetId).maybeSingle();
      if (targetLegacyError) throw targetLegacyError;
      const oldRole = targetRole?.role || (targetLegacy ? "owner" : "customer");
      if (oldRole === "owner") return json({error:"El propietario está protegido; no se puede cambiar su rol desde el panel."},409,origin);
      if (oldRole === "admin" && !isOwner) return json({error:"Solo el propietario puede cambiar el rol de otro administrador."},403,origin);
      const {error:saveError} = await admin.from("store_user_roles").upsert({
        user_id:targetId,role:wantedRole,granted_by:user.id,updated_at:new Date().toISOString()
      },{onConflict:"user_id"});
      if (saveError) throw saveError;
      if (wantedRole === "customer") {
        const {error:deleteError} = await admin.from("store_admins").delete().eq("user_id",targetId);
        if (deleteError) throw deleteError;
      } else {
        const {error:grantSaveError} = await admin.from("store_admins").upsert({user_id:targetId,granted_by:user.id},{onConflict:"user_id"});
        if (grantSaveError) throw grantSaveError;
      }
      return json({ok:true,user_id:targetId,role:wantedRole},200,origin);
    }

    if (action === "set-user-password") {
      if (!isOwner) return json({error:"Solo el propietario puede establecer contraseñas de usuarios."},403,origin);
      const targetId = clean(body.user_id,50);
      const password = typeof body.password === "string" ? body.password : "";
      if (!/^[0-9a-f-]{36}$/i.test(targetId)) return json({error:"Identificador de usuario no válido."},400,origin);
      if (targetId === user.id) return json({error:"Por seguridad, esta herramienta es solo para restablecer la contraseña de otro usuario."},409,origin);
      if (password.length < 12 || password.length > 128 || !password.trim()) {
        return json({error:"La contraseña temporal debe tener entre 12 y 128 caracteres."},400,origin);
      }
      const [targetRoleResult,targetLegacyResult] = await Promise.all([
        admin.from("store_user_roles").select("role").eq("user_id",targetId).maybeSingle(),
        admin.from("store_admins").select("user_id").eq("user_id",targetId).maybeSingle()
      ]);
      if (targetRoleResult.error) throw targetRoleResult.error;
      if (targetLegacyResult.error) throw targetLegacyResult.error;
      const targetRole = targetRoleResult.data?.role || (targetLegacyResult.data ? "owner" : "customer");
      if (targetRole === "owner") return json({error:"La cuenta propietaria está protegida y no se puede restablecer desde esta herramienta."},409,origin);
      const {data:updatedUser,error:updateError} = await admin.auth.admin.updateUserById(targetId,{password});
      if (updateError) throw updateError;
      if (!updatedUser?.user?.id) return json({error:"Supabase no confirmó la actualización de la contraseña."},500,origin);
      return json({ok:true,user_id:targetId,message:"Contraseña temporal actualizada."},200,origin);
    }

    if (action === "list") {
      if (!canEditCatalog && role !== "analyst") return json({error:"No tienes permiso para ver el catálogo administrativo."},403,origin);
      const {data,error} = await admin.from("products").select("*").order("sort_order",{ascending:true}).order("id",{ascending:true});
      if (error) throw error;
      const productRows = data || [];
      const productIds = productRows.map((product: any)=>Number(product.id)).filter((value: number)=>Number.isSafeInteger(value));
      const dropiByProduct = new Map<number,string>();
      if (productIds.length) {
        const {data:refs,error:refsError} = await admin.from("product_supplier_refs").select("product_id,dropi_product_id").in("product_id",productIds);
        if (refsError) throw refsError;
        for (const ref of refs || []) dropiByProduct.set(Number(ref.product_id),String(ref.dropi_product_id || ""));
      }
      return json({ok:true,products:productRows.map((product: any)=>({...product,dropi_product_id:dropiByProduct.get(Number(product.id)) || ""}))},200,origin);
    }

    if (action === "metrics") {
      if (!canSeeMetrics) return json({error:"No tienes permiso para consultar métricas de ventas."},403,origin);
      let startDate: Date | null = null;
      let endDate: Date | null = null;
      if (body.start_date) {
        const parsed = new Date(String(body.start_date));
        if (Number.isNaN(parsed.getTime())) return json({error:"Fecha inicial no válida."},400,origin);
        startDate = parsed;
      }
      if (body.end_date) {
        const parsed = new Date(String(body.end_date));
        if (Number.isNaN(parsed.getTime())) return json({error:"Fecha final no válida."},400,origin);
        endDate = parsed;
      }
      if (startDate && endDate && startDate > endDate) return json({error:"El período de fechas no es válido."},400,origin);
      let orderQuery = admin.from("orders")
        .select("id,status,payment_status,subtotal_cop,discount_cop,total_cop,customer_email,created_at")
        .order("created_at",{ascending:false}).limit(10000);
      if (startDate) orderQuery = orderQuery.gte("created_at",startDate.toISOString());
      if (endDate) orderQuery = orderQuery.lte("created_at",endDate.toISOString());
      const [ordersResult, itemsResult, productsResult] = await Promise.all([
        orderQuery,
        admin.from("order_items").select("order_id,product_id,product_name,quantity,unit_price_cop,line_total_cop").limit(50000),
        admin.from("products").select("id,name,category,stock_quantity,is_active,price_cop").order("id",{ascending:true}).limit(10000)
      ]);
      if (ordersResult.error) throw ordersResult.error;
      if (itemsResult.error) throw itemsResult.error;
      if (productsResult.error) throw productsResult.error;
      const orders = ordersResult.data || [];
      const items = itemsResult.data || [];
      const products = productsResult.data || [];
      const paidOrders = orders.filter((o: any) => o.payment_status === "approved");
      const paidOrderIds = new Set(paidOrders.map((o: any) => o.id));
      const revenueCop = paidOrders.reduce((n: number, o: any) => n + Number(o.total_cop ?? (Number(o.subtotal_cop || 0) - Number(o.discount_cop || 0))), 0);
      const confirmedItems = items.filter((it: any) => paidOrderIds.has(it.order_id));
      const unitsSold = confirmedItems.reduce((n: number, it: any) => n + Number(it.quantity || 0), 0);
      const productById = new Map(products.map((p: any) => [Number(p.id), p]));
      const mix = new Map();
      for (const it of confirmedItems) {
        const id = Number(it.product_id);
        const p: any = productById.get(id);
        const key = String(id);
        const row: any = mix.get(key) || {productId:id,name:it.product_name || p?.name || "Producto",category:p?.category || "Otra",units:0,revenueCop:0};
        row.units += Number(it.quantity || 0);
        row.revenueCop += Number(it.line_total_cop ?? (Number(it.unit_price_cop || 0) * Number(it.quantity || 0)));
        mix.set(key,row);
      }
      const salesMix = Array.from(mix.values())
        .map((p: any) => ({...p,percentage:unitsSold ? Math.round((p.units / unitsSold) * 1000) / 10 : 0}))
        .sort((a: any,b: any) => b.units-a.units)
        .slice(0,15);
      const categoryMap = new Map();
      for (const it of confirmedItems) {
        const p: any = productById.get(Number(it.product_id));
        const category = p?.category || "Otra";
        const row: any = categoryMap.get(category) || {category,units:0,revenueCop:0};
        row.units += Number(it.quantity || 0);
        row.revenueCop += Number(it.line_total_cop ?? (Number(it.unit_price_cop || 0) * Number(it.quantity || 0)));
        categoryMap.set(category,row);
      }
      const categoryMix = Array.from(categoryMap.values())
        .map((p: any) => ({...p,percentage:unitsSold ? Math.round((p.units / unitsSold) * 1000) / 10 : 0}))
        .sort((a: any,b: any) => b.units-a.units);
      const emailCounts = new Map<string,number>();
      for (const o of paidOrders) {
        const email = String(o.customer_email||"").trim().toLowerCase();
        if (email) emailCounts.set(email,(emailCounts.get(email)||0)+1);
      }
      const repeatCustomers = Array.from(emailCounts.values()).filter((count:number)=>count>=2).length;
      const cancelledOrders = orders.filter((o:any)=>o.status==="cancelled").length;
      const discountsCop = paidOrders.reduce((n:number,o:any)=>n+Number(o.discount_cop||0),0);
      const active = products.filter((p: any) => p.is_active);
      const tracked = active.filter((p: any) => p.stock_quantity !== null && p.stock_quantity !== undefined);
      const outOfStock = tracked.filter((p: any) => Number(p.stock_quantity) === 0);
      const lowStock = tracked.filter((p: any) => Number(p.stock_quantity) > 0 && Number(p.stock_quantity) <= 5);
      const untracked = active.filter((p: any) => p.stock_quantity === null || p.stock_quantity === undefined);
      const pendingOrders = orders.filter((o: any) => o.status === "pending_payment" || o.payment_status === "pending").length;
      return json({ok:true,metrics:{
        revenueCop,discountsCop,paidOrders:paidOrders.length,unitsSold,pendingOrders,cancelledOrders,repeatCustomers,
        periodStart:startDate?.toISOString()||null,periodEnd:endDate?.toISOString()||null,
        inventory:{activeProducts:active.length,trackedProducts:tracked.length,untrackedProducts:untracked.length,
          trackedUnits:tracked.reduce((n: number,p: any)=>n+Number(p.stock_quantity||0),0),
          lowStockProducts:lowStock.map((p: any)=>({id:p.id,name:p.name,stock_quantity:p.stock_quantity})),
          outOfStockProducts:outOfStock.map((p: any)=>({id:p.id,name:p.name,stock_quantity:p.stock_quantity}))},
        salesMix,categoryMix
      }},200,origin);
    }

    if (action === "upload-url") {
      if (!canEditCatalog) return json({error:"No tienes permiso para subir medios de productos."},403,origin);
      const filename = clean(body.filename,180);
      const type = clean(body.contentType,100).toLowerCase();
      const size = Number(body.size);
      if (!MIME_EXT[type]) return json({error:"Tipo de archivo no permitido."},400,origin);
      if (!Number.isFinite(size) || size <= 0 || size > 50*1024*1024) return json({error:"El archivo no puede superar 50 MB."},413,origin);
      if (IMAGE_TYPES.has(type) && size > 12*1024*1024) return json({error:"Las imágenes no pueden superar 12 MB."},413,origin);
      if (VIDEO_TYPES.has(type) && size > 50*1024*1024) return json({error:"El video no puede superar 50 MB."},413,origin);
      const path = user.id + "/" + Date.now() + "-" + crypto.randomUUID() + "-" + slug(filename) + "." + MIME_EXT[type];
      const {data,error} = await admin.storage.from(BUCKET).createSignedUploadUrl(path,{upsert:false});
      if (error) throw error;
      const publicUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      return json({ok:true,path:data.path || path,token:data.token,publicUrl},200,origin);
    }

    if (action === "save") {
      if (!canEditCatalog) return json({error:"No tienes permiso para editar productos."},403,origin);
      const id = body.id == null || body.id === "" ? null : Number(body.id);
      const name = clean(body.name,140);
      const category = clean(body.category,80);
      const delivery = clean(body.delivery_type,20);
      const dropiProductId = clean(body.dropi_product_id,100).replace(/\s+/g," ").trim();
      const rawPaymentMethods = Array.isArray(body.payment_methods)
        ? body.payment_methods.map((value: unknown)=>clean(value,40)).filter(Boolean)
        : (delivery === "digital" ? ["bold"] : ["bold","cash_on_delivery"]);
      const paymentMethods = [...new Set(rawPaymentMethods)];
      if (!paymentMethods.length || paymentMethods.some((method: string)=>!["bold","cash_on_delivery"].includes(method))) {
        return json({error:"Selecciona al menos una forma de pago válida."},400,origin);
      }
      if (delivery === "digital" && (paymentMethods.length !== 1 || paymentMethods[0] !== "bold")) {
        return json({error:"Los servicios digitales solo admiten pago anticipado con Bold."},400,origin);
      }
      const price = Number(body.price_cop);
      const oldPrice = body.old_price_cop == null || body.old_price_cop === "" ? null : Number(body.old_price_cop);
      const description = clean(body.description,4000);
      const features = Array.isArray(body.features) ? body.features.map((v: unknown)=>clean(v,180)).filter(Boolean).slice(0,30) : [];
      const images = Array.isArray(body.images) ? body.images.map((v: unknown)=>clean(v,1000)).filter(Boolean).slice(0,8) : [];
      const rawColorVariants = Array.isArray(body.color_variants) ? body.color_variants : [];
      if (rawColorVariants.length > 12) return json({error:"Un producto admite hasta 12 variantes de color."},400,origin);
      const colorVariants = rawColorVariants.map((item: any)=>({
        name:clean(item?.name,40),
        hex:clean(item?.hex,7).toLowerCase(),
        images:Array.isArray(item?.images)?item.images.map((v: unknown)=>clean(v,1000)).filter(Boolean).slice(0,2):[],
        printful_sync_variant_id:item?.printful_sync_variant_id==null||item?.printful_sync_variant_id===""?null:Number(item.printful_sync_variant_id)
      }));
      const seenColorNames = new Set<string>();
      for (const variant of colorVariants) {
        const key=variant.name.toLocaleLowerCase("es");
        if (!variant.name || !/^#[0-9a-f]{6}$/.test(variant.hex)) return json({error:"Cada variante debe tener un nombre y una muestra de color válidos."},400,origin);
        if (seenColorNames.has(key)) return json({error:"No repitas el nombre de un color."},400,origin);
        seenColorNames.add(key);
        if (variant.printful_sync_variant_id!==null && (!Number.isSafeInteger(variant.printful_sync_variant_id)||variant.printful_sync_variant_id<=0)) return json({error:"El Printful Sync Variant ID por color debe ser un entero positivo."},400,origin);
        if (variant.images.length < 1 || variant.images.some((url: string)=>!safeMediaUrl(url,supabaseUrl,false))) return json({error:"Cada color necesita al menos una foto válida almacenada en NovaShop. La foto trasera es opcional."},400,origin);
      }
      const printfulEnabled = body.printful_enabled === true;
      const printfulRaw = body.printful_sync_variant_id == null || body.printful_sync_variant_id === "" ? null : Number(body.printful_sync_variant_id);
      if (printfulRaw !== null && (!Number.isSafeInteger(printfulRaw) || printfulRaw <= 0)) return json({error:"El Printful Sync Variant ID debe ser un entero positivo."},400,origin);
      if (printfulEnabled && !colorVariants.length && printfulRaw === null) return json({error:"Para activar el envío automático a Printful, configura primero el Sync Variant ID del producto."},400,origin);
      if (printfulEnabled && !paymentMethods.includes("bold")) return json({error:"Los productos enviados mediante Printful requieren pago anticipado con Bold."},400,origin);
      if (printfulEnabled && paymentMethods.includes("cash_on_delivery")) return json({error:"Los productos enviados mediante Printful deben usar solo pago anticipado con Bold; desactiva la contraentrega."},400,origin);
      if (printfulEnabled && colorVariants.length && colorVariants.some((variant: any)=>variant.printful_sync_variant_id===null)) return json({error:"Para activar el envío automático a Printful, configura el Sync Variant ID de cada color."},400,origin);
      const video = body.video_url == null || body.video_url === "" ? null : clean(body.video_url,1000);
      const tag = clean(body.tag,30);
      const shipping = clean(body.shipping,500);
      const active = body.is_active !== false;
      const sortOrder = Number.isFinite(Number(body.sort_order)) ? Math.trunc(Number(body.sort_order)) : 100;
      const stockRaw = body.stock_quantity;
      const stock = stockRaw === null || stockRaw === undefined || stockRaw === "" ? null : Number(stockRaw);
      if (!name || !category || !description) return json({error:"Completa nombre, categoría y descripción."},400,origin);
      if (!Number.isSafeInteger(price) || price <= 0 || price > 100_000_000) return json({error:"El precio no es válido."},400,origin);
      if (oldPrice !== null && (!Number.isSafeInteger(oldPrice) || oldPrice < price || oldPrice > 100_000_000)) return json({error:"El precio anterior debe ser mayor o igual al precio actual."},400,origin);
      if (stock !== null && (!Number.isSafeInteger(stock) || stock < 0 || stock > 10000000)) return json({error:"El stock debe ser un número entero entre 0 y 10.000.000, o dejarse vacío para no controlarlo."},400,origin);
      if (!["physical","digital"].includes(delivery)) return json({error:"El tipo de entrega no es válido."},400,origin);
      if (images.length < 1 || images.some((v: string)=>!safeMediaUrl(v,supabaseUrl,true))) return json({error:"Añade al menos una imagen válida de Supabase Storage o Unsplash."},400,origin);
      if (video && !safeMediaUrl(video,supabaseUrl,false)) return json({error:"El video debe estar alojado en el bucket de medios de NovaShop."},400,origin);
      if (id !== null && (!Number.isInteger(id) || id <= 0)) return json({error:"Identificador de producto no válido."},400,origin);

      const payload = {
        name,category,delivery_type:delivery,price_cop:price,old_price_cop:oldPrice,
        description,features,images,color_variants:colorVariants,video_url:video,tag,shipping,payment_methods:paymentMethods,is_active:active,sort_order:sortOrder,
        stock_quantity:stock,printful_enabled:printfulEnabled,printful_sync_variant_id:printfulRaw,updated_at:new Date().toISOString()
      };
      const query = id === null
        ? admin.from("products").insert(payload).select("*").single()
        : admin.from("products").update(payload).eq("id",id).select("*").single();
      const {data,error} = await query;
      if (error) throw error;
      if (!data) return json({error:"No encontramos el producto que intentabas editar."},404,origin);
      if (dropiProductId) {
        const {error:dropiRefError} = await admin.from("product_supplier_refs").upsert(
          {product_id:data.id,dropi_product_id:dropiProductId,updated_at:new Date().toISOString()},
          {onConflict:"product_id"}
        );
        if (dropiRefError) {
          if (String((dropiRefError as any).code || "") === "23505") return json({error:"Ese ID de Dropi ya está asociado a otro producto de NovaShop. Revisa el ID que copiaste."},409,origin);
          throw dropiRefError;
        }
        const {data:historicItems,error:historicError} = await admin.from("order_items").select("id").eq("product_id",data.id);
        if (historicError) throw historicError;
        if (historicItems?.length) {
          const snapshots = historicItems.map((item: any)=>({order_item_id:item.id,dropi_product_id:dropiProductId}));
          const {error:snapshotError} = await admin.from("order_item_supplier_refs").upsert(snapshots,{onConflict:"order_item_id",ignoreDuplicates:true});
          if (snapshotError) throw snapshotError;
        }
      } else {
        const {error:dropiRefError} = await admin.from("product_supplier_refs").delete().eq("product_id",data.id);
        if (dropiRefError) throw dropiRefError;
      }
      return json({ok:true,product:{...data,dropi_product_id:dropiProductId}},200,origin);
    }

    if (action === "deactivate") {
      if (!canEditCatalog) return json({error:"No tienes permiso para ocultar productos."},403,origin);
      const id = Number(body.id);
      if (!Number.isInteger(id) || id <= 0) return json({error:"Identificador de producto no válido."},400,origin);
      const {data,error} = await admin.from("products").update({is_active:false,updated_at:new Date().toISOString()}).eq("id",id).select("id,name,is_active").maybeSingle();
      if (error) throw error;
      if (!data) return json({error:"No encontramos ese producto."},404,origin);
      return json({ok:true,product:data},200,origin);
    }

    return json({error:"Acción no reconocida."},400,origin);
  } catch (e) {
    const errorText=String((e as any)?.message||"");
    console.error("admin-products error:",e);
    if (errorText.includes("NOVASHOP_STOCK_INSUFFICIENT")) {
      return json({error:"No se puede confirmar este pedido: el inventario disponible ya no alcanza. Revisa el stock o contacta al cliente."},409,origin);
    }
    if (currentAction === "save" && errorText) {
      const code=String((e as any)?.code||"");
      if (code === "23505") return json({error:"No se pudo guardar: existe un producto con un dato único duplicado. Revisa el identificador y vuelve a intentarlo."},409,origin);
      return json({error:"No se pudo guardar el producto. Detalle: "+errorText.replace(/\\s+/g," ").slice(0,220)},500,origin);
    }
    if (currentAction === "upload-url" && errorText) {
      return json({error:"No se pudo preparar la subida del archivo. Detalle: "+errorText.replace(/\\s+/g," ").slice(0,220)},500,origin);
    }
    return json({error:"No pudimos completar la operación administrativa. Revisa la configuración y vuelve a intentarlo."},500,origin);
  }
});
