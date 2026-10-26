/* Delivery pin picker for checkout. Physical orders must include coordinates; Leaflet + OpenStreetMap needs no API key. */
(() => {
 const maps={};
 function init({mapId,formId,latId,lngId,statusId,coordsId,useButtonId}){
  const el=document.getElementById(mapId),form=document.getElementById(formId);
  if(!el||!form||!window.L||maps[mapId])return;
  const map=L.map(mapId,{scrollWheelZoom:false}).setView([4.5709,-74.2973],5);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'}).addTo(map);
  let marker=null;
  function point(lat,lng,zoom=16){
   lat=Number(lat);lng=Number(lng);
   if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return;
   const latField=form.querySelector('input[name="'+latId+'"]'),lngField=form.querySelector('input[name="'+lngId+'"]');
   if(!latField||!lngField)return;
   latField.value=lat.toFixed(7);lngField.value=lng.toFixed(7);
   if(!marker)marker=L.marker([lat,lng],{draggable:true}).addTo(map);else marker.setLatLng([lat,lng]);
   marker.off("dragend").on("dragend",()=>{const p=marker.getLatLng();point(p.lat,p.lng,16);});
   map.setView([lat,lng],zoom);
   const status=document.getElementById(statusId),coords=document.getElementById(coordsId);
   if(status)status.textContent="Ubicación marcada. Puedes arrastrar el pin para precisar la entrada.";
   if(coords)coords.textContent=lat.toFixed(6)+", "+lng.toFixed(6);
  }
  map.on("click",e=>point(e.latlng.lat,e.latlng.lng));
  document.getElementById(useButtonId)?.addEventListener("click",()=>{
   const status=document.getElementById(statusId);
   if(!navigator.geolocation){if(status)status.textContent="No está disponible la ubicación. Toca el mapa para poner el pin.";return;}
   if(status)status.textContent="Solicitando permiso de ubicación…";
   navigator.geolocation.getCurrentPosition(pos=>point(pos.coords.latitude,pos.coords.longitude,17),()=>{
    if(status)status.textContent="No se obtuvo la ubicación. Puedes marcar el mapa manualmente.";
   },{enableHighAccuracy:true,timeout:12000,maximumAge:0});
  });
  form.addEventListener("novashop:profile-prefilled",()=>{
   const lat=form.elements[latId]?.value,lng=form.elements[lngId]?.value;
   if(lat&&lng)point(lat,lng,16);
  });
  maps[mapId]={map,point};
 }
 function invalidate(mapId){if(maps[mapId])setTimeout(()=>maps[mapId].map.invalidateSize(),120);}
 document.addEventListener("DOMContentLoaded",()=>{
  init({mapId:"checkoutDeliveryMap",formId:"checkoutForm",latId:"latitude",lngId:"longitude",statusId:"checkoutMapStatus",coordsId:"checkoutCoords",useButtonId:"useCheckoutLocation"});
  init({mapId:"productCheckoutMap",formId:"productCheckoutForm",latId:"latitude",lngId:"longitude",statusId:"productCheckoutMapStatus",coordsId:"productCheckoutCoords",useButtonId:"useProductCheckoutLocation"});
 });
 window.NovaShopDeliveryMaps={invalidate,point:(mapId,lat,lng)=>maps[mapId]?.point(lat,lng)};
})();