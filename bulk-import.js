
/* Bulk catalog importer for NovaShop. It reuses the authenticated admin-products Edge Function. */
(() => {
"use strict";
const $ = selector => document.querySelector(selector);
const panel = $("#bulkImportPanel");
if (!panel) return;

const db = window.NovaShopDB;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGES_PER_PRODUCT = 8;
const PAGE_SIZE = 12;
const COLORS = {
  "Negro":"#171717","Blanco":"#f5f5f4","Gris":"#808080","Azul":"#2563eb",
  "Azul marino":"#142b4a","Rojo":"#dc2626","Verde":"#16a34a","Amarillo":"#eab308",
  "Rosado":"#ec4899","Morado":"#7e22ce","Lila":"#a78bfa","Naranja":"#ea580c",
  "Beige":"#d6c2a1","Café":"#7c4a2d","Marrón":"#7c4a2d","Turquesa":"#0d9488"
};
const CATEGORIES = ["Tecnología","Hogar","Moda","Accesorios","Oficina","Streaming","Belleza","Deportes","Otra"];
const MIME_BY_EXT = {jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp",avif:"image/avif",gif:"image/gif"};
let entries = [];
let groups = [];
let page = 0;
let nextGroupId = 1;
let previewUrls = [];
let selectedGroups = new Set();
let existingNames = new Set();
let authorized = false;
let importing = false;

function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[char]));
}
function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
}
function fileMime(file) {
  if (file.type && file.type.startsWith("image/")) return file.type.toLowerCase();
  const extension = String(file.name || "").split(".").pop().toLowerCase();
  return MIME_BY_EXT[extension] || "";
}
function isAllowedImage(file) {
  return Object.values(MIME_BY_EXT).includes(fileMime(file));
}
function message(text, type) {
  const el = $("#bulkStatus");
  if (!el) return;
  el.textContent = text || "";
  el.className = "bulk-import-status" + (type ? " " + type : "");
}
function progress(done, total, label) {
  const fill = $("#bulkProgressFill");
  const percent = total ? Math.max(0,Math.min(100,done/total*100)) : 0;
  if (fill) fill.style.width = percent + "%";
  const value = $("#bulkProgressPercent");
  if (value) value.textContent = Math.round(percent) + "%";
  const caption = $("#bulkProgressLabel");
  if (caption) caption.textContent = label || "";
}
function cleanupPreviews() {
  previewUrls.forEach(url => URL.revokeObjectURL(url));
  previewUrls = [];
}
function filenameStem(file) {
  return String(file.name || "producto").replace(/\.[^.]+$/,"")
    .replace(/[\s_-]+(?:frente|front|delantera|espalda|trasera|back|dorso|lateral|side|detalle|detail|vista|view|principal|portada)(?:[\s_-]*(?:0?[1-9]|[a-d]))?$/i,"")
    .replace(/[\s_-]+(?:0[1-9]|[1-9]|[a-d])$/i,"").trim();
}
function isGenericName(stem) {
  return /^(?:img|dsc|pxl|photo|image|screenshot|whatsapp image|signal image|received|file)[\s_-]*\d*$/i.test(stem) ||
    /^\d{4,}$/.test(stem) || !normalize(stem);
}
function prettyName(value, fallbackNumber) {
  let name = String(value || "").replace(/\b(negro|negra|blanco|blanca|gris|azul|rojo|roja|verde|amarillo|amarilla|rosado|rosada|rosa|morado|morada|lila|naranja|beige|cafe|café|marron|marrón|turquesa)\b/ig," ")
    .replace(/\b(frente|front|espalda|trasera|back|dorso|lateral|side|detalle|detail|vista|view|principal|portada)\b/ig," ")
    .replace(/[_-]+/g," ").replace(/\s+/g," ").trim();
  if (isGenericName(name) || name.length < 2) return "Producto por identificar " + String(fallbackNumber).padStart(3,"0");
  return name.split(" ").map(part => part.charAt(0).toLocaleUpperCase("es") + part.slice(1)).join(" ");
}
function detectColor(fileList) {
  const source = normalize(fileList.map(entry => entry.file.name).join(" "));
  const found = Object.keys(COLORS).filter(color => {
    const key = normalize(color);
    return new RegExp("(^| )" + key + "( |$)").test(source);
  });
  return found.length === 1 ? found[0] : "";
}
function folderPath(entry) {
  const parts = String(entry.path || entry.file.webkitRelativePath || entry.file.name).split("/").filter(Boolean);
  if (parts.length >= 3) return parts.slice(1,-1).join("/");
  return "";
}
function makeGroups(list) {
  const stems = list.map(entry => filenameStem(entry.file));
  const stemCounts = new Map();
  stems.forEach((stem,index) => {
    if (folderPath(list[index]) || isGenericName(stem)) return;
    const key = normalize(stem);
    stemCounts.set(key,(stemCounts.get(key)||0)+1);
  });
  const map = new Map();
  list.forEach((entry,index) => {
    const folder = folderPath(entry);
    const stem = stems[index];
    let key = "";
    let label = "";
    if (folder) {
      key = "folder:" + normalize(folder);
      label = folder.split("/").pop();
    } else if (!isGenericName(stem) && (stemCounts.get(normalize(stem))||0) > 1) {
      key = "name:" + normalize(stem);
      label = stem;
    } else {
      key = "file:" + index + ":" + normalize(entry.file.name);
      label = stem;
    }
    if (!map.has(key)) {
      map.set(key,{
        id:nextGroupId++, name:prettyName(label,map.size+1), category:$("#bulkCategory")?.value||"",
        price:$("#bulkPrice")?.value||"", oldPrice:$("#bulkOldPrice")?.value||"",
        stock:$("#bulkStock")?.value||"", sizes:$("#bulkSizes")?.value||"",
        description:$("#bulkDescription")?.value||"", color:"",
        files:[], importedProductId:null, error:""
      });
    }
    map.get(key).files.push(entry);
  });
  return Array.from(map.values()).map(group => {
    group.color = detectColor(group.files);
    return group;
  });
}
function fileKey(file,path) {
  return [path || file.name,file.size,file.lastModified].join("|");
}
function updateStats() {
  const bytes = entries.reduce((sum,item) => sum + item.file.size,0);
  const el = $("#bulkFileStats");
  if (el) el.textContent = entries.length.toLocaleString("es-CO") + " imágenes · " +
    groups.length.toLocaleString("es-CO") + " productos agrupados · " +
    (bytes/1024/1024).toFixed(1) + " MB seleccionados";
  const importButton = $("#bulkImportButton");
  if (importButton) importButton.disabled = !authorized || importing || !groups.some(group => !group.importedProductId);
}
async function hashEntries(list) {
  if (!window.crypto || !window.crypto.subtle) {
    message("Las imágenes se agruparon, pero este navegador no permite comprobar duplicados exactos. Puedes continuar.", "info");
    return;
  }
  let finished = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < list.length) {
      const index = cursor++;
      const entry = list[index];
      try {
        const bytes = await entry.file.arrayBuffer();
        const digest = await window.crypto.subtle.digest("SHA-256",bytes);
        entry.hash = Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2,"0")).join("");
      } catch (_) {
        entry.hash = "";
      }
      finished++;
      if (finished % 20 === 0 || finished === list.length) {
        message("Comprobando imágenes y duplicados: " + finished.toLocaleString("es-CO") + " de " + list.length.toLocaleString("es-CO") + "…");
        progress(finished,list.length,"Analizando archivos");
      }
    }
  }
  await Promise.all([worker(),worker(),worker()]);
}
function groupHasDuplicateName(group) {
  return existingNames.has(normalize(group.name));
}
function render() {
  cleanupPreviews();
  const list = $("#bulkGroupList");
  if (!list) return;
  const pages = Math.max(1,Math.ceil(groups.length/PAGE_SIZE));
  page = Math.min(page,pages-1);
  const start = page * PAGE_SIZE;
  const visible = groups.slice(start,start+PAGE_SIZE);
  const globalHashCounts = new Map();
  entries.forEach(entry => {
    if (entry.hash) globalHashCounts.set(entry.hash,(globalHashCounts.get(entry.hash)||0)+1);
  });
  if (!groups.length) {
    list.innerHTML = '<div class="admin-orders-empty">Selecciona una carpeta o varias imágenes para preparar los productos.</div>';
  } else {
    list.innerHTML = visible.map(group => {
      const thumbs = group.files.map((entry,index) => {
        const url = URL.createObjectURL(entry.file);
        previewUrls.push(url);
        const duplicate = entry.hash && (globalHashCounts.get(entry.hash)||0) > 1;
        return '<div class="bulk-product-image"><img src="' + esc(url) + '" alt="' + esc(entry.file.name) + '" loading="lazy">' +
          '<button type="button" title="Quitar imagen" data-remove-file="' + index + '" data-group-id="' + group.id + '">×</button>' +
          (duplicate ? '<span class="duplicate-mark">Imagen repetida</span>' : '') +
          '<small>' + esc(entry.file.name) + '</small></div>';
      }).join("");
      const categoryOptions = ['<option value="">Selecciona categoría</option>'].concat(CATEGORIES.map(category =>
        '<option value="' + esc(category) + '"' + (group.category === category ? " selected" : "") + '>' + esc(category) + '</option>'
      )).join("");
      const colorOptions = ['<option value="">Sin color definido</option>'].concat(Object.keys(COLORS).map(color =>
        '<option value="' + esc(color) + '"' + (group.color === color ? " selected" : "") + '>' + esc(color) + '</option>'
      )).join("");
      const duplicateWarning = groupHasDuplicateName(group) ?
        '<div class="bulk-product-warning">Ya existe un producto con este nombre en NovaShop. Cambia el nombre o activa la opción para permitir duplicados.</div>' : "";
      const genericWarning = group.name.startsWith("Producto por identificar") ?
        '<div class="bulk-product-warning">El nombre viene de un archivo genérico. Escribe el nombre real antes de publicar.</div>' : "";
      const imageWarning = group.files.length > MAX_IMAGES_PER_PRODUCT ?
        '<div class="bulk-product-warning">Este grupo tiene ' + group.files.length + ' fotos; el catálogo admite máximo ' + MAX_IMAGES_PER_PRODUCT + '. Sepáralas o quita las sobrantes.</div>' : "";
      const imported = group.importedProductId ?
        '<div class="bulk-product-success">Guardado como producto #' + group.importedProductId + ' · ' + (group.active ? "publicado" : "borrador") + '</div>' : "";
      const error = group.error ? '<div class="bulk-product-error">' + esc(group.error) + '</div>' : "";
      return '<article class="bulk-product-card' + (group.importedProductId ? ' is-imported' : '') + (group.error ? ' is-error' : '') + '" data-card-group="' + group.id + '">' +
        '<div class="bulk-product-top"><label><input type="checkbox" data-select-group="' + group.id + '"' + (selectedGroups.has(group.id) ? " checked" : "") + '> Seleccionar para unir</label>' +
        '<strong>' + group.files.length + ' foto(s)</strong></div>' + imported + error + duplicateWarning + genericWarning + imageWarning +
        '<div class="bulk-product-fields">' +
        '<label class="wide">Nombre del producto *<input data-product-field="name" data-group-id="' + group.id + '" maxlength="140" value="' + esc(group.name) + '"></label>' +
        '<label>Categoría *<select data-product-field="category" data-group-id="' + group.id + '">' + categoryOptions + '</select></label>' +
        '<label>Precio de venta COP *<input type="number" min="1" step="1" data-product-field="price" data-group-id="' + group.id + '" value="' + esc(group.price) + '"></label>' +
        '<label>Precio anterior COP<input type="number" min="1" step="1" data-product-field="oldPrice" data-group-id="' + group.id + '" value="' + esc(group.oldPrice) + '"></label>' +
        '<label>Stock general<input type="number" min="0" step="1" data-product-field="stock" data-group-id="' + group.id + '" value="' + esc(group.stock) + '" placeholder="Vacío = sin control"></label>' +
        '<label>Tallas (separadas por coma)<input maxlength="600" data-product-field="sizes" data-group-id="' + group.id + '" value="' + esc(group.sizes) + '" placeholder="S, M, L, XL"></label>' +
        '<label>Color sugerido por nombre de archivo<select data-product-field="color" data-group-id="' + group.id + '">' + colorOptions + '</select></label>' +
        '<label class="wide">Descripción general aplicada<textarea maxlength="4000" data-product-field="description" data-group-id="' + group.id + '">' + esc(group.description) + '</textarea></label>' +
        '</div><div class="bulk-product-images">' + thumbs + '</div>' +
        '<div class="bulk-product-card-actions"><button type="button" data-split-group="' + group.id + '">Separar cada foto</button><button type="button" data-remove-group="' + group.id + '">Quitar producto</button></div>' +
        '</article>';
    }).join("");
  }
  const pageInfo = $("#bulkPaginationLabel");
  if (pageInfo) pageInfo.textContent = groups.length ? "Productos " + (start+1) + "–" + Math.min(start+PAGE_SIZE,groups.length) + " de " + groups.length : "Sin productos";
  const pageInfoBottom = $("#bulkPageStatus");
  if (pageInfoBottom) pageInfoBottom.textContent = groups.length ? "Página " + (page+1) + " de " + pages : "Sin productos";
  const previous = $("#bulkPrevPage"), next = $("#bulkNextPage");
  if (previous) previous.disabled = page <= 0;
  if (next) next.disabled = page >= pages-1;
  const merge = $("#bulkMergeGroups");
  if (merge) merge.disabled = selectedGroups.size < 2 || importing;
  updateStats();
}
function applyDefaults() {
  groups.forEach(group => {
    group.category = $("#bulkCategory").value;
    group.price = $("#bulkPrice").value;
    group.oldPrice = $("#bulkOldPrice").value;
    group.stock = $("#bulkStock").value;
    group.sizes = $("#bulkSizes").value;
    group.description = $("#bulkDescription").value;
  });
  render();
  message("Los valores generales se aplicaron a todos los productos preparados.", "success");
}
function removeGroup(id) {
  groups = groups.filter(group => group.id !== id);
  selectedGroups.delete(id);
  render();
}
function splitGroup(id) {
  const group = groups.find(item => item.id === id);
  if (!group || group.files.length < 2 || group.importedProductId) return;
  const source = group.files.slice();
  groups = groups.filter(item => item.id !== id);
  source.forEach(entry => {
    const stem = filenameStem(entry.file);
    groups.push({
      id:nextGroupId++, name:prettyName(stem,groups.length+1), category:group.category,
      price:group.price, oldPrice:group.oldPrice, stock:group.stock, sizes:group.sizes,
      description:group.description, color:detectColor([entry]), files:[entry],
      importedProductId:null,error:""
    });
  });
  selectedGroups.delete(id);
  render();
}
function mergeSelectedGroups() {
  const chosen = groups.filter(group => selectedGroups.has(group.id) && !group.importedProductId);
  if (chosen.length < 2) return;
  const base = chosen[0];
  chosen.slice(1).forEach(group => base.files.push(...group.files));
  const removeIds = new Set(chosen.slice(1).map(group => group.id));
  groups = groups.filter(group => !removeIds.has(group.id));
  selectedGroups.clear();
  base.error = "";
  render();
  message("Grupos unidos. Revisa el nombre, la categoría y las fotografías antes de importar.", "success");
}
function removeFile(groupId,index) {
  const group = groups.find(item => item.id === groupId);
  if (!group || group.importedProductId) return;
  group.files.splice(index,1);
  if (!group.files.length) removeGroup(groupId);
  else render();
}
function readSizes(value) {
  const sizes = String(value || "").split(/[,;\n]/).map(value => value.trim()).filter(Boolean);
  if (sizes.length > 40) throw new Error("Un producto admite máximo 40 tallas.");
  if (sizes.some(value => value.length > 24)) throw new Error("Cada talla puede tener máximo 24 caracteres.");
  const normalized = new Set();
  for (const size of sizes) {
    const key = normalize(size);
    if (normalized.has(key)) throw new Error("Hay tallas repetidas en " + size + ".");
    normalized.add(key);
  }
  return sizes;
}
function filesForUpload(group) {
  const seen = new Set();
  return group.files.filter(entry => {
    if (!entry.hash) return true;
    if (seen.has(entry.hash)) return false;
    seen.add(entry.hash);
    return true;
  });
}
function validateGroup(group) {
  if (!String(group.name || "").trim()) return "Escribe el nombre del producto.";
  if (!String(group.category || "").trim()) return "Selecciona la categoría.";
  const price = Number(group.price);
  if (!Number.isSafeInteger(price) || price <= 0 || price > 100000000) return "El precio de venta debe ser un entero mayor que cero.";
  const oldPrice = group.oldPrice === "" || group.oldPrice == null ? null : Number(group.oldPrice);
  if (oldPrice !== null && (!Number.isSafeInteger(oldPrice) || oldPrice < price || oldPrice > 100000000)) return "El precio anterior debe ser mayor o igual al precio actual.";
  if (!String(group.description || "").trim()) return "Añade una descripción general o específica.";
  if (!group.files.length) return "Añade al menos una imagen.";
  if (group.files.length > MAX_IMAGES_PER_PRODUCT) return "Supera el máximo de 8 fotos por producto. Separa este grupo.";
  if (!$("#bulkAllowDuplicates").checked && groupHasDuplicateName(group)) return "Ya existe un producto con este nombre; cámbialo o permite duplicados.";
  if ($("#bulkPublishNow").checked && group.name.startsWith("Producto por identificar")) return "Completa el nombre real antes de publicar.";
  try { readSizes(group.sizes); } catch (error) { return error.message; }
  return "";
}
async function uploadOne(entry) {
  if (entry.publicUrl) return entry.publicUrl;
  const file = entry.file;
  const type = fileMime(file);
  if (!type) throw new Error("Formato no compatible: " + file.name);
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) throw new Error("La imagen " + file.name + " supera el límite de 12 MB o está vacía.");
  const signed = await db.adminCall({action:"upload-url",filename:file.name,contentType:type,size:file.size});
  if (!signed || !signed.path || !signed.token || !signed.publicUrl) {
    throw new Error("El servidor no pudo preparar la subida de " + file.name + ".");
  }
  const result = await db.client.storage.from("products-media").uploadToSignedUrl(
    signed.path,signed.token,file,{contentType:type,upsert:false}
  );
  if (result.error) throw new Error("No se pudo subir " + file.name + ": " + result.error.message);
  entry.publicUrl = signed.publicUrl;
  return entry.publicUrl;
}
async function importGroup(group,index,total) {
  group.error = "";
  const uploadEntries = filesForUpload(group);
  const urls = [];
  for (let i=0;i<uploadEntries.length;i++) {
    message("Subiendo imágenes del producto " + (index+1) + " de " + total + " · " + (i+1) + " de " + uploadEntries.length);
    urls.push(await uploadOne(uploadEntries[i]));
  }
  if (!urls.length) throw new Error("No quedaron imágenes válidas para guardar el producto.");
  const price = Number(group.price);
  const oldPrice = group.oldPrice === "" || group.oldPrice == null ? null : Number(group.oldPrice);
  const stock = group.stock === "" || group.stock == null ? null : Number(group.stock);
  const sizes = readSizes(group.sizes);
  const color = group.color && COLORS[group.color] ? [{
    name:group.color,hex:COLORS[group.color],images:urls.slice(0,2)
  }] : [];
  const delivery = $("#bulkDeliveryType").value;
  const payload = {
    action:"save",id:null,name:String(group.name).trim(),category:String(group.category).trim(),
    delivery_type:delivery,target_audiences:[],price_cop:price,old_price_cop:oldPrice,
    stock_quantity:stock,size_variants:sizes,dropi_product_id:"",dropi_variants:[],
    description:String(group.description).trim(),features:[],images:urls.slice(0,MAX_IMAGES_PER_PRODUCT),
    color_variants:color,video_url:null,tag:oldPrice !== null ? "OFERTA" : "NUEVO",
    shipping:"",payment_methods:delivery === "digital" ? ["bold"] : ["bold","cash_on_delivery"],
    is_active:!!$("#bulkPublishNow").checked,sort_order:1000+index,
    printful_enabled:false,printful_sync_variant_id:null
  };
  const result = await db.adminCall(payload);
  if (!result || !result.ok || !result.product || !result.product.id) {
    throw new Error((result && result.error) || "El servidor no confirmó la creación del producto.");
  }
  group.importedProductId = Number(result.product.id);
  group.active = payload.is_active;
  existingNames.add(normalize(group.name));
  return group.importedProductId;
}
async function runImport() {
  if (importing) return;
  if (!authorized || !db?.isConfigured?.()) {
    message("La sesión administrativa no está disponible. Inicia sesión de nuevo.", "error");
    return;
  }
  const pending = groups.filter(group => !group.importedProductId);
  if (!pending.length) {
    message("No hay productos pendientes de importar.", "info");
    return;
  }
  const duplicatePending = new Set();
  const pendingCounts = new Map();
  pending.forEach(group => pendingCounts.set(normalize(group.name),(pendingCounts.get(normalize(group.name))||0)+1));
  if (!$("#bulkAllowDuplicates").checked) pending.forEach(group => {
    if ((pendingCounts.get(normalize(group.name))||0) > 1) duplicatePending.add(group.id);
  });
  const invalid = pending.map(group => ({
    group,
    error:duplicatePending.has(group.id) ? "Hay otro producto preparado con el mismo nombre. Cambia uno de los nombres." : validateGroup(group)
  })).filter(item => item.error);
  invalid.forEach(item => { item.group.error = item.error; });
  if (invalid.length) {
    page = Math.max(0,Math.floor(groups.indexOf(invalid[0].group)/PAGE_SIZE));
    render();
    message("Hay " + invalid.length + " producto(s) por corregir. Revisa las tarjetas marcadas antes de iniciar.", "error");
    return;
  }
  const publishText = $("#bulkPublishNow").checked ? "publicar" : "guardar como borradores";
  if (!window.confirm("Se crearán " + pending.length + " productos y se subirán sus imágenes a Supabase Storage. Se van a " + publishText + ". ¿Continuar?")) return;
  importing = true;
  $("#bulkImportButton").disabled = true;
  $("#bulkFolder").disabled = true;
  $("#bulkImages").disabled = true;
  $("#bulkResetButton").disabled = true;
  const batchSize = Math.max(1,Number($("#bulkBatchSize").value)||10);
  const total = pending.length;
  let completed = 0, succeeded = 0, failed = 0;
  const errors = [];
  progress(0,total,"Preparando importación");
  for (let offset=0;offset<total;offset+=batchSize) {
    const batch = pending.slice(offset,offset+batchSize);
    message("Lote " + (Math.floor(offset/batchSize)+1) + " · productos " + (offset+1) + " a " + Math.min(offset+batchSize,total) + " de " + total);
    for (let i=0;i<batch.length;i+=2) {
      const pair = batch.slice(i,i+2);
      await Promise.all(pair.map(async group => {
        const position = pending.indexOf(group);
        try {
          if (!$("#bulkAllowDuplicates").checked && existingNames.has(normalize(group.name))) {
            throw new Error("El nombre ya existe en el catálogo. Cambia el nombre o permite duplicados.");
          }
          await importGroup(group,position,total);
          succeeded++;
        } catch (error) {
          group.error = error && error.message ? error.message : "Error desconocido al crear el producto.";
          errors.push(group.name + ": " + group.error);
          failed++;
        } finally {
          completed++;
          progress(completed,total,"Procesados " + completed + " de " + total);
          updateStats();
        }
      }));
      render();
    }
  }
  importing = false;
  $("#bulkFolder").disabled = false;
  $("#bulkImages").disabled = false;
  $("#bulkResetButton").disabled = false;
  $("#bulkImportButton").disabled = !groups.some(group => !group.importedProductId);
  if (succeeded) $("#refreshAdminProducts")?.click();
  const report = $("#bulkImportResults");
  if (report) {
    report.innerHTML = '<strong>Resultado de la importación</strong><span>Correctos: ' + succeeded + ' · Con errores: ' + failed + ' · Total: ' + total + '</span>' +
      (errors.length ? '<details><summary>Ver errores (' + errors.length + ')</summary><ul>' + errors.map(error => '<li>' + esc(error) + '</li>').join("") + '</ul></details>' : '');
  }
  message("Importación terminada. Se crearon " + succeeded + " producto(s); " + failed + " quedaron pendientes de corrección.",failed ? "error" : "success");
  render();
}
async function addFiles(fileList) {
  const incoming = Array.from(fileList || []);
  if (!incoming.length) return;
  const valid = [];
  const rejected = [];
  const seen = new Set(entries.map(entry => entry.key));
  incoming.forEach(file => {
    if (!isAllowedImage(file)) { rejected.push(file.name + " (formato no admitido)"); return; }
    if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) { rejected.push(file.name + " (supera 12 MB o está vacío)"); return; }
    const path = file.webkitRelativePath || file.name;
    const key = fileKey(file,path);
    if (seen.has(key)) return;
    seen.add(key);
    valid.push({file,path,hash:"",key,type:fileMime(file)});
  });
  if (!valid.length) {
    message(rejected.length ? "No se añadieron archivos válidos. " + rejected.slice(0,3).join("; ") : "No hay imágenes nuevas para añadir.", "error");
    return;
  }
  entries = entries.concat(valid);
  message("Se añadieron " + valid.length + " imagen(es). Comprobando duplicados…");
  await hashEntries(valid);
  groups = makeGroups(entries);
  page = 0;
  selectedGroups.clear();
  render();
  const globalDuplicates = new Map();
  entries.forEach(entry => {
    if (entry.hash) globalDuplicates.set(entry.hash,(globalDuplicates.get(entry.hash)||0)+1);
  });
  const duplicateCount = Array.from(globalDuplicates.values()).filter(count => count > 1).length;
  message(valid.length + " imagen(es) añadidas; " + groups.length + " producto(s) agrupados." +
    (duplicateCount ? " Se encontraron " + duplicateCount + " contenido(s) repetido(s)." : "") +
    (rejected.length ? " Se omitieron " + rejected.length + " archivo(s) no válidos." : ""),
    rejected.length ? "error" : "success");
}
async function loadExistingProducts() {
  try {
    const result = await db.adminCall({action:"list"});
    const products = Array.isArray(result.products) ? result.products : [];
    existingNames = new Set(products.map(product => normalize(product.name)));
  } catch (_) {
    existingNames = new Set();
  }
}
async function init() {
  if (!db?.isConfigured?.()) return;
  try {
    const session = await db.getSession();
    if (!session) return;
    const me = await db.adminCall({action:"whoami"});
    if (!me || !["owner","admin","catalog_manager"].includes(me.role)) return;
    authorized = true;
    panel.hidden = false;
    await loadExistingProducts();
    render();
    message("Importador habilitado para la cuenta administrativa. Selecciona una carpeta para comenzar.", "success");
  } catch (_) {
    panel.hidden = true;
  }
}

