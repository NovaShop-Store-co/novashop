import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });
const clean = (value: unknown, max = 180) =>
  String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const emailOk = (value: string) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

function defaultKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed.default === "string" ? parsed.default : undefined;
  } catch {
    return undefined;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const publicKey =
      defaultKey(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")) ||
      Deno.env.get("SUPABASE_ANON_KEY");
    const secretKey =
      defaultKey(Deno.env.get("SUPABASE_SECRET_KEYS")) ||
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !publicKey || !secretKey) {
      console.error("Supabase Edge Function missing required environment variables.");
      return json({ error: "La función de pedidos no está configurada correctamente en Supabase." }, 500);
    }

    const rawBody = await req.text();
    if (rawBody.length > 24000) return json({ error: "El pedido es demasiado grande." }, 413);
    let body: any;
    try { body = JSON.parse(rawBody); } catch { return json({ error: "El formato del pedido no es válido." }, 400); }

    const c = body?.customer ?? {};
    const couponCode = clean(c.couponCode ?? body?.couponCode, 32).toUpperCase();
    let firstName = clean(c.firstName, 60);
    let lastName = clean(c.lastName, 60);
    let email = clean(c.email, 120).toLowerCase();
    let phone = clean(c.phone, 24);
    let address = clean(c.address, 160);
    let neighborhood = clean(c.neighborhood, 80);
    let city = clean(c.city, 80);
    let department = clean(c.department, 80);
    let postalCode = clean(c.postalCode, 16);
    let reference = clean(c.reference, 220);
    const paymentMethod = clean(c.paymentMethod, 80);
    const allowedPaymentMethods = new Set(["Pago en línea con Bold", "Contraentrega"]);
    if (!allowedPaymentMethods.has(paymentMethod)) {
      return json({ error: "Selecciona Pago en línea con Bold o Contraentrega." }, 400);
    }
    const isBoldPayment = paymentMethod === "Pago en línea con Bold";
    let latitude = c.latitude == null || c.latitude === "" ? null : Number(c.latitude);
    let longitude = c.longitude == null || c.longitude === "" ? null : Number(c.longitude);
    const itemsInput = body?.items;

    if (!Array.isArray(itemsInput) || itemsInput.length < 1 || itemsInput.length > 25) {
      return json({ error: "El pedido debe contener entre 1 y 25 productos distintos." }, 400);
    }
    const items: any[] = itemsInput.map((x: any) => ({
      product_id: Number(x?.product_id),
      quantity: Number(x?.quantity),
      selected_variant: clean(x?.selected_variant,40),
      selected_size: clean(x?.selected_size,24),
      selected_audience: clean(x?.selected_audience,20).toLowerCase()
    }));
    if (items.some((x: any) => !Number.isInteger(x.product_id) || !Number.isInteger(x.quantity) || x.quantity < 1 || x.quantity > 10 ||
      (x.selected_audience && !["hombre","mujer"].includes(x.selected_audience)))) {
      return json({ error: "Hay productos, cortes o cantidades no válidos." }, 400);
    }
    if (new Set(items.map((x: any) => [x.product_id,x.selected_audience,x.selected_variant.toLocaleLowerCase("es"),x.selected_size.toLocaleLowerCase("es")].join("::"))).size !== items.length) {
      return json({ error: "Hay productos duplicados con la misma combinación de corte, color y talla en el pedido." }, 400);
    }
    if (items.reduce((n: number, x: any) => n + x.quantity, 0) > 50) {
      return json({ error: "La cantidad total excede el límite por pedido." }, 400);
    }

    // A guest may use the public key. If a customer sends a JWT, verify it with Auth.
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    let userId: string | null = null;
    let authenticatedUser: any = null;
    let customerEmailVerified = false;
    let customerPhoneVerified = false;
    if (token && token !== publicKey && token !== Deno.env.get("SUPABASE_ANON_KEY")) {
      if (token.split(".").length !== 3) return json({ error: "La autorización enviada no es válida." }, 401);
      const authClient = createClient(supabaseUrl, publicKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: userData, error: userError } = await authClient.auth.getUser(token);
      if (userError || !userData.user) {
        return json({ error: "Tu sesión no es válida. Inicia sesión de nuevo o continúa como invitado." }, 401);
      }
      userId = userData.user.id;
      authenticatedUser = userData.user;
      customerEmailVerified = !!userData.user.email_confirmed_at;
      customerPhoneVerified = !!userData.user.phone_confirmed_at;
    }

    const admin = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // For a signed-in customer, use the saved profile whenever checkout fields are blank.
    // Fields explicitly entered at checkout stay in place in case the customer is delivering to another address.
    if (userId) {
      const { data: profile, error: profileError } = await admin.from("profiles")
        .select("full_name,phone,email,address,neighborhood,city,department,postal_code,delivery_reference,latitude,longitude")
        .eq("id", userId).maybeSingle();
      if (profileError) throw profileError;
      // Profile table is the source of truth; user metadata is a backup for fields missing from older profiles.
      const metadata = authenticatedUser?.user_metadata || {};
      const savedName = clean(profile?.full_name || metadata.full_name, 120);
      const split = savedName.indexOf(" ");
      const fallbackFirst = clean(metadata.first_name || (split < 0 ? savedName : savedName.slice(0, split)), 60);
      const fallbackLast = clean(metadata.last_name || (split < 0 ? "" : savedName.slice(split + 1)), 60);
      if (!firstName) firstName = fallbackFirst;
      if (!lastName) lastName = fallbackLast;
      phone = phone || clean(profile?.phone || authenticatedUser?.phone || metadata.phone, 24);
      email = (email || clean(profile?.email || authenticatedUser?.email || metadata.email, 120)).toLowerCase();
      address = address || clean(profile?.address || metadata.address, 160);
      neighborhood = neighborhood || clean(profile?.neighborhood || metadata.neighborhood, 80);
      city = city || clean(profile?.city || metadata.city, 80);
      department = department || clean(profile?.department || metadata.department, 80);
      postalCode = postalCode || clean(profile?.postal_code || metadata.postal_code, 16);
      reference = reference || clean(profile?.delivery_reference || metadata.delivery_reference, 220);
      if (latitude === null) {
        const savedLatitude = profile?.latitude ?? metadata.latitude;
        if (savedLatitude != null && savedLatitude !== "") latitude = Number(savedLatitude);
      }
      if (longitude === null) {
        const savedLongitude = profile?.longitude ?? metadata.longitude;
        if (savedLongitude != null && savedLongitude !== "") longitude = Number(savedLongitude);
      }
    }

    if (!firstName || !lastName || phone.length < 7 || !emailOk(email)) {
      return json({ error: "Revisa nombres, apellidos, teléfono y correo." }, 400);
    }
    const coordsProvided = latitude !== null || longitude !== null;
    if (coordsProvided && (latitude === null || longitude === null || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180)) {
      return json({ error: "Las coordenadas de entrega no son válidas." }, 400);
    }

    // Mild anti-duplicate protection per email. It does not replace payment-provider fraud controls.
    if (email) {
      const since = new Date(Date.now() - 60_000).toISOString();
      const { count, error: recentError } = await admin
        .from("orders").select("id", { count: "exact", head: true })
        .eq("customer_email", email).gt("created_at", since);
      if (recentError) throw recentError;
      if ((count ?? 0) >= 5) return json({ error: "Recibimos varios pedidos seguidos con ese correo. Espera un minuto y vuelve a intentarlo." }, 429);
    }

    const ids = items.map((x: any) => x.product_id);
    const { data: catalog, error: catalogError } = await admin
      .from("products").select("id,name,price_cop,delivery_type,is_active,stock_quantity,color_variants,size_variants,printful_enabled,printful_sync_variant_id,payment_methods")
      .in("id", ids).eq("is_active", true);
    if (catalogError) throw catalogError;
    if (!catalog || catalog.length !== new Set(ids).size) {
      return json({ error: "Uno de los productos ya no está disponible." }, 409);
    }
    const {data:dropiRefs,error:dropiRefsError} = await admin.from("product_supplier_refs")
      .select("product_id,dropi_product_id").in("product_id",ids);
    if (dropiRefsError) throw dropiRefsError;
    const dropiByProductId = new Map<number,string>((dropiRefs || []).map((ref: any)=>[Number(ref.product_id),String(ref.dropi_product_id || "")]));

    const {data:productVariantRows,error:productVariantError} = await admin.from("product_variants")
      .select("id,product_id,audience,color,size,stock_quantity,is_active").in("product_id",ids);
    if (productVariantError) throw productVariantError;
    const dropiVariantsByProduct = new Map<number,any[]>();
    for (const variant of productVariantRows||[]) {
      const list = dropiVariantsByProduct.get(Number(variant.product_id))||[];
      list.push(variant);
      dropiVariantsByProduct.set(Number(variant.product_id),list);
    }
    const productVariantIds = (productVariantRows||[]).map((variant: any)=>Number(variant.id));
    const dropiByVariantId = new Map<number,string>();
    if (productVariantIds.length) {
      const {data:variantRefs,error:variantRefsError} = await admin.from("product_variant_supplier_refs")
        .select("product_variant_id,dropi_variant_id").in("product_variant_id",productVariantIds);
      if (variantRefsError) throw variantRefsError;
      for (const ref of variantRefs||[]) dropiByVariantId.set(Number(ref.product_variant_id),String(ref.dropi_variant_id||""));
    }
    for (const item of items) {
      const productVariants = dropiVariantsByProduct.get(item.product_id)||[];
      if (!productVariants.length) {
        if (item.selected_audience) return json({error:"El corte seleccionado para el producto no tiene variantes configuradas. Vuelve a cargar la página y selecciona de nuevo."},409);
        continue;
      }
      const chosen = productVariants.find((variant: any)=>variant.is_active===true &&
        String(variant.audience||"").toLowerCase()===item.selected_audience &&
        String(variant.color||"").trim().toLocaleLowerCase("es")===item.selected_variant.toLocaleLowerCase("es") &&
        String(variant.size||"").trim().toLocaleLowerCase("es")===item.selected_size.toLocaleLowerCase("es"));
      if (!item.selected_audience || !item.selected_variant || !item.selected_size || !chosen) {
        return json({error:"Selecciona un corte, color y talla disponibles para "+clean((catalog||[]).find((p: any)=>Number(p.id)===item.product_id)?.name||"uno de los productos",140)+"."},409);
      }
      const dropiVariantId = dropiByVariantId.get(Number(chosen.id));
      if (!dropiVariantId) {
        return json({error:"La variante seleccionada no está vinculada a un ID de Dropi. Contacta a la tienda antes de pagar."},409);
      }
      item.product_variant_id = Number(chosen.id);
      item.dropi_variant_id = dropiVariantId;
      item.variant_stock_quantity = Number(chosen.stock_quantity);
    }

    const catalogById = new Map(catalog.map((p: any) => [p.id, p]));
    const unavailablePaymentItem = items.find((item: any) => {
      const p: any = catalogById.get(item.product_id);
      const methods = Array.isArray(p?.payment_methods) && p.payment_methods.length
        ? p.payment_methods
        : (p?.delivery_type === "digital" ? ["bold"] : ["bold","cash_on_delivery"]);
      return isBoldPayment ? !methods.includes("bold") : !methods.includes("cash_on_delivery");
    });
    if (unavailablePaymentItem) {
      const p: any = catalogById.get(unavailablePaymentItem.product_id);
      return json({
        error: isBoldPayment
          ? "El producto " + clean(p?.name || "seleccionado",140) + " no admite pago anticipado con Bold. Ajusta el carrito o realiza pedidos separados."
          : "El producto " + clean(p?.name || "seleccionado",140) + " no admite contraentrega. Elige pago con Bold o realiza pedidos separados."
      },400);
    }
    const invalidVariant = items.find((item: any) => {
      const p: any = catalogById.get(item.product_id);
      if ((dropiVariantsByProduct.get(item.product_id)||[]).length) return false;
      const variants = Array.isArray(p?.color_variants) ? p.color_variants : [];
      if (variants.length) return !item.selected_variant || !variants.some((v: any) => clean(v?.name,40).toLocaleLowerCase("es") === item.selected_variant.toLocaleLowerCase("es"));
      return !!item.selected_variant;
    });
    if (invalidVariant) {
      const p: any = catalogById.get(invalidVariant.product_id);
      return json({error:"Selecciona un color válido para "+clean(p?.name||"uno de los productos",140)+"."},400);
    }
    const invalidSize = items.find((item: any)=>{
      const p: any = catalogById.get(item.product_id);
      if ((dropiVariantsByProduct.get(item.product_id)||[]).length) return false;
      const sizes = Array.isArray(p?.size_variants) ? p.size_variants.map((value: any)=>clean(value,24).toLocaleLowerCase("es")) : [];
      if (sizes.length) return !item.selected_size || !sizes.includes(item.selected_size.toLocaleLowerCase("es"));
      return !!item.selected_size;
    });
    if (invalidSize) {
      const p: any = catalogById.get(invalidSize.product_id);
      return json({error:"Selecciona una talla válida para "+clean(p?.name||"uno de los productos",140)+"."},400);
    }
    const missingPrintfulMapping = items.find((item: any) => {
      const p: any = catalogById.get(item.product_id);
      if (!p?.printful_enabled) return false;
      const variants = Array.isArray(p.color_variants) ? p.color_variants : [];
      if (variants.length) {
        const chosen = variants.find((v: any) => clean(v?.name,40) === item.selected_variant);
        const syncId = Number(chosen?.printful_sync_variant_id);
        return !Number.isSafeInteger(syncId) || syncId <= 0;
      }
      const syncId = Number(p.printful_sync_variant_id);
      return !Number.isSafeInteger(syncId) || syncId <= 0;
    });
    if (missingPrintfulMapping) {
      const p: any = catalogById.get(missingPrintfulMapping.product_id);
      return json({error:"El producto "+clean(p?.name||"seleccionado",140)+" está configurado para Printful, pero falta el Sync Variant ID del color elegido."},400);
    }
    const quantityByProduct = new Map<number, number>();
    for (const item of items) quantityByProduct.set(item.product_id,(quantityByProduct.get(item.product_id)||0)+item.quantity);
    const quantityByVariant = new Map<number,number>();
    for (const item of items) if (item.product_variant_id) {
      const id = Number(item.product_variant_id);
      quantityByVariant.set(id,(quantityByVariant.get(id)||0)+item.quantity);
    }
    const outOfStockVariant = items.find((item: any)=>{
      if (!item.product_variant_id) return false;
      return (quantityByVariant.get(Number(item.product_variant_id))||0)>Number(item.variant_stock_quantity);
    });
    if (outOfStockVariant) {
      const p: any = catalogById.get(outOfStockVariant.product_id);
      return json({error:"No hay existencias suficientes para "+clean(p?.name||"el producto",140)+" · "+(outOfStockVariant.selected_audience==="mujer"?"Dama":"Hombre")+" · "+outOfStockVariant.selected_variant+" · "+outOfStockVariant.selected_size+"."},409);
    }
    const outOfStock = items.find((item: any) => {
      if ((dropiVariantsByProduct.get(item.product_id)||[]).length) return false;
      const product: any = catalogById.get(item.product_id);
      const requested = quantityByProduct.get(item.product_id)||0;
      return product && product.stock_quantity !== null && product.stock_quantity !== undefined
        && requested > Number(product.stock_quantity);
    });
    if (outOfStock) {
      const product: any = catalogById.get(outOfStock.product_id);
      return json({ error: "Stock insuficiente para " + clean(product?.name || "uno de los productos", 140) + ". Unidades solicitadas entre todos los colores: " + (quantityByProduct.get(outOfStock.product_id)||0) + "; disponibles: " + Number(product?.stock_quantity || 0) + "." }, 409);
    }
    let subtotal = 0;
    const lines = items.map((item: any) => {
      const p: any = catalogById.get(item.product_id);
      subtotal += Number(p.price_cop) * item.quantity;
      const variants = Array.isArray(p.color_variants) ? p.color_variants : [];
      const chosenColor = variants.find((v: any) => clean(v?.name,40) === item.selected_variant);
      const rawSyncId = p.printful_enabled
        ? (variants.length ? chosenColor?.printful_sync_variant_id : p.printful_sync_variant_id)
        : null;
      const syncVariantId = rawSyncId == null || rawSyncId === "" ? null : Number(rawSyncId);
      return {
        product_id: p.id, product_name: p.name, unit_price_cop: p.price_cop,
        quantity: item.quantity, delivery_type: p.delivery_type,
        selected_variant: item.selected_variant || null,
        selected_size: item.selected_size || null,
        selected_audience: item.selected_audience || null,
        printful_sync_variant_id: syncVariantId,
      };
    });
    if (!Number.isSafeInteger(subtotal) || subtotal <= 0 || subtotal > 100_000_000) {
      return json({ error: "No se pudo validar el total del pedido." }, 400);
    }

    let discountCop = 0;
    let usedCoupon: any = null;
    if (couponCode) {
      if (!/^[A-Z0-9_-]{3,32}$/.test(couponCode)) {
        return json({ error: "El código del cupón no tiene un formato válido." }, 400);
      }
      const { data: coupon, error: couponError } = await admin.from("coupons")
        .select("id,code,discount_type,discount_value,minimum_subtotal_cop,max_uses,uses_count,starts_at,ends_at,is_active")
        .eq("code", couponCode).maybeSingle();
      if (couponError) throw couponError;
      if (!coupon || !coupon.is_active) return json({ error: "Ese cupón no existe o está desactivado." }, 400);
      const now = Date.now();
      if (new Date(coupon.starts_at).getTime() > now || (coupon.ends_at && new Date(coupon.ends_at).getTime() < now)) {
        return json({ error: "Ese cupón todavía no está vigente o ya venció." }, 400);
      }
      if (coupon.max_uses != null && Number(coupon.uses_count) >= Number(coupon.max_uses)) {
        return json({ error: "Ese cupón ya alcanzó su límite de usos." }, 400);
      }
      if (subtotal < Number(coupon.minimum_subtotal_cop || 0)) {
        return json({ error: "El pedido no alcanza el mínimo de compra para usar ese cupón." }, 400);
      }
      discountCop = coupon.discount_type === "percent"
        ? Math.round(subtotal * Number(coupon.discount_value) / 100)
        : Math.min(subtotal, Number(coupon.discount_value));
      discountCop = Math.max(0, Math.min(subtotal, discountCop));
      usedCoupon = coupon;
    }
    const totalCop = subtotal - discountCop;
    const codShippingFeeCop = 12000;
    if (!isBoldPayment && totalCop <= codShippingFeeCop) {
      return json({ error: "Para contraentrega, el total debe superar los $12.000 COP del anticipo de envío. Elige Bold o ajusta el cupón." }, 400);
    }
    if (isBoldPayment && totalCop < 1000) {
      return json({ error: "El total después del descuento debe ser de al menos $1.000 COP para pagar con Bold. Cambia el cupón o selecciona otro importe." }, 400);
    }
    const types = new Set(lines.map((l: any) => l.delivery_type));
    const deliveryType = types.size > 1 ? "mixed" : lines[0].delivery_type;
    if (!isBoldPayment && types.has("digital")) {
      return json({ error: "La contraentrega solo está disponible para pedidos exclusivamente de productos físicos. Para servicios digitales, paga con Bold." }, 400);
    }
    if (!isBoldPayment && lines.some((line: any) => line.printful_sync_variant_id != null)) {
      return json({ error: "Los productos configurados para fabricación y envío mediante Printful requieren pago en línea con Bold." }, 400);
    }
    if (types.has("physical") && (latitude === null || longitude === null || !Number.isFinite(latitude) || !Number.isFinite(longitude))) {
      return json({ error: "Para pedidos con productos físicos, debes marcar obligatoriamente la ubicación de entrega en el mapa." }, 400);
    }
    if (types.has("physical") && (!address || !neighborhood || !city || !department)) {
      return json({ error: "Completa la dirección, barrio, ciudad y departamento para productos físicos." }, 400);
    }

    const { data: order, error: orderError } = await admin.from("orders").insert({
      user_id: userId,
      status: "pending_payment",
      printful_status: lines.some((line: any) => line.printful_sync_variant_id != null) ? "pending" : "not_applicable",
      payment_status: "pending",
      payment_provider: isBoldPayment ? "bold" : "cash_on_delivery",
      shipping_fee_cop: isBoldPayment ? 0 : codShippingFeeCop,
      cash_on_delivery_due_cop: isBoldPayment ? null : totalCop - codShippingFeeCop,
      shipping_payment_status: isBoldPayment ? "not_required" : "pending",
      shipping_payment_reference: null,
      shipping_payment_transaction_id: null,
      currency: "COP",
      subtotal_cop: subtotal,
      discount_cop: discountCop,
      total_cop: totalCop,
      coupon_code: usedCoupon ? usedCoupon.code : null,
      delivery_type: deliveryType,
      customer_first_name: firstName,
      customer_last_name: lastName,
      customer_email: email || null,
      customer_phone: phone,
      customer_email_verified: customerEmailVerified,
      customer_phone_verified: customerPhoneVerified,
      latitude,
      longitude,
      address: address || null,
      neighborhood: neighborhood || null,
      city: city || null,
      department: department || null,
      postal_code: postalCode || null,
      delivery_reference: reference || null,
      preferred_payment_method: paymentMethod || null,
    }).select("id,order_number,status,payment_status,payment_provider,shipping_fee_cop,shipping_payment_status,cash_on_delivery_due_cop,subtotal_cop,discount_cop,total_cop,coupon_code,created_at").single();
    if (orderError) throw orderError;

    const orderLines = lines.map((line: any) => ({ ...line, order_id: order.id }));
    const {data:createdOrderLines,error:linesError} = await admin.from("order_items").insert(orderLines).select("id,product_id,selected_variant,selected_size,selected_audience");
    if (linesError) {
      await admin.from("orders").delete().eq("id", order.id);
      throw linesError;
    }
    const dropiSnapshots = (createdOrderLines || []).flatMap((line: any)=>{
      const matchingItem = items.find((item: any)=>Number(item.product_id)===Number(line.product_id) &&
        String(item.selected_variant||"")===String(line.selected_variant||"") &&
        String(item.selected_size||"")===String(line.selected_size||"") &&
        String(item.selected_audience||"")===String(line.selected_audience||""));
      const dropiId = matchingItem?.dropi_variant_id || dropiByProductId.get(Number(line.product_id));
      return dropiId ? [{order_item_id:line.id,dropi_product_id:dropiId}] : [];
    });
    if (dropiSnapshots.length) {
      const {error:snapshotError} = await admin.from("order_item_supplier_refs").insert(dropiSnapshots);
      if (snapshotError) {
        await admin.from("orders").delete().eq("id", order.id);
        throw snapshotError;
      }
    }

    // Consume a coupon using an optimistic conditional update so simultaneous checkouts
    // cannot exceed max_uses or overwrite each other's usage counters.
    if (usedCoupon) {
      let usageCommitted = false;
      for (let attempt = 0; attempt < 8; attempt++) {
        const {data: liveCoupon, error: readError} = await admin.from("coupons")
          .select("id,uses_count,max_uses,is_active,starts_at,ends_at")
          .eq("id", usedCoupon.id).maybeSingle();
        if (readError) {
          await admin.from("orders").delete().eq("id", order.id);
          throw readError;
        }
        if (!liveCoupon || !liveCoupon.is_active) {
          await admin.from("orders").delete().eq("id", order.id);
          return json({error:"El cupón dejó de estar disponible. Inténtalo con otro código."},409);
        }
        const usageNow = Date.now();
        if (new Date(liveCoupon.starts_at).getTime() > usageNow ||
            (liveCoupon.ends_at && new Date(liveCoupon.ends_at).getTime() < usageNow)) {
          await admin.from("orders").delete().eq("id", order.id);
          return json({error:"El cupón ya no está vigente."},409);
        }
        const count = Number(liveCoupon.uses_count || 0);
        if (liveCoupon.max_uses != null && count >= Number(liveCoupon.max_uses)) {
          await admin.from("orders").delete().eq("id", order.id);
          return json({error:"Este cupón acaba de alcanzar su límite de usos."},409);
        }
        const {data:counterUpdated,error:usageError} = await admin.from("coupons")
          .update({uses_count:count+1,updated_at:new Date().toISOString()})
          .eq("id",usedCoupon.id).eq("uses_count",count)
          .select("id").maybeSingle();
        if (usageError) {
          await admin.from("orders").delete().eq("id", order.id);
          throw usageError;
        }
        if (counterUpdated) {
          usageCommitted = true;
          break;
        }
      }
      if (!usageCommitted) {
        await admin.from("orders").delete().eq("id", order.id);
        return json({error:"No pudimos reservar el uso del cupón por actividad simultánea. Inténtalo de nuevo."},409);
      }
    }

    return json({
      ok: true,
      order: {
        id: order.id, order_number: order.order_number, status: order.status,
        payment_status: order.payment_status, payment_provider: order.payment_provider,
        shipping_fee_cop: order.shipping_fee_cop, shipping_payment_status: order.shipping_payment_status,
        subtotal_cop: order.subtotal_cop, discount_cop: order.discount_cop,
        total_cop: order.total_cop, coupon_code: order.coupon_code, created_at: order.created_at,
      },
      message: isBoldPayment
        ? "Pedido creado para pago en línea con Bold. El envío es gratis y el pedido solo se considera pagado al verificar la transacción."
        : "Pedido de contraentrega registrado. El producto se paga al recibirlo; el flete debe cotizarse y pagarse por adelantado a la transportadora antes del despacho.",
    }, 201);
  } catch (error) {
    console.error("create-order error:", error);
    return json({ error: "No pudimos registrar el pedido en la base de datos. Inténtalo de nuevo o contacta a soporte." }, 500);
  }
});
