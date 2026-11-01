/* Seasonal gift shortcuts for NovaShop. Uses the existing catalog filters. */
(() => {
  "use strict";
  const normalize = value => String(value || "")
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

  document.addEventListener("click", event => {
    const link = event.target.closest("[data-gift-filter], [data-gift-category]");
    if (!link) return;

    const category = document.getElementById("categoryFilter");
    const audience = document.getElementById("audienceFilter");
    const search = document.getElementById("searchInput");
    const offers = document.getElementById("onlyOffers");
    const minPrice = document.getElementById("minPriceFilter");
    const maxPrice = document.getElementById("maxPriceFilter");
    const hideSoldOut = document.getElementById("hideSoldOut");

    if (search) {
      search.value = "";
      search.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (offers) offers.checked = false;
    if (minPrice) minPrice.value = "";
    if (maxPrice) maxPrice.value = "";
    if (hideSoldOut) hideSoldOut.checked = false;

    if (link.dataset.giftFilter && audience) {
      audience.value = link.dataset.giftFilter;
      audience.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (link.dataset.giftCategory && category) {
      const wanted = normalize(link.dataset.giftCategory);
      const match = Array.from(category.options).find(option =>
        option.value !== "all" && normalize(option.value).includes(wanted)
      );
      category.value = match ? match.value : "all";
      if (audience) audience.value = "all";
      category.dispatchEvent(new Event("change", { bubbles: true }));
    }

    window.setTimeout(() => {
      document.getElementById("productos")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 30);
  });
})();
