
/* Bulk catalog importer for NovaShop. It reuses the authenticated admin-products Edge Function. */
(() => {
"use strict";
const $ = selector => document.querySelector(selector);
const panel = $("#bulkImportPanel");
if (!panel) return;

const db = window.NovaShopDB;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_NOTE_BYTES = 64 * 1024;
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
let loadedNoteText = "";
let productRecords = [];
let productRecordsFromStandalone = false;
let categoryView = "all";
let xlsxLoaderPromise = null;

function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[char]));
}
function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
}
function categoryFromValue(value) {
  const key=normalize(value);
  return CATEGORIES.find(category=>normalize(category)===key) || "";
}
function deliveryTypeFromValue(value, category="") {
  const key=normalize(value);
  if(["digital","servicio digital","producto digital","descargable"].includes(key))return "digital";
  if(["fisico","producto fisico","fisica","mercancia"].includes(key))return "physical";
  return normalize(category)==="streaming" ? "digital" : "";
}
function categoryFromFiles(fileEntries) {
  const matches=(fileEntries||[]).flatMap(entry=>
    String(entry.path||entry.file?.webkitRelativePath||entry.file?.name||"").split("/")
  ).map(categoryFromValue).filter(Boolean);
  const unique=[...new Set(matches)];
  return unique.length===1?unique[0]:"";
}
function fileMime(file) {
  if (file.type && file.type.startsWith("image/")) return file.type.toLowerCase();
  const extension = String(file.name || "").split(".").pop().toLowerCase();
  return MIME_BY_EXT[extension] || "";
}
function isAllowedImage(file) {
  return Object.values(MIME_BY_EXT).includes(fileMime(file));
}
function isTextNote(file) {
  return /\.txt$/i.test(String(file?.name || ""));
}
function noteStatus(text, type) {
  const el = $("#bulkNoteStatus");
  if (!el) return;
  el.textContent = text || "";
  el.className = "bulk-import-help" + (type ? " " + type : "");
}
async function readNoteFile(file) {
  if (!isTextNote(file)) throw new Error("Selecciona un archivo con extensión .txt.");
  if (!file.size || file.size > MAX_NOTE_BYTES) throw new Error("La nota TXT debe tener contenido y pesar máximo 64 KB.");
  let text = await file.text();
  text = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!text) throw new Error("El archivo TXT está vacío.");
  return {text,truncated:false};
}

