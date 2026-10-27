import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = { "Content-Type": "application/json; charset=utf-8" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
const clean = (value: unknown, max = 180) =>
  String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function defaultKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try { const parsed = JSON.parse(raw); return typeof parsed.default === "string" ? parsed.default : undefined; }
  catch { return undefined; }
}
function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}
async function hmacHex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const publicKey = defaultKey(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")) || Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = defaultKey(Deno.env.get("SUPABASE_SECRET_KEYS")) || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const mode = clean(Deno.env.get("BOLD_ENVIRONMENT") || "", 16).toLowerCase();
    if (!["test", "live"].includes(mode)) {
      console.error("bold-webhook: configura BOLD_ENVIRONMENT como test o live.");
      return json({ error: "Configuración de ambiente incompleta." }, 500);
    }
    const secret = mode === "test" ? "" : (Deno.env.get("BOLD_SECRET_KEY") || "");
    if (!supabaseUrl || !publicKey || !serviceKey) {
      console.error("bold-webhook: faltan variables de entorno de Supabase.");
      return json({ error: "Configuración de servidor incompleta." }, 500);
    }
    if (mode !== "test" && !secret) {
      console.error("bold-webhook: falta BOLD_SECRET_KEY para verificar la firma.");
      return json({ error: "Configuración de firma incompleta." }, 500);
    }

    const rawBody = await req.text();
    if (rawBody.length > 64000) return json({ error: "Notificación demasiado grande." }, 413);
    const receivedSignature = req.headers.get("x-bold-signature") || "";
    const computedSignature = await hmacHex(base64Utf8(rawBody), secret);
    if (!safeEqual(computedSignature.toLowerCase(), receivedSignature.toLowerCase())) {
      console.warn("bold-webhook: firma no válida; notificación rechazada.");
      return json({ error: "Firma de Bold no válida." }, 401);
    }

    let event: any;
    try { event = JSON.parse(rawBody); } catch { return json({ error: "JSON de notificación no válido." }, 400); }
    if (mode === "test") {
      // Test notifications use an empty signing key per Bold's docs; acknowledge them but never mutate production orders.
      return json({ ok: true, test_mode: true, ignored: true });
    }
    const eventType = clean(event?.type, 40).toUpperCase();
    const data = event?.data ?? {};
    const reference = clean(data?.metadata?.reference, 60);
    if (!isUuid(reference)) {
      // El comercio puede configurar el endpoint para más de una integración de Bold.
      // Los eventos sin una referencia UUID de NovaShop no modifican pedidos.
      return json({ ok: true, ignored: true });
    }

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: orderById, error: orderByIdError } = await admin.from("orders")
      .select("id,order_number,status,payment_status,currency,total_cop,payment_provider,payment_reference,shipping_fee_cop,shipping_payment_status,shipping_payment_reference,cash_on_delivery_due_cop")
      .eq("id", reference).maybeSingle();
    if (orderByIdError) throw orderByIdError;

    let order: any = orderById;
    let isShippingPayment = false;
    if (!order) {
      const { data: shippingOrder, error: shippingOrderError } = await admin.from("orders")
        .select("id,order_number,status,payment_status,currency,total_cop,payment_provider,payment_reference,shipping_fee_cop,shipping_payment_status,shipping_payment_reference,cash_on_delivery_due_cop")
        .eq("shipping_payment_reference", reference).maybeSingle();
      if (shippingOrderError) throw shippingOrderError;
      if (!shippingOrder) return json({ ok: true, ignored: true });
      order = shippingOrder;
      isShippingPayment = true;
    }

    const paymentId = clean(data?.payment_id || event?.subject, 100);
    const now = new Date().toISOString();

    if (isShippingPayment) {
      if (order.payment_provider !== "cash_on_delivery" || Number(order.shipping_fee_cop) !== 12000 ||
          String(data?.amount?.currency ?? "") !== "COP" || Number(data?.amount?.total) !== 12000) {
        console.error("bold-webhook: monto de flete no coincide con el pedido " + order.order_number);
        return json({ error: "El monto o la moneda del pago de flete no coincide con el pedido." }, 409);
      }
      if (eventType === "SALE_APPROVED") {
        if (order.shipping_payment_status === "approved") return json({ ok: true, duplicate: true });
        const { error } = await admin.from("orders").update({
          shipping_payment_status: "approved",
          shipping_payment_transaction_id: paymentId || reference,
          updated_at: now,
        }).eq("id", order.id).eq("shipping_payment_status", "pending");
        if (error) throw error;
        return json({ ok: true, processed: true, payment_type: "shipping" });
      }
      if (eventType === "VOID_APPROVED" && order.shipping_payment_status === "approved") {
        const { error } = await admin.from("orders").update({
          shipping_payment_status: "pending",
          shipping_payment_transaction_id: paymentId || reference,
          updated_at: now,
        }).eq("id", order.id).eq("shipping_payment_status", "approved");
        if (error) throw error;
        return json({ ok: true, processed: true, payment_type: "shipping", voided: true });
      }
      // A rejected or not-yet-final shipping transaction never marks the freight paid.
      return json({ ok: true, ignored: true, payment_type: "shipping" });
    }

    if (order.payment_provider !== "bold") return json({ ok: true, ignored: true });
    if (String(data?.amount?.currency ?? "") !== String(order.currency) ||
        Number(data?.amount?.total) !== Number(order.total_cop)) {
      console.error("bold-webhook: monto o moneda no coincide con el pedido " + order.order_number);
      return json({ error: "El monto o la moneda de la notificación no coincide con el pedido." }, 409);
    }

    if (eventType === "SALE_APPROVED") {
      if (order.payment_status === "approved" || ["paid", "preparing", "shipped", "delivered"].includes(order.status)) {
        return json({ ok: true, duplicate: true });
      }
      const { error } = await admin.from("orders").update({
        status: "paid",
        payment_status: "approved",
        payment_provider: "bold",
        payment_reference: paymentId || reference,
        updated_at: now,
      }).eq("id", order.id).neq("payment_status", "refunded");
      if (error) throw error;
      return json({ ok: true, processed: true });
    }

    if (eventType === "SALE_REJECTED") {
      if (order.payment_status === "approved" || order.payment_status === "refunded") {
        return json({ ok: true, ignored: true });
      }
      const { error } = await admin.from("orders").update({
        status: "payment_failed",
        payment_status: "rejected",
        payment_provider: "bold",
        payment_reference: paymentId || reference,
        updated_at: now,
      }).eq("id", order.id).eq("status", "pending_payment").eq("payment_status", "pending");
      if (error) throw error;
      return json({ ok: true, processed: true });
    }

    if (eventType === "VOID_APPROVED") {
      if (order.payment_status !== "approved" && !["paid", "preparing", "shipped", "delivered"].includes(order.status)) {
        return json({ ok: true, ignored: true });
      }
      const { error } = await admin.from("orders").update({
        status: "refunded",
        payment_status: "refunded",
        payment_provider: "bold",
        payment_reference: paymentId || reference,
        updated_at: now,
      }).eq("id", order.id).neq("payment_status", "refunded");
      if (error) throw error;
      return json({ ok: true, processed: true });
    }

    // VOID_REJECTED and any future event types are acknowledged but do not change the order.
    return json({ ok: true, ignored: true });
  } catch (error) {
    console.error("bold-webhook error:", error);
    return json({ error: "No pudimos procesar la notificación de Bold." }, 500);
  }
});