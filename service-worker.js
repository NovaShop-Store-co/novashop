const CACHE_NAME="novashop-shell-v1";
const SHELL_FILES=["./index.html","./offline.html","./styles.css","./storefront-enhancements.css","./script.js","./products.js","./storefront-enhancements.js","./favicon.svg","./icon-novashop.svg","./manifest.webmanifest"];
const SCOPE_URL=new URL(self.registration.scope);
self.addEventListener("install",event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE_NAME);
 await Promise.all(SHELL_FILES.map(async path=>{try{await cache.add(new Request(new URL(path,SCOPE_URL),{cache:"reload"}));}catch(error){console.warn("No se pudo guardar el recurso offline:",path,error);}}));
 await self.skipWaiting();
})()));
self.addEventListener("activate",event=>event.waitUntil((async()=>{
 const names=await caches.keys();
 await Promise.all(names.filter(name=>name.startsWith("novashop-")&&name!==CACHE_NAME).map(name=>caches.delete(name)));
 await self.clients.claim();
})()));
self.addEventListener("fetch",event=>{
 const request=event.request;if(request.method!=="GET")return;
 const url=new URL(request.url);
 if(url.origin!==SCOPE_URL.origin||!url.pathname.startsWith(SCOPE_URL.pathname))return;
 if(/\\/(rest\\/v1|auth\\/v1|functions\\/v1|storage\\/v1)\\//i.test(url.pathname))return;
 if(/\\/(admin|cuenta|pedido|pago|estado-bold|restablecer)\\.html$/i.test(url.pathname))return;
 if(request.mode==="navigate"){
  event.respondWith(fetch(request).catch(async()=>{
   const cache=await caches.open(CACHE_NAME);
   return (await cache.match(new URL("./offline.html",SCOPE_URL)))||(await cache.match(new URL("./index.html",SCOPE_URL)))||new Response("Sin conexión",{status:503,headers:{"Content-Type":"text/plain; charset=utf-8"}});
  }));return;
 }
 if(/\\.(?:css|js|svg|png|jpe?g|webp|woff2?|webmanifest)$/i.test(url.pathname)){
  event.respondWith((async()=>{const cache=await caches.open(CACHE_NAME),cached=await cache.match(request);
   const network=fetch(request).then(response=>{if(response.ok&&response.type==="basic")cache.put(request,response.clone());return response;}).catch(()=>cached);
   return cached||network;
  })());
 }
});