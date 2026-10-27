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
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function defaultKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed.default === "string" ? parsed.default : undefined;
  } catch {
    return undefined;
  }
}
function sha256Hex(input: string): Promise<string> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)).then((digest) =>
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
  );
}
function statusFromOrder(order: any): string {
  if (order?.payment_status === "approved" || ["paid", "preparing", "shipped", "delivered"].includes(order?.status)) return "approved";
  if (order?.payment_status === "rejected" || order?.status === "payment_failed") return "rejected";
  if (order?.payment_status === "refunded" || order?.status === "refunded") return "refunded";
  if (order?.payment_status === "cancelled" || order?.status === "cancelled") return "cancelled";
  return "pending";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const publicKey = defaultKey(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")) || Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = defaultKey(Deno.env.get("SUPABASE_SECRET_KEYS")) || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const boldApiKey = Deno.env.get("BOLD_API_KEY") || "";
    const boldSecretKey = Deno.env.get("BOLD_SECRET_KEY") || "";
    const boldEnvironment = clean(Deno.env.get("BOLD_ENVIRONMENT") || "", 16).toLowerCase();
    const validBoldEnvironment = ["test", "live"].includes(boldEnvironment);
    const siteUrl = (Deno.env.get("NOVASHOP_SITE_URL") || "https://novashop-store-co.pages.dev").replace(/\/+$/, "");

    if (!supabaseUrl || !publicKey || !serviceKey) {
      console.error("bold-payments: faltan variables de entorno de Supabase.");
      return json({ error: "La integración de pagos no está configurada correctamente en Supabase." }, 500);
    }
    const site = new URL(siteUrl);
    if (site.protocol !== "https:") return json({ error: "La URL pública de NovaShop debe usar HTTPS." }, 500);
    const rawBody = await req.text();
    if (rawBody.length > 12000) return json({ error: "La solicitud es demasiado grande." }, 413);
    let body: any;
    try { body = JSON.parse(rawBody); } catch { return json({ error: "El formato de la solicitud no es válido." }, 400); }
    const action = clean(body.action, 40);
    // Public preflight returns missing variable names only, never credential values.
    if (action === "status") {
      const missing: string[] = [];
      if (!boldApiKey) missing.push("BOLD_API_KEY");
      if (!boldSecretKey) missing.push("BOLD_SECRET_KEY");
      if (!validBoldEnvironment) missing.push("BOLD_ENVIRONMENT");
      return json({
        ok: true,
        configured: missing.length === 0,
        missing,
        environment: validBoldEnvironment ? boldEnvironment : null
      });
    }
    if (!validBoldEnvironment) {
      return json({ error: "Configura BOLD_ENVIRONMENT como test o live en los secretos de Supabase." }, 503);
    }
    if (!boldApiKey || !boldSecretKey) {
      return json({ error: "Faltan las llaves de integración de Bold en Supabase. Configura BOLD_API_KEY y BOLD_SECRET_KEY en los secretos de la función." }, 503);
    }

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    let requester: any = null;
    if (token && token !== publicKey && token !== Deno.env.get("SUPABASE_ANON_KEY")) {
      if (token.split(".").length !== 3) return json({ error: "La sesión enviada no es válida." }, 401);
      const authClient = createClient(supabaseUrl, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await authClient.auth.getUser(token);
      if (error || !data.user) return json({ error: "Tu sesión no es válida. Inicia sesión de nuevo." }, 401);
      requester = data.user;
    }

    if (action === "shipping-status") {
      const orderId = clean(body.order_id, 50);
      if (!isUuid(orderId)) return json({ error: "Identificador de pedido no válido." }, 400);
      const { data: order, error } = await admin.from("orders")
        .select("id,order_number,payment_provider,currency,shipping_fee_cop,shipping_payment_status,cash_on_delivery_due_cop,total_cop,shipping_payment_reference,status")
        .eq("id", orderId).maybeSingle();
      if (error) throw error;
      if (!order) return json({ error: "No encontramos el pedido." }, 404);
      if (order.payment_provider !== "cash_on_delivery") return json({ error: "El pedido no está registrado para contraentrega." }, 409);
      return json({ ok: true, order: {
        id: order.id, order_number: order.order_number, total_cop: order.total_cop,
        shipping_fee_cop: Number(order.shipping_fee_cop || 0),
        cash_on_delivery_due_cop: order.cash_on_delivery_due_cop == null ? null : Number(order.cash_on_delivery_due_cop),
        shipping_payment_status: order.shipping_payment_status,
        shipping_payment_reference: order.shipping_payment_reference,
        status: order.status
      }});
    }

    if (action === "create-shipping-checkout") {
      const orderId = clean(body.order_id, 50);
      if (!isUuid(orderId)) return json({ error: "Identificador de pedido no válido." }, 400);
      const { data: order, error: orderError } = await admin.from("orders")
        .select("id,order_number,user_id,status,payment_provider,currency,total_cop,shipping_fee_cop,shipping_payment_status,cash_on_delivery_due_cop,shipping_payment_reference,customer_first_name,customer_last_name,customer_email,customer_phone")
        .eq("id", orderId).maybeSingle();
      if (orderError) throw orderError;
      if (!order) return json({ error: "No encontramos ese pedido." }, 404);
      if (order.user_id && (!requester || requester.id !== order.user_id)) {
        return json({ error: "Inicia sesión con la cuenta que realizó este pedido para pagar el flete." }, 403);
      }
      if (order.payment_provider !== "cash_on_delivery" || order.currency !== "COP" || Number(order.shipping_fee_cop) !== 12000) {
        return json({ error: "Este pedido no tiene configurado el flete fijo de contraentrega de $12.000 COP." }, 409);
      }
      if (["cancelled","refunded","payment_failed"].includes(order.status)) {
        return json({ error: "Este pedido está cerrado y no acepta pagos de envío." }, 409);
      }
      if (order.shipping_payment_status === "approved") {
        return json({ ok: true, already_paid: true, order: {
          id: order.id, order_number: order.order_number, total_cop: Number(order.total_cop),
          shipping_fee_cop: 12000, cash_on_delivery_due_cop: Number(order.cash_on_delivery_due_cop || 0),
          shipping_payment_status: "approved"
        }});
      }
      let shippingReference = isUuid(clean(order.shipping_payment_reference, 50))
        ? clean(order.shipping_payment_reference, 50)
        : "";
      if (!shippingReference) {
        const proposedReference = crypto.randomUUID();
        const { data: claimed, error: claimError } = await admin.from("orders")
          .update({ shipping_payment_reference: proposedReference, updated_at: new Date().toISOString() })
          .eq("id", order.id).is("shipping_payment_reference", null)
          .select("shipping_payment_reference").maybeSingle();
        if (claimError) throw claimError;
        if (claimed?.shipping_payment_reference) shippingReference = String(claimed.shipping_payment_reference);
        else {
          const { data: latest, error: latestError } = await admin.from("orders")
            .select("shipping_payment_reference,shipping_payment_status").eq("id", order.id).single();
          if (latestError) throw latestError;
          if (latest.shipping_payment_status === "approved") return json({ ok: true, already_paid: true, order: {
            id: order.id, order_number: order.order_number, total_cop: Number(order.total_cop),
            shipping_fee_cop: 12000, cash_on_delivery_due_cop: Number(order.cash_on_delivery_due_cop || 0),
            shipping_payment_status: "approved"
          }});
          shippingReference = clean(latest.shipping_payment_reference, 50);
        }
      }
      if (!isUuid(shippingReference)) return json({ error: "No pudimos preparar la referencia segura para pagar el flete." }, 500);

      const amount = 12000;
      const integritySignature = await sha256Hex(shippingReference + String(amount) + "COP" + boldSecretKey);
      const description = ("NovaShop flete contraentrega " + clean(order.order_number, 40)).slice(0, 120);
      const redirectionUrl = siteUrl + "/pedido.html?modo=contraentrega&pedido="
        + encodeURIComponent(order.order_number) + "&id=" + encodeURIComponent(order.id)
        + "&shipping_ref=" + encodeURIComponent(shippingReference);

      const customerData: Record<string, string> = {};
      const fullName = clean([order.customer_first_name, order.customer_last_name].filter(Boolean).join(" "), 100);
      if (fullName) customerData.fullName = fullName;
      if (order.customer_email) customerData.email = clean(order.customer_email, 120);
      if (order.customer_phone) {
        customerData.phone = clean(order.customer_phone.replace(/^\\+?57/, ""), 20);
        customerData.dialCode = "+57";
      }

      return json({
        ok: true,
        order: {
          id: order.id, order_number: order.order_number, total_cop: Number(order.total_cop),
          shipping_fee_cop: amount, cash_on_delivery_due_cop: Number(order.cash_on_delivery_due_cop || 0),
          shipping_payment_status: order.shipping_payment_status
        },
        config: {
          orderId: shippingReference, currency: "COP", amount: String(amount),
          apiKey: boldApiKey, integritySignature, description, redirectionUrl,
          ...(Object.keys(customerData).length ? { customerData: JSON.stringify(customerData) } : {})
        }
      }, 200);
    }

    if (action === "create-checkout") {
      const orderId = clean(body.order_id, 50);
      if (!isUuid(orderId)) return json({ error: "Identificador de pedido no válido." }, 400);

      const { data: order, error: orderError } = await admin.from("orders")
        .select("id,order_number,user_id,status,payment_status,payment_provider,payment_reference,currency,total_cop,customer_first_name,customer_last_name,customer_email,customer_phone")
        .eq("id", orderId).maybeSingle();
      if (orderError) throw orderError;
      if (!order) return json({ error: "No encontramos ese pedido." }, 404);
      if (order.user_id && (!requester || requester.id !== order.user_id)) {
        return json({ error: "Inicia sesión con la cuenta que realizó este pedido para pagar en línea." }, 403);
      }
      if (order.payment_provider !== "bold") {
        return json({ error: "Este pedido se registró para contraentrega y no puede convertirse a pago Bold. Si quieres pagar en línea, crea un nuevo pedido y elige Bold." }, 409);
      }
      if (order.status !== "pending_payment" || !["pending", "rejected"].includes(order.payment_status)) {
        return json({ error: "Este pedido ya no está pendiente de pago. Consulta su estado antes de crear otro pago." }, 409);
      }
      const amount = Number(order.total_cop);
      if (!Number.isSafeInteger(amount) || amount < 1000 || amount > 100000000) {
        return json({ error: "El total de este pedido no está dentro del rango válido para pagos en línea de Bold." }, 400);
      }
      if (order.currency !== "COP") return json({ error: "Solo se admiten pedidos en pesos colombianos (COP)." }, 400);

      const orderReference = String(order.id);
      const integritySignature = await sha256Hex(orderReference + String(amount) + "COP" + boldSecretKey);
      const description = ("NovaShop pedido " + clean(order.order_number, 40)).slice(0, 120);
      const redirectionUrl = siteUrl + "/pago.html";

      const { data: payableOrder, error: updateError } = await admin.from("orders").update({
        payment_provider: "bold",
        payment_reference: orderReference,
        preferred_payment_method: "Pago en línea con Bold",
        updated_at: new Date().toISOString(),
      }).eq("id", order.id).eq("status", "pending_payment").select("id").maybeSingle();
      if (updateError) throw updateError;
      if (!payableOrder) return json({ error: "El pedido ya no está pendiente de pago. Actualiza la tienda y revisa su estado." }, 409);

      const customerData: Record<string, string> = {};
      const fullName = clean([order.customer_first_name, order.customer_last_name].filter(Boolean).join(" "), 100);
      if (fullName) customerData.fullName = fullName;
      if (order.customer_email) customerData.email = clean(order.customer_email, 120);
      if (order.customer_phone) {
        customerData.phone = clean(order.customer_phone.replace(/^\+?57/, ""), 20);
        customerData.dialCode = "+57";
      }

      return json({
        ok: true,
        order: { id: order.id, order_number: order.order_number, total_cop: amount },
        config: {
          orderId: orderReference,
          currency: "COP",
          amount: String(amount),
          apiKey: boldApiKey,
          integritySignature,
          description,
          redirectionUrl,
          ...(Object.keys(customerData).length ? { customerData: JSON.stringify(customerData) } : {}),
        },
      }, 200);
    }

    if (action === "verify-checkout") {
      const orderId = clean(body.order_id, 50);
      if (!isUuid(orderId)) return json({ error: "La referencia recibida de Bold no es válida." }, 400);

      const { data: order, error: orderError } = await admin.from("orders")
        .select("id,order_number,user_id,status,payment_status,payment_provider,payment_reference,currency,total_cop")
        .eq("id", orderId).maybeSingle();
      if (orderError) throw orderError;
      if (!order) return json({ error: "No encontramos el pedido asociado a esta transacción." }, 404);
      if (order.payment_provider !== "bold") return json({ error: "Este pedido no tiene un intento de pago Bold registrado." }, 409);
      const localStatus = statusFromOrder(order);
      if (localStatus === "approved" || localStatus === "refunded" || localStatus === "cancelled") {
        return json({ ok: true, status: localStatus, order_number: order.order_number, message: localStatus === "approved" ? "El pedido figura con pago aprobado." : "El pedido está cerrado; consulta con NovaShop si necesitas ayuda." });
      }

      const boldResponse = await fetch("https://payments.api.bold.co/v2/payment-voucher/" + encodeURIComponent(orderId), {
        method: "GET",
        headers: { "Authorization": "x-api-key " + boldApiKey, "Accept": "application/json" },
      });
      const remote = await boldResponse.json().catch(() => ({}));
      if (!boldResponse.ok) {
        console.error("bold-payments: Bold devolvió HTTP " + boldResponse.status + " al consultar una transacción.");
        return json({ error: "Bold aún no permite consultar esta transacción. Vuelve a intentarlo en unos minutos.", status: "pending", order_number: order.order_number }, 502);
      }

      const transaction = remote?.payload ?? remote;
      const providerStatus = clean(transaction?.payment_status, 40).toUpperCase();
      if (!providerStatus || providerStatus === "NO_TRANSACTION_FOUND" || providerStatus === "PROCESSING" || providerStatus === "PENDING") {
        return json({ ok: true, status: "pending", order_number: order.order_number, provider_status: providerStatus || "PENDING", message: "Bold todavía no confirma un resultado definitivo. El pedido sigue pendiente." });
      }
      if (String(transaction?.reference_id ?? "") !== orderId) {
        console.error("bold-payments: referencia del proveedor distinta de la referencia del pedido.");
        return json({ error: "La referencia consultada no coincide con el pedido. No hemos cambiado su estado." }, 409);
      }
      if (Number(transaction?.total) !== Number(order.total_cop) || String(order.currency) !== "COP") {
        console.error("bold-payments: el monto o la moneda consultados no coinciden con el pedido.");
        return json({ error: "El monto confirmado por Bold no coincide con el pedido. No hemos cambiado su estado; contacta a soporte." }, 409);
      }

      let nextStatus: string | null = null;
      let nextPaymentStatus: string | null = null;
      if (providerStatus === "APPROVED") {
        nextStatus = "paid";
        nextPaymentStatus = "approved";
      } else if (["REJECTED", "FAILED"].includes(providerStatus)) {
        nextStatus = "payment_failed";
        nextPaymentStatus = "rejected";
      } else if (providerStatus === "VOIDED") {
        nextStatus = "cancelled";
        nextPaymentStatus = "cancelled";
      } else {
        return json({ ok: true, status: "pending", order_number: order.order_number, provider_status: providerStatus, message: "Bold aún no devuelve un estado final de la transacción." });
      }

      if (boldEnvironment === "test") {
        return json({
          ok: true,
          status: "test",
          order_number: order.order_number,
          provider_status: providerStatus,
          message: providerStatus === "APPROVED"
            ? "Bold confirmó una transacción de prueba. No se marcó el pedido como pagado ni se modificó el inventario."
            : "Bold confirmó un resultado de prueba (" + providerStatus + "). El pedido real no se modificó.",
        });
      }

      const patch: Record<string, unknown> = {
        status: nextStatus,
        payment_status: nextPaymentStatus,
        payment_provider: "bold",
        payment_reference: clean(transaction?.transaction_id || orderId, 100),
        updated_at: new Date().toISOString(),
      };
      const { error: updateError } = await admin.from("orders").update(patch)
        .eq("id", order.id).eq("status", "pending_payment").neq("payment_status", "approved").select("id").maybeSingle();
      if (updateError) throw updateError;

      const { data: latest, error: latestError } = await admin.from("orders")
        .select("id,order_number,status,payment_status").eq("id", order.id).single();
      if (latestError) throw latestError;
      const finalStatus = statusFromOrder(latest);
      return json({
        ok: true,
        status: finalStatus,
        order_number: latest.order_number,
        provider_status: providerStatus,
        message: finalStatus === "approved" ? "Pago verificado y pedido actualizado." : finalStatus === "rejected" ? "Bold informa que el pago fue rechazado." : "No se pudo confirmar el pago.",
      });
    }

    if (action === "verify-shipping-checkout") {
      const shippingReference = clean(body.order_id, 50);
      if (!isUuid(shippingReference)) return json({ error: "La referencia del pago de envío no es válida." }, 400);
      const { data: order, error: orderError } = await admin.from("orders")
        .select("id,order_number,status,payment_provider,currency,total_cop,shipping_fee_cop,shipping_payment_status,cash_on_delivery_due_cop,shipping_payment_reference")
        .eq("shipping_payment_reference", shippingReference).maybeSingle();
      if (orderError) throw orderError;
      if (!order || order.payment_provider !== "cash_on_delivery") {
        return json({ error: "No encontramos el pedido de contraentrega asociado al pago de envío." }, 404);
      }
      if (Number(order.shipping_fee_cop) !== 12000 || String(order.currency) !== "COP") {
        return json({ error: "El importe configurado para el flete no coincide con $12.000 COP." }, 409);
      }
      if (order.shipping_payment_status === "approved") {
        return json({ ok: true, status: "approved", order_number: order.order_number,
          shipping_fee_cop: 12000, cash_on_delivery_due_cop: Number(order.cash_on_delivery_due_cop || 0),
          message: "Bold confirmó el pago del flete. El saldo restante se paga al recibir el producto." });
      }

      const boldResponse = await fetch("https://payments.api.bold.co/v2/payment-voucher/" + encodeURIComponent(shippingReference), {
        method: "GET",
        headers: { "Authorization": "x-api-key " + boldApiKey, "Accept": "application/json" },
      });
      const remote = await boldResponse.json().catch(() => ({}));
      if (!boldResponse.ok) {
        console.error("bold-payments: Bold devolvió HTTP " + boldResponse.status + " al consultar el pago de envío.");
        return json({ error: "Bold todavía no permite consultar este pago de envío. Vuelve a intentarlo en unos minutos.", status: "pending", order_number: order.order_number }, 502);
      }
      const transaction = remote?.payload ?? remote;
      const providerStatus = clean(transaction?.payment_status, 40).toUpperCase();
      if (!providerStatus || ["NO_TRANSACTION_FOUND","PROCESSING","PENDING"].includes(providerStatus)) {
        return json({ ok: true, status: "pending", order_number: order.order_number,
          shipping_fee_cop: 12000, cash_on_delivery_due_cop: Number(order.cash_on_delivery_due_cop || 0),
          provider_status: providerStatus || "PENDING",
          message: "Bold todavía no confirma el pago del flete. No despacharemos el pedido hasta que se apruebe." });
      }
      if (String(transaction?.reference_id ?? "") !== shippingReference ||
          Number(transaction?.total) !== 12000 || String(transaction?.currency ?? "COP") !== "COP") {
        console.error("bold-payments: monto o referencia del pago de envío no coincide con " + order.order_number);
        return json({ error: "La referencia, el monto o la moneda no coinciden con el flete. No hemos actualizado el pedido." }, 409);
      }
      if (boldEnvironment === "test") {
        return json({ ok: true, status: "test", order_number: order.order_number,
          shipping_fee_cop: 12000, cash_on_delivery_due_cop: Number(order.cash_on_delivery_due_cop || 0),
          provider_status: providerStatus,
          message: providerStatus === "APPROVED"
            ? "Bold confirmó una transacción de prueba. El flete del pedido real sigue pendiente."
            : "Bold devolvió un resultado de prueba (" + providerStatus + "). No se modificó el pedido real." });
      }
      if (providerStatus === "APPROVED") {
        const { error } = await admin.from("orders").update({
          shipping_payment_status: "approved",
          shipping_payment_transaction_id: clean(transaction?.transaction_id || shippingReference, 100),
          updated_at: new Date().toISOString()
        }).eq("id", order.id).eq("shipping_payment_status", "pending");
        if (error) throw error;
        return json({ ok: true, status: "approved", order_number: order.order_number,
          shipping_fee_cop: 12000, cash_on_delivery_due_cop: Number(order.cash_on_delivery_due_cop || 0),
          provider_status: providerStatus,
          message: "Pago del flete confirmado por Bold. El saldo restante se paga al recibir el producto." });
      }
      return json({ ok: true, status: ["REJECTED","FAILED","VOIDED"].includes(providerStatus) ? "rejected" : "pending",
        order_number: order.order_number, shipping_fee_cop: 12000,
        cash_on_delivery_due_cop: Number(order.cash_on_delivery_due_cop || 0),
        provider_status: providerStatus,
        message: ["REJECTED","FAILED","VOIDED"].includes(providerStatus)
          ? "El pago del flete no fue aprobado. Puedes reintentarlo sin crear otro pedido."
          : "Bold todavía no ha dado un resultado definitivo para el pago del flete." });
    }

    return json({ error: "Acción no reconocida." }, 400);
  } catch (error) {
    console.error("bold-payments error:", error);
    return json({ error: "No pudimos procesar la solicitud de pago. Inténtalo de nuevo o contacta a NovaShop." }, 500);
  }
});