function parseStructuredProductNote(source) {
  const lines = String(source || "").split(/\n/);
  const records = [];
  let current = null;
  const legacyHeader = /^\s*(.+?)\s*:?\s*ID\s*[:#]?\s*([A-Za-z0-9_-]+)\s*(.*)$/i;

  function cleanName(value) {
    return String(value || "").replace(/[:\s]+$/,"").replace(/^\s+/,"").trim();
  }
  function isPlaceholder(value) {
    const text = normalize(String(value || "").replace(/[()]/g," "));
    return !text || /^(?:que lo ponga la ia|que lo haga la ia|lo pone la ia|lo genera la ia|pendiente|por definir|n a|no aplica)$/.test(text);
  }
  function parseAmount(value) {
    const digits = String(value || "").replace(/[^\d]/g,"");
    if (!digits) return "";
    const amount = Number(digits);
    return Number.isSafeInteger(amount) && amount > 0 ? String(amount) : "";
  }
  function setAudience(record, value) {
    const text = normalize(value);
    if (/unisex/.test(text)) record.audience = "unisex";
    else if (/\bmujer(?:es)?\b/.test(text)) record.audience = "mujer";
    else if (/\bhombre(?:s)?\b/.test(text)) record.audience = "hombre";
  }
  function parseSizes(value) {
    return String(value || "").split(/[,;|]/).map(item=>item.trim()).filter(Boolean);
  }
  function parseInline(record, value) {
    const sizes = value.match(/Tallas?\s*:\s*(.+?)(?=\s+(?:Unisex|Hombre|Mujer)\b|\s+Color\s*:|\s+Descripci[oó]n\s*:|$)/i);
    if (sizes) record.sizes = parseSizes(sizes[1]);
    const color = value.match(/Color\s*:\s*([A-Za-zÁÉÍÓÚáéíóúÑñÜü -]+?)(?=\s+Descripci[oó]n\s*:|$)/i);
    if (color) record.color = color[1].trim();
    setAudience(record,value);
  }
  function buildCreativeDescription(record) {
    const category = normalize(record.category);
    const name = record.name;
    const templates = category === "moda" ? [
      "Expresa tu personalidad con {name}. Una propuesta para darle un toque propio a tus outfits y llevar tus gustos a cada look.",
      "Cada look cuenta algo de ti. {name} te permite sumar un detalle con identidad a tu estilo.",
      "Ponle tu sello a tus combinaciones con {name}, una opción para quienes disfrutan vestir con personalidad."
    ] : category === "accesorios" ? [
      "Los detalles hacen la diferencia. {name} llega para complementar tus combinaciones y darle un toque personal a tu estilo.",
      "Completa tu estilo con {name}, una opción para sumar personalidad a tus accesorios y a tus combinaciones."
    ] : category === "hogar" ? [
      "Los pequeños detalles también transforman un espacio. {name} es una opción para complementar tu ambiente y darle un toque personal.",
      "Dale un aire propio a tus espacios con {name}, una alternativa para complementar tu hogar."
    ] : category === "tecnologia" ? [
      "Descubre {name}, una alternativa para incorporar tecnología a tu día a día. Revisa sus características y conoce lo que ofrece.",
      "Conoce {name}, una opción tecnológica que puedes explorar según las características y detalles de esta ficha."
    ] : category === "oficina" ? [
      "Dale personalidad a tu espacio de trabajo con {name}, una propuesta para complementar tu entorno de estudio u oficina.",
      "Haz que tu espacio refleje tu estilo con {name}, una opción para tener en cuenta en tu ambiente de trabajo."
    ] : category === "belleza" ? [
      "Conoce {name}, una opción para sumar a tu selección de belleza y estilo. Revisa sus detalles y descubre si es lo que buscas.",
      "Los detalles también forman parte de tu estilo. Explora {name} y conoce sus características."
    ] : category === "deportes" ? [
      "Descubre {name}, una opción para quienes disfrutan de las actividades y el movimiento. Conoce sus detalles antes de elegir.",
      "Haz espacio para {name} en tus elecciones deportivas y conoce las características disponibles."
    ] : category === "streaming" ? [
      "Explora {name} y encuentra una alternativa para tu entretenimiento. Consulta los detalles disponibles antes de elegir.",
      "Tu entretenimiento también merece opciones. Conoce {name} y revisa la información de este producto."
    ] : [
      "Descubre {name}, una opción para sumar a tu selección y encontrar un detalle que encaje con tus gustos.",
      "Conoce {name}, una propuesta que puedes explorar y elegir de acuerdo con sus características."
    ];
    const seed = (name + "|" + category).split("").reduce((total,char)=>total+char.charCodeAt(0),0);
    const intro = templates[seed % templates.length].replace(/\{name\}/g,name);
    const facts = [];
    if (record.color) facts.push("Color disponible: " + record.color + ".");
    if (record.sizes.length) facts.push("Tallas disponibles: " + record.sizes.join(", ") + ".");
    if (record.features.length) {
      facts.push("Detalles del producto: " + record.features.join("; ") + ".");
    }
    const closing = category === "moda" || category === "accesorios"
      ? "Elige las opciones disponibles y añade este diseño a tu colección."
      : "Revisa sus detalles y agrégalo a tu carrito si es lo que estás buscando.";
    return [intro].concat(facts).concat([closing]).join(" ").replace(/\s+/g," ").trim();
  }
  function finish(record) {
    if (!record) return;
    record.name = cleanName(record.name);
    record.features = Array.from(new Set(record.features));
    record.description = record.descriptionText || buildCreativeDescription(record);
  }
  function createRecord(name,id) {
    return {
      id:String(id || "").trim(),name:cleanName(name),category:"",price:"",oldPrice:"",
      stock:"",deliveryType:"",sizes:[],audience:"",color:"",
      descriptionText:"",description:"",features:[]
    };
  }

  for (const line of lines) {
    const legacy = line.match(legacyHeader);
    if (legacy) {
      finish(current);
      current = createRecord(legacy[1],legacy[2]);
      parseInline(current,legacy[3] || "");
      records.push(current);
      continue;
    }
    const field = line.match(/^\s*([^:\n]{2,60})\s*:\s*(.*?)\s*$/);
    if (!field) continue;
    const label = field[1].trim();
    const value = field[2].trim();
    const key = normalize(label);

    if (key === "nombre del producto" || key === "nombre del producto dropi" || key === "nombre") {
      finish(current);
      current = createRecord(value,"");
      records.push(current);
      continue;
    }
    if (!current) continue;

    if (key === "id del producto en dropi" || key === "id dropi" || key === "dropi id" || key === "id") {
      current.id = value.replace(/^#\s*/,"").trim();
      continue;
    }
    if (key === "categoria" || key === "categoría") {
      current.category = categoryFromValue(value) || value;
      continue;
    }
    if (key === "stock" || key === "stock general" || key === "existencias" || key === "inventario") {
      current.stock = value.trim();
      continue;
    }
    if (key === "tipo de entrega" || key === "entrega" || key === "delivery type") {
      current.deliveryType = deliveryTypeFromValue(value,current.category);
      continue;
    }
    if (key === "publico objetivo" || key === "publico" || key === "audiencia") {
      setAudience(current,value);
      continue;
    }
    if (key === "precio venta" || key === "precio de venta" || key === "precio") {
      current.price = parseAmount(value);
      continue;
    }
    if (key === "precio anterior" || key === "precio antes") {
      current.oldPrice = parseAmount(value);
      continue;
    }
    if (key === "talla" || key === "tallas") {
      current.sizes = parseSizes(value);
      continue;
    }
    if (key === "color") {
      current.color = value;
      continue;
    }
    if (key === "descripcion" || key === "descripción") {
      if (!isPlaceholder(value)) current.descriptionText = value;
      continue;
    }
    if (key === "caracteristicas" || key === "características") {
      if (!isPlaceholder(value)) {
        value.split(/[;|]/).map(item=>item.trim()).filter(Boolean).forEach(item=>current.features.push(item));
      }
      continue;
    }
    if (!isPlaceholder(value)) current.features.push(label + ": " + value);
  }
  finish(current);
  const valid = records.filter(record=>record.name && record.id);
  const idCounts = new Map();
  valid.forEach(record=>idCounts.set(record.id,(idCounts.get(record.id)||0)+1));
  return valid.filter(record=>idCounts.get(record.id) === 1);
}
let xlsxLoaderPromise = null;
async function loadXlsxLibrary() {
  if (window.XLSX) return window.XLSX;
  if (xlsxLoaderPromise) return xlsxLoaderPromise;
  xlsxLoaderPromise = new Promise((resolve,reject)=>{
    const script=document.createElement("script");
    script.src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
    script.async=true;
    script.onload=()=>window.XLSX?resolve(window.XLSX):reject(new Error("No se pudo cargar el lector de Excel."));
    script.onerror=()=>reject(new Error("No se pudo descargar el lector de Excel. Comprueba tu conexión."));
    document.head.appendChild(script);
  });
  try{return await xlsxLoaderPromise;}
  catch(error){xlsxLoaderPromise=null;throw error;}
}
function excelHeaderValue(row,aliases) {
  const keys=Object.keys(row||{});
  const target=new Set(aliases.map(normalize));
  const key=keys.find(name=>target.has(normalize(name)));
  return key==null?"":String(row[key]??"").trim();
}
async function parseExcelProductFile(file) {
  if(!file || !/\\.(xlsx|xls|csv)$/i.test(file.name||""))throw new Error("Selecciona una plantilla Excel .xlsx, .xls o .csv.");
  if(!file.size || file.size>5*1024*1024)throw new Error("La plantilla Excel debe pesar máximo 5 MB.");
  const XLSX=await loadXlsxLibrary();
  const workbook=XLSX.read(await file.arrayBuffer(),{type:"array",cellDates:false});
  if(!workbook.SheetNames?.length)throw new Error("El archivo no contiene hojas de cálculo.");
  const sheetName=workbook.SheetNames.find(name=>normalize(name)==="productos")||workbook.SheetNames[0];
  const sheet=workbook.Sheets[sheetName];
  const rows=XLSX.utils.sheet_to_json(sheet,{defval:"",raw:false,blankrows:false});
  if(!rows.length)throw new Error("La hoja Productos no contiene filas de productos.");
  if(rows.length>250)throw new Error("Puedes importar máximo 250 productos por archivo. Divide el catálogo en varios lotes.");
  const recordsText=[];
  const seenIds=new Set();
  const rowErrors=[];
  rows.forEach((row,index)=>{
    const rowNumber=index+2;
    const name=excelHeaderValue(row,["Nombre del producto","Nombre","Producto"]);
    const rawId=excelHeaderValue(row,["ID del producto en Dropi","ID Dropi","Dropi ID","ID"]);
    const id=rawId.replace(/\\.0+$/,"").replace(/^#/,"").trim();
    const category=categoryFromValue(excelHeaderValue(row,["Categoría","Categoria"]));
    const audience=excelHeaderValue(row,["Público objetivo","Publico objetivo","Público","Audiencia"]);
    const price=excelHeaderValue(row,["Precio venta","Precio de venta","Precio"]);
    const oldPrice=excelHeaderValue(row,["Precio anterior","Precio antes"]);
    const sizes=excelHeaderValue(row,["Tallas","Talla"]);
    const color=excelHeaderValue(row,["Color"]);
    const description=excelHeaderValue(row,["Descripción","Descripcion"]);
    const features=excelHeaderValue(row,["Características","Caracteristicas"]);
    const stock=excelHeaderValue(row,["Stock","Existencias","Inventario"]);
    const delivery=excelHeaderValue(row,["Tipo de entrega","Entrega"]);
    if(!name&&!id&&!category&&!price&&!sizes&&!color&&!description&&!features&&!stock) return;
    if(!name){rowErrors.push("Fila "+rowNumber+": falta el nombre del producto.");return;}
    if(!id){rowErrors.push("Fila "+rowNumber+" ("+name+"): falta el ID de Dropi.");return;}
    if(seenIds.has(id)){rowErrors.push("Fila "+rowNumber+": el ID "+id+" está repetido.");return;}
    seenIds.add(id);
    const cleanLine=value=>String(value||"").replace(/[\\r\\n]+/g," ").trim();
    recordsText.push([
      "Nombre del producto: "+cleanLine(name),
      "ID del producto en Dropi: "+cleanLine(id),
      category?"Categoría: "+category:"",
      audience?"Público objetivo: "+cleanLine(audience):"",
      price?"Precio venta: "+cleanLine(price):"",
      oldPrice?"Precio anterior: "+cleanLine(oldPrice):"",
      sizes?"Tallas: "+cleanLine(sizes):"",
      color?"Color: "+cleanLine(color):"",
      description?"Descripción: "+cleanLine(description):"Descripción: (Que lo ponga la IA)",
      features?"Características: "+cleanLine(features):"Características: (Que lo ponga la IA)",
      stock!==""?"Stock: "+cleanLine(stock):"",
      delivery?"Tipo de entrega: "+cleanLine(delivery):""
    ].filter(Boolean).join("\\n"));
  });
  if(rowErrors.length)throw new Error("Corrige la plantilla antes de importar:\\n"+rowErrors.slice(0,8).join("\\n")+(rowErrors.length>8?"\\nY "+(rowErrors.length-8)+" error(es) más.":""));
  if(!recordsText.length)throw new Error("No encontré productos válidos en la hoja Productos.");
  const records=parseStructuredProductNote(recordsText.join("\\n\\n"));
  if(records.length!==recordsText.length)throw new Error("Algunas filas no pudieron interpretarse. Comprueba que los IDs de Dropi sean únicos.");
  return records;
}
async function downloadExcelTemplate() {
  try {
    const XLSX=await loadXlsxLibrary();
    const headers=[
      "Nombre del producto","Categoría","Público objetivo","ID del producto en Dropi",
      "Precio venta","Precio anterior","Tallas","Color","Descripción","Características","Stock","Tipo de entrega"
    ];
    const rows=[
      headers,
      ["Camiseta Kakashi","Moda","Unisex","1739450",59900,79900,"S, M, L, XL","Blanco","(Que lo ponga la IA)","(Que lo ponga la IA)",20,"Físico"],
      ["Smartwatch Active X","Tecnología","Hombre","1738794",89900,129900,"","Negro","(Que lo ponga la IA)","(Que lo ponga la IA)",15,"Físico"]
    ];
    const productsSheet=XLSX.utils.aoa_to_sheet(rows);
    productsSheet["!cols"]=[
      {wch:25},{wch:18},{wch:18},{wch:24},{wch:16},{wch:17},
      {wch:19},{wch:15},{wch:38},{wch:38},{wch:12},{wch:18}
    ];
    const guideRows=[
      ["PASO","QUÉ HACER"],
      ["1. Completa Productos","Una fila por producto. Conserva los encabezados de la primera fila."],
      ["2. ID de Dropi","Es el vínculo principal. Escribe el ID exacto y no lo repitas."],
      ["3. Fotografías","Organiza: Fotos/Moda/1739450/foto1.jpg, foto2.jpg. Una carpeta por ID y hasta 8 fotos dentro."],
      ["4. Descripción","Deja (Que lo ponga la IA) o vacío para generar un texto comercial con los datos disponibles."],
      ["5. Características","Escribe datos confirmados separados por punto y coma, o deja (Que lo ponga la IA)."],
      ["6. Precios","Ingresa pesos colombianos como números: 59900."],
      ["7. Tallas","Separa varias tallas con comas: S, M, L, XL."],
      ["8. Stock","Vacío = sin control de inventario. 0 = agotado."],
      ["9. Tipo de entrega","Físico para mercancía; Digital para servicios. Streaming se toma como digital si lo dejas vacío."],
      ["IMPORTANTE","No inventes materiales, medidas, compatibilidades o beneficios. Borra o reemplaza las dos filas de ejemplo."]
    ];
    const guideSheet=XLSX.utils.aoa_to_sheet(guideRows);
    guideSheet["!cols"]=[{wch:25},{wch:92}];
    const book=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book,productsSheet,"Productos");
    XLSX.utils.book_append_sheet(book,guideSheet,"Instrucciones");
    XLSX.writeFile(book,"Plantilla_Importacion_Masiva_NovaShop.xlsx");
    message("Plantilla Excel descargada. Reemplaza o elimina las dos filas de ejemplo antes de importarla.","success");
  } catch(error) {
    message(error?.message||"No se pudo generar la plantilla Excel.","error");
  }
}

function colorFromRecord(value) {
  const target = normalize(value);
  return Object.keys(COLORS).find(color=>normalize(color)===target) || "";
}
function applyProductRecord(group, record) {
  if (!group || !record || group.importedProductId) return;
  group.txtRecordId = record.id;
  group.name = record.name;
  group.dropiProductId = record.id;
  const mappedCategory=categoryFromValue(record.category);
  if (mappedCategory) group.category = mappedCategory;
  if (record.price) group.price = record.price;
  if (record.oldPrice) group.oldPrice = record.oldPrice;
  if (record.stock !== "" && record.stock != null) group.stock = record.stock;
  const delivery=record.deliveryType || deliveryTypeFromValue("",record.category);
  if (delivery) group.deliveryType = delivery;
  if (record.sizes.length) group.sizes = record.sizes.join(", ");
  if (record.audience) group.audience = record.audience;
  const mappedColor = colorFromRecord(record.color);
  if (mappedColor) group.color = mappedColor;
  if (record.features.length) group.features = record.features.slice(0,30);
  if (record.description) group.description = record.description;
  group.txtMatched = true;
  group.error = "";
}
function matchProductRecord(group, usedIds) {
  const source = group.files.map(entry=>[
    entry.file.name,
    entry.path || entry.file.webkitRelativePath || ""
  ].join(" ")).join(" ");
  const matches = productRecords.filter(record=>{
    if (usedIds.has(record.id) || !record.id || !/^[A-Za-z0-9_-]+$/.test(record.id)) return false;
    const exactIdPattern = new RegExp("(^|[^A-Za-z0-9])" + record.id + "(?=$|[^A-Za-z0-9])","i");
    return exactIdPattern.test(source);
  });
  return matches.length === 1 ? matches[0] : null;
}
function applyProductRecordsToGroups() {
  if (!productRecords.length || !groups.length) return;
  const used = new Set(groups.map(group=>group.txtRecordId).filter(Boolean));
  let matched = 0;
  groups.forEach(group=>{
    if (group.importedProductId || group.txtRecordId) return;
    const record = matchProductRecord(group,used);
    if (record) {
      applyProductRecord(group,record);
      used.add(record.id);
      matched++;
    }
  });
  const unassigned = productRecords.length - new Set(groups.map(group=>group.txtRecordId).filter(Boolean)).size;
  noteStatus("TXT interpretado: " + productRecords.length + " fichas con ID único · " + matched +
    " vinculadas por ID exacto presente en los nombres/rutas de las fotos · " + Math.max(0,unassigned) +
    " pendientes de vincular. Asígnalas en cada tarjeta usando el ID de Dropi.",unassigned ? "info" : "success");
}
function assignProductRecord(groupId, recordId) {
  const group = groups.find(item=>item.id===groupId);
  if (!group || group.importedProductId) return;
  if (!recordId) {
    group.txtRecordId = "";
    group.txtMatched = false;
    render();
    return;
  }
  const record = productRecords.find(item=>item.id===recordId);
  if (!record) return;
  const alreadyUsed = groups.find(item=>item.id!==groupId && item.txtRecordId===record.id);
  if (alreadyUsed) {
    message("El ID Dropi " + record.id + " ya está vinculado a otra tarjeta. Cada ID solo puede asignarse una vez.", "error");
    render();
    return;
  }
  applyProductRecord(group,record);
  render();
  message("Ficha vinculada correctamente por ID Dropi " + record.id + ". Se aplicaron sus datos a este producto.","success");
}
function readFeatures(value) {
  const features = Array.isArray(value) ? value : String(value || "").split(/\n|[,;]/);
  return features.map(item=>String(item || "").trim()).filter(Boolean).slice(0,30);
}

function resolveNoteFile(noteFiles) {
  if (noteFiles.length === 1) return noteFiles[0];
  const preferred = noteFiles.filter(file => /^(?:nota|notas|instrucciones|descripci[oó]n|description|readme)\\.txt$/i.test(file.name));
  return preferred.length === 1 ? preferred[0] : null;
}
function setProductRecords(records, filename, standalone=true, label="Excel") {
  productRecords=records;
  productRecordsFromStandalone=standalone;
  if (loadedNoteText && $("#bulkDescription")?.value.trim()===loadedNoteText) $("#bulkDescription").value="";
  loadedNoteText="";
  groups.forEach(group=>{
    if(!group.importedProductId){group.txtRecordId="";group.txtMatched=false;}
  });
  applyProductRecordsToGroups();
  noteStatus(label+" leído: "+records.length+" productos. Las fichas se relacionan por ID exacto de Dropi; completa o revisa las fotografías que queden pendientes.","success");
  render();
  if(groups.length && records.some(record=>groups.every(group=>group.txtRecordId!==record.id))) {
    message(label+" leído. Algunas fichas están pendientes de vincular a sus fotos mediante el ID Dropi.","info");
  } else {
    message(label+" leído y aplicado a las fichas que coinciden por ID Dropi.","success");
  }
}
function setNoteText(text, filename, truncated=false, standalone=false) {
  const field = $("#bulkDescription");
  if (!field) return;
  const records = parseStructuredProductNote(text);
  if (records.length) {
    setProductRecords(records,filename,standalone,"TXT");
    return;
  }
  productRecords = [];
  productRecordsFromStandalone = false;
  const generalText = text.slice(0,4000);
  const wasTruncated = truncated || text.length > 4000;
  field.value = generalText;
  loadedNoteText = generalText;
  groups.forEach(group => {
    if (!group.importedProductId) {
      group.description = generalText;
      group.txtRecordId = "";
      group.txtMatched = false;
    }
  });
  noteStatus("Nota general cargada: se aplicó como descripción a " +
    groups.filter(group => !group.importedProductId).length + " producto(s) pendiente(s)." +
    (wasTruncated ? " Se limitaron los primeros 4.000 caracteres." : ""), wasTruncated ? "error" : "success");
  render();
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
        id:nextGroupId++, name:prettyName(label,map.size+1),
        category:categoryFromFiles([entry])||$("#bulkCategory")?.value||"",
        deliveryType:deliveryTypeFromValue($("#bulkDeliveryType")?.value||""),
        price:$("#bulkPrice")?.value||"", oldPrice:$("#bulkOldPrice")?.value||"",
        stock:$("#bulkStock")?.value||"", sizes:$("#bulkSizes")?.value||"",
        description:$("#bulkDescription")?.value||"", color:"",
        audience:$("#bulkAudience")?.value||"",
        dropiProductId:"", features:[], txtRecordId:"", txtMatched:false,
        files:[], importedProductId:null, error:""
      });
    }
    map.get(key).files.push(entry);
  });
  const result = Array.from(map.values()).map(group => {
    group.color = detectColor(group.files);
    return group;
  });
  return result;
}

