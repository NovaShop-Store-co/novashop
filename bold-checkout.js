(() => {
  let loadPromise = null;

  function loadBoldScript() {
    if (typeof window.BoldCheckout === "function") return Promise.resolve();
    if (loadPromise) return loadPromise;
    loadPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src="https://checkout.bold.co/library/boldPaymentButton.js"]');
      if (existing) {
        const startedAt = Date.now();
        const timer = window.setInterval(() => {
          if (typeof window.BoldCheckout === "function") {
            window.clearInterval(timer);
            resolve();
          } else if (Date.now() - startedAt > 12000) {
            window.clearInterval(timer);
            reject(new Error("La pasarela de Bold no terminó de cargar. Inténtalo nuevamente."));
          }
        }, 100);
        return;
      }
      const script = document.createElement("script");
      script.src = "https://checkout.bold.co/library/boldPaymentButton.js";
      script.async = true;
      script.onload = () => {
        if (typeof window.BoldCheckout === "function") resolve();
        else {
          script.remove();
          reject(new Error("No se pudo inicializar la pasarela de Bold."));
        }
      };
      script.onerror = () => {
        script.remove();
        reject(new Error("No pudimos cargar la pasarela de Bold. Revisa tu conexión."));
      };
      document.head.appendChild(script);
    }).catch((error) => {
      loadPromise = null;
      throw error;
    });
    return loadPromise;
  }

  async function prepare(orderId, button, closeDialog) {
    if (!window.NovaShopDB?.createBoldCheckout) {
      throw new Error("La integración de pagos de NovaShop no está disponible. Recarga la página e inténtalo de nuevo.");
    }
    const result = await window.NovaShopDB.createBoldCheckout(orderId);
    await loadBoldScript();
    if (!result.config?.apiKey || !result.config?.integritySignature || !result.config?.orderId) {
      throw new Error("Bold no devolvió una configuración de pago válida.");
    }
    const checkout = new window.BoldCheckout(result.config);
    button.type = "button";
    button.disabled = false;
    button.textContent = "💳 Pagar ahora con Bold";
    button.setAttribute("aria-label", "Abrir la pasarela segura de Bold");
    button.dataset.boldReady = "true";
    button.onclick = (event) => {
      event.preventDefault();
      try {
        if (typeof closeDialog === "function") closeDialog();
        checkout.open();
      } catch (error) {
        console.error("No se pudo abrir el checkout de Bold:", error);
        window.alert("No pudimos abrir la pasarela de Bold. Recarga la página e inténtalo de nuevo.");
      }
    };
    return result;
  }

  async function prepareShipping(orderId, button, closeDialog, orderNumber = "") {
    if (!window.NovaShopDB?.createShippingBoldCheckout) {
      throw new Error("La integración de pagos de envío de NovaShop no está disponible. Recarga la página e inténtalo de nuevo.");
    }
    const result = await window.NovaShopDB.createShippingBoldCheckout(orderId, orderNumber);
    if (result?.already_paid || result?.order?.shipping_payment_status === "approved") return result;
    if (!result.config?.apiKey || !result.config?.integritySignature || !result.config?.orderId) {
      throw new Error("Bold no devolvió una configuración válida para pagar el flete.");
    }
    await loadBoldScript();
    const checkout = new window.BoldCheckout(result.config);
    button.type = "button";
    button.disabled = false;
    button.textContent = "💳 Pagar $12.000 de envío con Bold";
    button.setAttribute("aria-label", "Pagar anticipo de envío de $12.000 COP con Bold");
    button.dataset.boldShippingReady = "true";
    // The page opens this instance directly from its click listener so the browser preserves the user gesture.
    button._novaShopBoldCheckout = checkout;
    button.onclick = null;
    return result;
  }

  function setMessage(form, message) {
    let node = form.querySelector("[data-bold-payment-status]");
    if (!node) {
      node = document.createElement("p");
      node.className = "checkout-privacy";
      node.dataset.boldPaymentStatus = "";
      const button = form.querySelector("button[type='submit'], button[data-bold-ready]");
      if (button?.parentNode) button.parentNode.insertBefore(node, button);
      else form.appendChild(node);
    }
    node.textContent = message;
    node.hidden = false;
  }

  window.NovaShopBold = { prepare, prepareShipping, setMessage };
})();