import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ROLES = new Set(["owner","admin","catalog_manager"]);
const CATEGORIES = ["Tecnología","Hogar","Moda","Accesorios","Oficina","Streaming","Belleza","Deportes","Otra"];
const json = (body: unknown, status = 200, origin = "*") => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  }
});
function parseKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed.default === "string" ? parsed.default : undefined;
  } catch { return undefined; }
}
const clean = (value: unknown, max = 500) => String(value ?? "").trim().slice(0,max);
function getOutputText(payload: any): string {
  const parts = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of parts) {
    if (!Array.isArray(item?.content)) continue;
    for (const content of item.content) {
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}
const productSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name_suggestion: {type:"string"},
    category: {type:"string",enum:CATEGORIES},
    audience: {type:"string",enum:["hombre","mujer","unisex","unknown"]},
    color: {type:"string"},
    description: {type:"string"},
    features: {type:"array",items:{type:"string"},maxItems:6},
    visual_summary: {type:"string"},
    confidence: {type:"string",enum:["high","medium","low"]},
    needs_review: {type:"array",items:{type:"string"},maxItems:6}
  },
  required:["name_suggestion","category","audience","color","description","features","visual_summary","confidence","needs_review"]
};

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin") || "*";
  if (req.method === "OPTIONS") return new Response("ok", {headers:{
    "Access-Control-Allow-Origin":origin,"Vary":"Origin",
    "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type, x-supabase-api-version",
    "Access-Control-Allow-Methods":"POST, OPTIONS"
  }});
  if (req.method !== "POST") return json({error:"Método no permitido."},405,origin);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const publishable = parseKey(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")) || Deno.env.get("SUPABASE_ANON_KEY");
    const secret = parseKey(Deno.env.get("SUPABASE_SECRET_KEYS")) || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !publishable || !secret) return json({error:"El servidor administrativo no está configurado."},500,origin);

    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i,"");
    if (!token || token === publishable || token.split(".").length !== 3) {
      return json({error:"Inicia sesión con una cuenta administrativa."},401,origin);
    }
    const admin = createClient(supabaseUrl,secret,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:userResult,error:userError} = await admin.auth.getUser(token);
    if (userError || !userResult.user) return json({error:"Tu sesión no es válida. Inicia sesión de nuevo."},401,origin);
    const user = userResult.user;
    const {data:roleRecord,error:roleError} = await admin.from("store_user_roles").select("role").eq("user_id",user.id).maybeSingle();
    if (roleError) throw roleError;
    const {data:legacyGrant,error:grantError} = await admin.from("store_admins").select("user_id").eq("user_id",user.id).maybeSingle();
    if (grantError) throw grantError;
    const role = roleRecord?.role || (legacyGrant ? "owner" : null);
    if (!role || !ALLOWED_ROLES.has(role)) return json({error:"No tienes permisos para utilizar el asistente de catálogo."},403,origin);

    const raw = await req.text();
    if (raw.length > 6_000_000) return json({error:"La solicitud supera el límite de 6 MB. Reduce el número o el tamaño de las fotografías."},413,origin);
    let body: any;
    try { body = JSON.parse(raw); } catch { return json({error:"Solicitud JSON no válida."},400,origin); }
    const action = String(body?.action || "");
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    const model = clean(Deno.env.get("OPENAI_CATALOG_MODEL") || "gpt-6-luna",80);

    if (action === "status") {
      return json({
        ok:true,localAvailable:true,advancedAvailable:!!apiKey,
        provider:apiKey?"openai":"local",
        model:apiKey?model:null,
        message:apiKey?"El análisis visual avanzado está configurado.":"El modo local está disponible. Configura OPENAI_API_KEY en los secretos de Supabase para activar el análisis visual avanzado."
      },200,origin);
    }
    if (action !== "analyze") return json({error:"Acción no reconocida."},400,origin);
    if (!apiKey) return json({error:"El análisis avanzado aún no está configurado. Añade OPENAI_API_KEY en los secretos de Supabase; el modo local seguirá disponible mientras tanto."},503,origin);

    const product = body.product && typeof body.product === "object" ? body.product : {};
    const name = clean(product.name,140);
    const category = clean(product.category,80);
    const productId = clean(product.dropi_id,100);
    const images = Array.isArray(body.images) ? body.images : [];
    if (!name && !productId && !images.length) return json({error:"Envía datos o fotografías del producto para analizar."},400,origin);
    if (images.length > 4) return json({error:"Envía máximo 4 fotografías por producto para controlar el tamaño y el coste."},400,origin);
    const imageInputs: any[] = [];
    for (const item of images) {
      const dataUrl = clean(item,1_200_000);
      const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
      if (!match) return json({error:"Una imagen no tiene un formato válido. Usa JPG, PNG, WEBP o GIF."},400,origin);
      if (match[2].length > 1_100_000) return json({error:"Una fotografía sigue siendo demasiado grande después de comprimirla."},413,origin);
      imageInputs.push({type:"input_image",image_url:dataUrl,detail:"low"});
    }

    const knownFacts = {
      name,category,audience:clean(product.audience,30),
      dropi_id:productId,color:clean(product.color,60),
      sizes:clean(product.sizes,300),supplier_description:clean(product.description,1200),
      supplied_features:Array.isArray(product.features)?product.features.slice(0,12).map((v:unknown)=>clean(v,160)):[]
    };
    const inputContent:any[] = [{
      type:"input_text",
      text:"Analiza este producto para el catálogo de NovaShop. Los datos siguientes proceden del administrador y son más fiables que una suposición visual:\n"+
        JSON.stringify(knownFacts)+"\n\n"+
        "Devuelve sugerencias comerciales basadas solo en lo que se puede confirmar. No inventes composición de tela, materiales internos, medidas, capacidad, batería, compatibilidad, certificaciones, garantías, contenido del paquete, funciones ni beneficios técnicos. Si no es evidente una categoría o público, utiliza una opción prudente o unknown. No atribuyas nombres de personajes/marcas por semejanza si no aparecen confirmados. La descripción debe ser clara, atractiva y natural en español, sin promesas no comprobables. Las características deben describir solo detalles visibles o datos ya proporcionados. Incluye en needs_review cualquier dato que el administrador debería confirmar."
    },...imageInputs];

    const upstream = await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},
      body:JSON.stringify({
        model,
        store:false,
        max_output_tokens:1100,
        input:[{role:"user",content:inputContent}],
        text:{format:{
          type:"json_schema",
          name:"novashop_catalog_product",
          strict:true,
          schema:productSchema
        }}
      })
    });
    const response = await upstream.json().catch(()=>({}));
    if (!upstream.ok) {
      console.error("catalog-ai-assistant provider error",upstream.status,clean(response?.error?.message,300));
      if (upstream.status===401) return json({error:"La clave de IA configurada en Supabase no es válida. Revísala en Edge Function Secrets."},502,origin);
      if (upstream.status===429) return json({error:"El proveedor de IA alcanzó un límite de uso o saldo. Revisa la facturación y los límites de la API."},429,origin);
      return json({error:"El proveedor de IA no pudo analizar este producto. Inténtalo de nuevo o continúa con el modo local."},502,origin);
    }
    const outputText = getOutputText(response);
    if (!outputText) return json({error:"El modelo no devolvió un análisis completo. Inténtalo otra vez."},502,origin);
    let analysis: any;
    try { analysis=JSON.parse(outputText); }
    catch { return json({error:"La respuesta del modelo no pudo interpretarse. Inténtalo otra vez."},502,origin); }

    const safeCategory = CATEGORIES.includes(analysis.category)?analysis.category:"";
    const safeAudience = ["hombre","mujer","unisex"].includes(analysis.audience)?analysis.audience:"";
    return json({
      ok:true,provider:"openai",model,
      analysis:{
        name_suggestion:clean(analysis.name_suggestion,140),
        category:safeCategory,audience:safeAudience,
        color:clean(analysis.color,60),
        description:clean(analysis.description,1600),
        features:Array.isArray(analysis.features)?analysis.features.slice(0,6).map((v:unknown)=>clean(v,180)).filter(Boolean):[],
        visual_summary:clean(analysis.visual_summary,400),
        confidence:["high","medium","low"].includes(analysis.confidence)?analysis.confidence:"low",
        needs_review:Array.isArray(analysis.needs_review)?analysis.needs_review.slice(0,6).map((v:unknown)=>clean(v,180)).filter(Boolean):[]
      }
    },200,origin);
  } catch (error) {
    console.error("catalog-ai-assistant error",error);
    return json({error:"No pudimos completar el análisis del producto. Inténtalo de nuevo."},500,origin);
  }
});