let aiExtractorPromise = null;
let aiProcessing = false;

function cosineSimilarity(a,b) {
  if (!a || !b || a.length !== b.length || !a.length) return -1;
  let dot = 0;
  for (let i=0;i<a.length;i++) dot += a[i] * b[i];
  return dot;
}
function currentAiThreshold() {
  const value = Number($("#bulkAiThreshold")?.value || 78);
  return Math.max(0.65,Math.min(0.95,value/100));
}
function createAiGroup(fileEntries,index,minimumSimilarity,analysisFailed=false) {
  const firstNamed = fileEntries.find(entry => !isGenericName(filenameStem(entry.file)));
  const sourceName = firstNamed ? filenameStem(firstNamed.file) : "";
  return {
    id:nextGroupId++,
    name:prettyName(sourceName,index+1),
    category:categoryFromFiles(fileEntries)||$("#bulkCategory")?.value||"",
    deliveryType:deliveryTypeFromValue($("#bulkDeliveryType")?.value||""),
    price:$("#bulkPrice")?.value||"",
    oldPrice:$("#bulkOldPrice")?.value||"",
    stock:$("#bulkStock")?.value||"",
    sizes:$("#bulkSizes")?.value||"",
    description:$("#bulkDescription")?.value||"",
    color:detectColor(fileEntries),
    audience:$("#bulkAudience")?.value||"",
    dropiProductId:"", features:[], txtRecordId:"", txtMatched:false,
    files:fileEntries.slice(),
    importedProductId:null,
    error:"",
    aiSimilarity:minimumSimilarity,
    aiSuggested:true,
    aiAnalysisFailed:analysisFailed,
    aiError:analysisFailed?(fileEntries[0]?.aiError||"No se pudo analizar esta imagen con el modelo visual."):""
  };
}
function rebuildAiGroups() {
  const previousRecordByFile = new Map();
  groups.forEach(group=>{
    if (group.txtRecordId) group.files.forEach(entry=>previousRecordByFile.set(entry,group.txtRecordId));
  });
  const threshold=currentAiThreshold();
  const vectors=entries.filter(entry=>entry.aiVector && entry.aiVector.length);
  const failed=entries.filter(entry=>!entry.aiVector || !entry.aiVector.length);
  if (!vectors.length) {
    message("No hay representaciones visuales disponibles. Vuelve a intentar el análisis de IA.", "error");
    return;
  }

  // Complete-link style grouping: every photo in a candidate group must be
  // sufficiently similar to every other photo in that group.
  const clusters=[];
  for (const entry of vectors) {
    let bestCluster=null;
    let bestMinimum=threshold;
    for (const cluster of clusters) {
      let minimum=1;
      for (const member of cluster.items) {
        minimum=Math.min(minimum,cosineSimilarity(entry.aiVector,member.aiVector));
        if (minimum < bestMinimum) break;
      }
      if (minimum >= bestMinimum) {
        bestMinimum=minimum;
        bestCluster=cluster;
      }
    }
    if (bestCluster) {
      bestCluster.items.push(entry);
      bestCluster.minimum=bestCluster.minimum==null?bestMinimum:Math.min(bestCluster.minimum,bestMinimum);
    } else {
      clusters.push({items:[entry],minimum:null});
    }
  }

  // Failed images remain separate; do not silently assign unknown photos.
  failed.forEach(entry=>clusters.push({items:[entry],minimum:null,analysisFailed:true}));

  groups=clusters.map((cluster,index)=>createAiGroup(
    cluster.items,index,cluster.minimum,!!cluster.analysisFailed
  ));
  groups.forEach(group=>{
    const assignedIds = new Set(group.files.map(entry=>previousRecordByFile.get(entry)).filter(Boolean));
    if (assignedIds.size === 1) {
      const record = productRecords.find(item=>item.id === Array.from(assignedIds)[0]);
      if (record) applyProductRecord(group,record);
    }
  });
  applyProductRecordsToGroups();
  page=0;
  selectedGroups.clear();
  render();

  const grouped=groups.filter(group=>group.files.length>1).length;
  message(
    "IA visual lista: "+vectors.length+" fotos analizadas · "+groups.length+
    " grupos sugeridos · "+grouped+" grupos con varias fotos"+
    (failed.length?" · "+failed.length+" foto(s) sin analizar, separadas para revisión":"")+
    ". Revisa las tarjetas y ajusta la similitud si hace falta.",
    failed.length?"error":"success"
  );
}
async function getAiExtractor() {
  if (aiExtractorPromise) return aiExtractorPromise;
  aiExtractorPromise=(async()=>{
    message("Cargando el motor de IA visual desde Hugging Face. La primera carga puede tardar un poco…");
    const library=await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1");
    if (library.env) {
      library.env.allowLocalModels=false;
      library.env.useBrowserCache=true;
    }
    const extractor=await library.pipeline(
      "image-feature-extraction",
      "Xenova/clip-vit-base-patch32",
      {revision:"d15189d7028b43f1d3e65039190477f6af591c2a"}
    );
    return {extractor,RawImage:library.RawImage};
  })().catch(error=>{
    aiExtractorPromise=null;
    throw error;
  });
  return aiExtractorPromise;
}
async function runVisualAi() {
  if (aiProcessing || importing || !entries.length) return;
  if (groups.some(group=>group.importedProductId)) {
    message("Ya se importaron productos en esta sesión. Limpia la importación antes de volver a agrupar, para evitar duplicados.", "error");
    return;
  }
  aiProcessing=true;
  const button=$("#bulkVisualAiButton");
  const addFolder=$("#bulkFolder"),addFilesInput=$("#bulkImages");
  if (button) {button.disabled=true;button.textContent="Analizando…";}
  if (addFolder) addFolder.disabled=true;
  if (addFilesInput) addFilesInput.disabled=true;
  const missing=entries.filter(entry=>!entry.aiVector);
  let analyzed=0,failed=0;
  try {
    const model=await getAiExtractor();
    const total=missing.length;
    progress(0,total,"Preparando el análisis visual");
    for (const entry of missing) {
      try {
        message("IA visual: analizando "+(analyzed+failed+1)+" de "+total+" · "+entry.file.name);
        const image=await model.RawImage.fromBlob(entry.file);
        const output=await model.extractor(image);
        const raw=output?.data;
        if (!raw || !raw.length) throw new Error("El modelo no devolvió características visuales.");
        const vector=Float32Array.from(raw);
        let norm=0;
        for (let i=0;i<vector.length;i++) norm+=vector[i]*vector[i];
        norm=Math.sqrt(norm);
        if (!Number.isFinite(norm) || norm===0) throw new Error("La representación visual está vacía.");
        for (let i=0;i<vector.length;i++) vector[i]/=norm;
        entry.aiVector=vector;
        analyzed++;
      } catch(error) {
        entry.aiVector=null;
        entry.aiError=String(error?.message||"No se pudo analizar esta imagen.").slice(0,200);
        failed++;
      }
      progress(analyzed+failed,total,"Analizadas "+(analyzed+failed)+" de "+total);
      updateStats();
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    rebuildAiGroups();
  } catch(error) {
    message("No se pudo iniciar la IA visual: "+String(error?.message||error)+". Comprueba tu conexión y vuelve a intentarlo.", "error");
  } finally {
    aiProcessing=false;
    if (button) {button.textContent="✦ Agrupar con IA visual";button.disabled=!authorized||!entries.length||importing;}
    if (addFolder) addFolder.disabled=false;
    if (addFilesInput) addFilesInput.disabled=false;
    const recluster=$("#bulkReclusterAiButton");
    if (recluster) recluster.disabled=!entries.some(entry=>entry.aiVector?.length);
    updateStats();
  }
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
  const canSave = authorized && !importing && !aiProcessing && groups.some(group => !group.importedProductId);
  const importButton = $("#bulkImportButton");
  const importButtonBottom = $("#bulkImportButtonBottom");
  if (importButton) importButton.disabled = !canSave;
  if (importButtonBottom) importButtonBottom.disabled = !canSave;
  const hasImported=groups.some(group=>group.importedProductId);
  const aiButton=$("#bulkVisualAiButton");
  if (aiButton) aiButton.disabled=!authorized||importing||aiProcessing||!entries.length||hasImported;
  const recluster=$("#bulkReclusterAiButton");
  if (recluster) recluster.disabled=aiProcessing||importing||hasImported||!entries.some(entry=>entry.aiVector?.length);
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
      const audienceOptions = [
        '<option value="">Selecciona público</option>',
        '<option value="hombre"' + (group.audience === "hombre" ? " selected" : "") + '>Hombre</option>',
        '<option value="mujer"' + (group.audience === "mujer" ? " selected" : "") + '>Mujer</option>',
        '<option value="unisex"' + (group.audience === "unisex" ? " selected" : "") + '>Unisex</option>'
      ].join("");
      const txtRecordOptions = ['<option value="">Sin ficha TXT asignada</option>'].concat(productRecords.map(record=>{
        const usedElsewhere = groups.some(other=>other.id !== group.id && other.txtRecordId === record.id);
        return '<option value="' + esc(record.id) + '"' + (group.txtRecordId === record.id ? " selected" : "") +
          (usedElsewhere ? " disabled" : "") + '>' +
          esc(record.name + " · Dropi " + record.id + (usedElsewhere ? " · ya asignado" : "")) + '</option>';
      })).join("");
      const duplicateWarning = groupHasDuplicateName(group) ?
        '<div class="bulk-product-warning">Ya existe un producto con este nombre en NovaShop. Cambia el nombre o activa la opción para permitir duplicados.</div>' : "";
      const genericWarning = group.name.startsWith("Producto por identificar") ?
        '<div class="bulk-product-warning">El nombre viene de un archivo genérico. Escribe el nombre real antes de publicar.</div>' : "";
      const imageWarning = group.files.length > MAX_IMAGES_PER_PRODUCT ?
        '<div class="bulk-product-warning">Este grupo tiene ' + group.files.length + ' fotos; el catálogo admite máximo ' + MAX_IMAGES_PER_PRODUCT + '. Sepáralas o quita las sobrantes.</div>' : "";
      const imported = group.importedProductId ?
        '<div class="bulk-product-success">Guardado como producto #' + group.importedProductId + ' · ' + (group.active ? "publicado" : "borrador") + '</div>' : "";
      const error = group.error ? '<div class="bulk-product-error">' + esc(group.error) + '</div>' : "";
      const aiWarning = group.aiAnalysisFailed ? '<div class="bulk-product-warning">La IA no pudo analizar esta imagen. Quedó separada para que la revises. '+esc(group.aiError)+'</div>' : "";
      return '<article class="bulk-product-card' + (group.importedProductId ? ' is-imported' : '') + (group.error ? ' is-error' : '') + '" data-card-group="' + group.id + '">' +
        '<div class="bulk-product-top"><label><input type="checkbox" data-select-group="' + group.id + '"' + (selectedGroups.has(group.id) ? " checked" : "") + '> Seleccionar para unir</label>' +
        '<strong>' + group.files.length + ' foto(s)' + (group.aiSimilarity!=null?' · IA '+Math.round(group.aiSimilarity*100)+'%':'') + '</strong></div>' + imported + error + aiWarning + duplicateWarning + genericWarning + imageWarning +
        '<div class="bulk-product-fields">' +
        (productRecords.length ? '<label class="wide">Vincular ficha por ID Dropi<select data-product-record="' + group.id + '">' + txtRecordOptions + '</select><span class="bulk-import-help">Elige el ID exacto que corresponde a este grupo de fotos. Si el ID aparece en el nombre de archivo o carpeta, se vincula automáticamente.</span></label>' : '') +
        (group.txtMatched ? '<div class="bulk-product-note-match wide">Ficha del TXT aplicada: Dropi ' + esc(group.txtRecordId) + '</div>' : '') +
        '<label class="wide">Nombre del producto *<input data-product-field="name" data-group-id="' + group.id + '" maxlength="140" value="' + esc(group.name) + '"></label>' +
        '<label>Categoría *<select data-product-field="category" data-group-id="' + group.id + '">' + categoryOptions + '</select></label>' +
        '<label>Público objetivo *<select data-product-field="audience" data-group-id="' + group.id + '">' + audienceOptions + '</select></label>' +
        '<label>ID del producto en Dropi (opcional)<input type="text" maxlength="100" data-product-field="dropiProductId" data-group-id="' + group.id + '" value="' + esc(group.dropiProductId || "") + '" placeholder="ID exacto del producto"></label>' +
        '<label>Precio de venta COP *<input type="number" min="1" step="1" data-product-field="price" data-group-id="' + group.id + '" value="' + esc(group.price) + '"></label>' +
        '<label>Precio anterior COP<input type="number" min="1" step="1" data-product-field="oldPrice" data-group-id="' + group.id + '" value="' + esc(group.oldPrice) + '"></label>' +
        '<label>Stock general<input type="number" min="0" step="1" data-product-field="stock" data-group-id="' + group.id + '" value="' + esc(group.stock) + '" placeholder="Vacío = sin control"></label>' +
        '<label>Tallas (separadas por coma)<input maxlength="600" data-product-field="sizes" data-group-id="' + group.id + '" value="' + esc(group.sizes) + '" placeholder="S, M, L, XL"></label>' +
        '<label>Color sugerido por nombre de archivo<select data-product-field="color" data-group-id="' + group.id + '">' + colorOptions + '</select></label>' +
        '<label class="wide">Descripción del producto<textarea maxlength="4000" data-product-field="description" data-group-id="' + group.id + '">' + esc(group.description) + '</textarea></label>' +
        '<label class="wide">Características (una por línea)<textarea maxlength="3000" data-product-field="featuresText" data-group-id="' + group.id + '" placeholder="Tela: Algodón peinado">' + esc((group.features || []).join("\n")) + '</textarea></label>' +
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
    group.deliveryType = $("#bulkDeliveryType").value;
    group.price = $("#bulkPrice").value;
    group.oldPrice = $("#bulkOldPrice").value;
    group.stock = $("#bulkStock").value;
    group.sizes = $("#bulkSizes").value;
    if ($("#bulkDescription").value.trim()) group.description = $("#bulkDescription").value;
    group.audience = $("#bulkAudience").value;
  });
  render();
  message("Los valores generales se aplicaron a todos los productos preparados.", "success");
}
function removeGroup(id) {
  const removed = groups.find(group => group.id === id);
  if (removed) {
    const removedFiles = new Set(removed.files);
    entries = entries.filter(entry => !removedFiles.has(entry));
  }
  groups = groups.filter(group => group.id !== id);
  selectedGroups.delete(id);
  render();
}
function splitGroup(id) {
  const group = groups.find(item => item.id === id);
  if (!group || group.files.length < 2 || group.importedProductId) return;
  const source = group.files.slice();
  groups = groups.filter(item => item.id !== id);
  source.forEach((entry,index) => {
    const stem = filenameStem(entry.file);
    groups.push({
      id:nextGroupId++, name:prettyName(stem,groups.length+1), category:group.category,
      price:group.price, oldPrice:group.oldPrice, stock:group.stock, sizes:group.sizes,
      description:group.description, color:detectColor([entry]), audience:group.audience,
      deliveryType:group.deliveryType||"physical",
      dropiProductId:index===0?(group.dropiProductId||""):"",
      features:(group.features || []).slice(), txtRecordId:index===0?(group.txtRecordId||""):"", txtMatched:index===0&&!!group.txtMatched,
      files:[entry], importedProductId:null,error:""
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
  const removed = group.files.splice(index,1)[0];
  if (removed) entries = entries.filter(entry => entry !== removed);
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
  if (!["hombre","mujer","unisex"].includes(String(group.audience || "").toLowerCase())) return "Selecciona si el producto es para Hombre, Mujer o Unisex.";
  if (String(group.dropiProductId || "").trim().length > 100) return "El ID del producto en Dropi admite máximo 100 caracteres.";
  const price = Number(group.price);
  if (!Number.isSafeInteger(price) || price <= 0 || price > 100000000) return "El precio de venta debe ser un entero mayor que cero.";
  const oldPrice = group.oldPrice === "" || group.oldPrice == null ? null : Number(group.oldPrice);
  if (oldPrice !== null && (!Number.isSafeInteger(oldPrice) || oldPrice < price || oldPrice > 100000000)) return "El precio anterior debe ser mayor o igual al precio actual.";
  if (!String(group.description || "").trim()) return "Añade una descripción general o específica.";
  if (group.stock !== "" && group.stock != null && (!Number.isSafeInteger(Number(group.stock)) || Number(group.stock)<0)) return "El stock debe ser un número entero igual o mayor que cero.";
  if (!["physical","digital"].includes(group.deliveryType||$("#bulkDeliveryType")?.value)) return "Selecciona el tipo de entrega.";
  if (!group.files.length) return "Añade al menos una imagen.";
  if (group.files.length > MAX_IMAGES_PER_PRODUCT) return "Supera el máximo de 8 fotos por producto. Separa este grupo.";
  if (!$("#bulkAllowDuplicates").checked && groupHasDuplicateName(group)) return "Ya existe un producto con este nombre; cámbialo o permite duplicados.";
  if ($("#bulkPublishNow").checked && group.name.startsWith("Producto por identificar")) return "Completa el nombre real antes de publicar.";
  try { readSizes(group.sizes); } catch (error) { return error.message; }
  if (Array.isArray(group.features) && group.features.length > 30) return "Un producto admite máximo 30 características.";
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
  const delivery = group.deliveryType || $("#bulkDeliveryType").value;
  const audience = String(group.audience || "").toLowerCase();
  const targetAudiences = audience === "unisex" ? ["hombre","mujer"] : [audience];
  const payload = {
    action:"save",id:null,name:String(group.name).trim(),category:String(group.category).trim(),
    delivery_type:delivery,target_audiences:targetAudiences,price_cop:price,old_price_cop:oldPrice,
    stock_quantity:stock,size_variants:sizes,dropi_product_id:String(group.dropiProductId || "").trim(),dropi_variants:[],
    description:String(group.description).trim(),features:readFeatures(group.features),images:urls.slice(0,MAX_IMAGES_PER_PRODUCT),
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
  if ($("#bulkImportButtonBottom")) $("#bulkImportButtonBottom").disabled = true;
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
  const canSaveAgain = groups.some(group => !group.importedProductId);
  $("#bulkImportButton").disabled = !canSaveAgain;
  if ($("#bulkImportButtonBottom")) $("#bulkImportButtonBottom").disabled = !canSaveAgain;
  if (succeeded) $("#refreshAdminProducts")?.click();
  const report = $("#bulkImportResults");
  if (report) {
    report.innerHTML = '<strong>Resultado de la importación</strong><span>Correctos: ' + succeeded + ' · Con errores: ' + failed + ' · Total: ' + total + '</span>' +
      (errors.length ? '<details><summary>Ver errores (' + errors.length + ')</summary><ul>' + errors.map(error => '<li>' + esc(error) + '</li>').join("") + '</ul></details>' : '');
  }
  message("Importación terminada. Se crearon " + succeeded + " producto(s); " + failed + " quedaron pendientes de corrección.",failed ? "error" : "success");
  render();
}
async function addFiles(fileList, options={}) {
  const incoming = Array.from(fileList || []);
  if (!incoming.length) return;
  if (groups.some(group=>group.importedProductId)) {
    message("Ya se importaron productos en esta sesión. Limpia la importación antes de añadir nuevas imágenes.", "error");
    return;
  }
  const replaceSelection = options.replace === true;
  if (replaceSelection && !productRecordsFromStandalone) productRecords = [];
  const noteFiles = incoming.filter(isTextNote);
  const imageFiles = incoming.filter(isAllowedImage);
  const unsupported = incoming.filter(file => !isTextNote(file) && !isAllowedImage(file));
  let noteInfo = null;
  let noteFile = null;
  let noteError = "";
  if (noteFiles.length) {
    noteFile = resolveNoteFile(noteFiles);
    if (!noteFile) {
      noteError = "Se encontraron varios TXT y no pude identificar una nota única. Usa «Cargar nota TXT» para elegir el archivo correcto.";
    } else {
      try {
        noteInfo = await readNoteFile(noteFile);
      } catch (error) {
        noteError = error?.message || "No se pudo leer el archivo TXT.";
      }
    }
  }

  const valid = [];
  const rejected = unsupported.map(file => file.name + " (formato no admitido)");
  const baseEntries = replaceSelection ? [] : entries;
  const seen = new Set(baseEntries.map(entry => entry.key));
  imageFiles.forEach(file => {
    if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) { rejected.push(file.name + " (supera 12 MB o está vacío)"); return; }
    const path = file.webkitRelativePath || file.name;
    const key = fileKey(file,path);
    if (seen.has(key)) return;
    seen.add(key);
    valid.push({file,path,hash:"",key,type:fileMime(file)});
  });

  if (replaceSelection && valid.length) {
    cleanupPreviews();
    entries = [];
    groups = [];
    selectedGroups.clear();
    page = 0;
    $("#bulkImportResults").innerHTML = "";
    if (!noteInfo && loadedNoteText && $("#bulkDescription").value.trim() === loadedNoteText) {
      $("#bulkDescription").value = "";
      loadedNoteText = "";
      noteStatus("No se encontró un TXT en la nueva carpeta. Puedes escribir una descripción o cargar otra nota.");
    }
  }
  if (noteInfo) setNoteText(noteInfo.text,noteFile.name,noteInfo.truncated);
  else if (noteError) noteStatus(noteError,"error");

  if (!valid.length) {
    render();
    if (noteInfo) {
      message("Nota TXT cargada correctamente. Ahora selecciona una carpeta con imágenes para preparar los productos.", "success");
    } else {
      message(noteError || (rejected.length ? "No se añadieron imágenes válidas. " + rejected.slice(0,3).join("; ") : "No hay imágenes nuevas para añadir."), "error");
    }
    return;
  }
  entries = entries.concat(valid);
  message((replaceSelection ? "Se reemplazó la selección anterior. " : "") +
    (noteInfo ? "Nota TXT leída. " : "") + "Se añadieron " + valid.length + " imagen(es). Comprobando duplicados…");
  await hashEntries(valid);
  groups = makeGroups(entries);
  applyProductRecordsToGroups();
  page = 0;
  selectedGroups.clear();
  render();
  const globalDuplicates = new Map();
  entries.forEach(entry => {
    if (entry.hash) globalDuplicates.set(entry.hash,(globalDuplicates.get(entry.hash)||0)+1);
  });
  const duplicateCount = Array.from(globalDuplicates.values()).filter(count => count > 1).length;
  message(valid.length + " imagen(es) añadidas; " + groups.length + " producto(s) agrupados." +
    (noteInfo ? " Nota TXT aplicada como descripción general." : "") +
    (noteError ? " " + noteError : "") +
    (duplicateCount ? " Se encontraron " + duplicateCount + " contenido(s) repetido(s)." : "") +
    (rejected.length ? " Se omitieron " + rejected.length + " archivo(s) no válidos." : ""),
    (rejected.length || noteError) ? "error" : "success");
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
  void addFiles(event.target.files,{replace:true});
  event.target.value = "";
});
$("#bulkImages")?.addEventListener("change",event => {
  void addFiles(event.target.files);
  event.target.value = "";
});
$("#bulkNoteFile")?.addEventListener("change",async event => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const note = await readNoteFile(file);
    setNoteText(note.text,file.name,note.truncated,true);
    message("Nota TXT cargada y aplicada a los productos pendientes.",note.truncated ? "error" : "success");
  } catch (error) {
    noteStatus(error?.message || "No se pudo leer la nota TXT.","error");
    message(error?.message || "No se pudo leer la nota TXT.","error");
  }
});
$("#bulkVisualAiButton")?.addEventListener("click",()=>{void runVisualAi();});
$("#bulkAiThreshold")?.addEventListener("input",event=>{
  const output=$("#bulkAiThresholdValue");
  if(output)output.textContent=String(event.target.value)+"%";
});
$("#bulkReclusterAiButton")?.addEventListener("click",()=>{
  if(!entries.some(entry=>entry.aiVector?.length))return;
  rebuildAiGroups();
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
  productRecords=[];
  productRecordsFromStandalone=false;
  $("#bulkFolder").value="";$("#bulkImages").value="";
  if ($("#bulkNoteFile")) $("#bulkNoteFile").value="";
  $("#bulkImportResults").innerHTML="";
  progress(0,0,"");
  render();
  noteStatus("Importación limpia. Puedes seleccionar una nueva carpeta y su TXT.");
  message("Importación limpia. Puedes seleccionar otra carpeta.");
});
$("#bulkImportButton")?.addEventListener("click",() => { void runImport(); });
$("#bulkImportButtonBottom")?.addEventListener("click",() => { void runImport(); });
$("#bulkGroupList")?.addEventListener("input",event => {
  const field = event.target.closest("[data-product-field]");
  if (!field) return;
  const group = groups.find(item => item.id === Number(field.dataset.groupId));
  if (!group) return;
  if (field.dataset.productField === "featuresText") group.features = readFeatures(field.value);
  else group[field.dataset.productField] = field.value;
});
$("#bulkGroupList")?.addEventListener("change",event => {
  const recordSelector = event.target.closest("[data-product-record]");
  if (recordSelector) {
    assignProductRecord(Number(recordSelector.dataset.productRecord),recordSelector.value);
    return;
  }
  const field = event.target.closest("[data-product-field]");
  if (field) {
    const group = groups.find(item => item.id === Number(field.dataset.groupId));
    if (group) {
      if (field.dataset.productField === "featuresText") group.features = readFeatures(field.value);
      else group[field.dataset.productField] = field.value;
    }
  }
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
