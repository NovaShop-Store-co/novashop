(() => {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("modo");
  const orderNumber = String(params.get("pedido") || "").trim().slice(0, 60);
  const orderId = String(params.get("id") || "").trim();
  const returnReference = String(params.get("shipping_ref") || params.get("bold-order-id") || params.get("bold_order_id") || "").trim();

  const title = document.querySelector("#orderTitle");
  const number = document.querySelector("#orderNumber");
  const email = document.querySelector("#freightEmail");
  const payButton = document.querySelector("#payShippingBold");
  const balance = document.querySelector("#codBalance");
  const paymentBreakdown = document.querySelector("#codPaymentBreakdown");
  const paymentStatus = document.querySelector("#shippingPaymentStatus");

  const money = value => new Intl.NumberFormat("es-CO", {
    style: "currency", currency: "COP", maximumFractionDigits: 0
  }).format(Math.max(0, Number(value) || 0));

  function setStatus(message, kind = "info") {
    if (!paymentStatus) return;
    paymentStatus.textContent = message;
    paymentStatus.dataset.status = kind;
  }

  function renderBalance(order = {}) {
    const fee = Number(order.shipping_fee_cop ?? 12000);
    const due = order.cash_on_delivery_due_cop == null
      ? (Number(order.total_cop || 0) - fee)
      : Number(order.cash_on_delivery_due_cop);
    if (balance) balance.textContent =
      "Anticipo de envío con Bold: " + money(fee) +
      " · Saldo del producto al recibir: " + money(due) + ".";
  }

  function hidePayAsPaid(order = {}) {
    if (payButton) {
      payButton.hidden = true;
      payButton.disabled = true;
    }
    if (email) email.hidden = false;
    renderBalance(order);
    setStatus("✅ El anticipo de envío quedó confirmado por Bold. El saldo indicado se paga al recibir el producto. NovaShop debe verificar el pedido antes del despacho.", "success");
  }

  function showFreightContact() {
    if (email) {
      email.hidden = false;
      const subject = "Ayuda con el flete del pedido " + orderNumber;
      const body = "Hola, necesito ayuda con el anticipo de envío por Bold.\n\nPedido: " + orderNumber;
      email.href = "mailto:hola@novashop.co?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
    }
  }

  async function prepareButton() {
    if (!payButton) return;
    payButton.hidden = false;
    payButton.disabled = true;
    payButton.textContent = "Preparando pago de envío…";
    try {
      const result = await window.NovaShopBold.prepareShipping(orderId, payButton, null);
      if (result?.already_paid || result?.order?.shipping_payment_status === "approved") {
        hidePayAsPaid(result.order || {});
        return;
      }
      renderBalance(result?.order || {});
      setStatus("Paga los $12.000 COP del envío con Bold. El resto se cobra al recibir el producto. El pedido no se despachará hasta confirmar este pago.");
    } catch (error) {
      payButton.disabled = false;
      payButton.textContent = "Reintentar preparar pago de envío";
      showFreightContact();
      setStatus(error?.message || "No pudimos preparar el pago del flete. Inténtalo otra vez o contacta a NovaShop.", "error");
    }
  }

  async function verifyReturnedPayment() {
    if (!returnReference || !window.NovaShopDB?.verifyShippingBoldPayment) return false;
    try {
      payButton && (payButton.disabled = true);
      const result = await window.NovaShopDB.verifyShippingBoldPayment(returnReference);
      if (result.status === "approved") {
        hidePayAsPaid({
          shipping_fee_cop: result.shipping_fee_cop,
          cash_on_delivery_due_cop: result.cash_on_delivery_due_cop
        });
        return true;
      }
      renderBalance({
        shipping_fee_cop: result.shipping_fee_cop,
        cash_on_delivery_due_cop: result.cash_on_delivery_due_cop
      });
      if (result.status === "test") {
        setStatus("Bold confirmó una transacción de prueba, pero no se registró como un pago real. Para despachar debe confirmarse un pago en producción.");
      } else if (result.status === "rejected") {
        setStatus("Bold no aprobó el anticipo de envío. Puedes reintentar el pago sin crear otro pedido.", "error");
      } else {
        setStatus(result.message || "Bold aún no ha confirmado el pago del flete. No pagues de nuevo hasta revisar el estado.");
      }
      return false;
    } catch (error) {
      setStatus(error?.message || "No pudimos verificar el pago de envío. Consulta de nuevo en unos minutos.", "error");
      return false;
    } finally {
      if (payButton) payButton.disabled = false;
    }
  }

  async function init() {
    if (mode !== "contraentrega" || !orderNumber) {
      title.textContent = "No encontramos el número de pedido";
      number.textContent = "Vuelve a NovaShop para consultar tus opciones de compra.";
      if (payButton) payButton.hidden = true;
      showFreightContact();
      return;
    }
    title.textContent = "Tu pedido está registrado";
    number.textContent = "Número de pedido: " + orderNumber;

    if (!orderId) {
      if (payButton) payButton.hidden = true;
      if (paymentBreakdown) paymentBreakdown.hidden = true;
      if (balance) balance.textContent = "Este pedido se creó antes de activar el pago de envío por Bold o no incluye el identificador necesario.";
      showFreightContact();
      setStatus("Contacta a NovaShop para que verifique el flete de este pedido antes del despacho.");
      return;
    }

    if (!window.NovaShopDB?.getCODShippingStatus || !window.NovaShopBold?.prepareShipping) {
      if (payButton) payButton.disabled = true;
      showFreightContact();
      setStatus("No se pudo iniciar el módulo de pagos. Recarga esta página o contacta a NovaShop.", "error");
      return;
    }

    if (returnReference) {
      const approved = await verifyReturnedPayment();
      if (approved) return;
    }

    try {
      const result = await window.NovaShopDB.getCODShippingStatus(orderId);
      const order = result.order || {};
      renderBalance(order);
      if (order.shipping_payment_status === "approved") {
        hidePayAsPaid(order);
        return;
      }
      if (["cancelled", "refunded", "payment_failed"].includes(order.status)) {
        if (payButton) payButton.hidden = true;
        setStatus("Este pedido está cerrado. Contacta a NovaShop para resolver cualquier pago pendiente.", "error");
        showFreightContact();
        return;
      }
    } catch (error) {
      setStatus(error?.message || "No pudimos consultar el estado del flete.", "error");
      showFreightContact();
    }

    await prepareButton();
  }

  if (email) email.hidden = true;
  if (payButton) payButton.addEventListener("click", () => {
    // The button opens the previously prepared Bold checkout. A second click refreshes its signed configuration.
    if (payButton.dataset.boldShippingReady === "true" && typeof payButton.onclick === "function") return;
    prepareButton();
  });

  init();
})();