$("#bulkFolder")?.addEventListener("change",event => {
  void addFiles(event.target.files);
  event.target.value = "";
});
$("#bulkImages")?.addEventListener("change",event => {
  void addFiles(event.target.files);
  event.target.value = "";
});
$("#bulkApplyDefaults")?.addEventListener("click",applyDefaults);
$("#bulkMergeGroups")?.addEventListener("click",mergeSelectedGroups);
$("#bulkPrevPage")?.addEventListener("click",() => { page=Math.max(0,page-1);render(); });
$("#bulkNextPage")?.addEventListener("click",() => { page++;render(); });
$("#bulkResetButton")?.addEventListener("click",() => {
  if (importing) return;
  if (entries.length && !window.confirm("¿Quitar las imágenes y los productos preparados de esta importación?")) return;
  cleanupPreviews();
  entries=[];groups=[];selectedGroups.clear();page=0;
  $("#bulkFolder").value="";$("#bulkImages").value="";
  $("#bulkImportResults").innerHTML="";
  progress(0,0,"");
  render();
  message("Importación limpia. Puedes seleccionar otra carpeta.");
});
$("#bulkImportButton")?.addEventListener("click",() => { void runImport(); });
$("#bulkGroupList")?.addEventListener("input",event => {
  const field = event.target.closest("[data-product-field]");
  if (!field) return;
  const group = groups.find(item => item.id === Number(field.dataset.groupId));
  if (!group) return;
  group[field.dataset.productField] = field.value;
});
$("#bulkGroupList")?.addEventListener("change",event => {
  const checkbox = event.target.closest("[data-select-group]");
  if (checkbox) {
    const id = Number(checkbox.dataset.selectGroup);
    if (checkbox.checked) selectedGroups.add(id); else selectedGroups.delete(id);
    const merge = $("#bulkMergeGroups");
    if (merge) merge.disabled = selectedGroups.size < 2 || importing;
  }
});
$("#bulkGroupList")?.addEventListener("click",event => {
  const removeFileButton = event.target.closest("[data-remove-file]");
  if (removeFileButton) {
    removeFile(Number(removeFileButton.dataset.groupId),Number(removeFileButton.dataset.removeFile));
    return;
  }
  const splitButton = event.target.closest("[data-split-group]");
  if (splitButton) {
    splitGroup(Number(splitButton.dataset.splitGroup));
    return;
  }
  const removeGroupButton = event.target.closest("[data-remove-group]");
  if (removeGroupButton) removeGroup(Number(removeGroupButton.dataset.removeGroup));
});

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",() => { void init(); });
else void init();
})();
