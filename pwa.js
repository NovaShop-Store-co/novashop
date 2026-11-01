(() => {
  if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js",{scope:"./"}).catch(error=>console.warn("NovaShop offline shell:",error)));
  const button=document.getElementById("pwaInstallBtn");let pending=null;
  if(!button)return;
  window.addEventListener("beforeinstallprompt",event=>{event.preventDefault();pending=event;button.hidden=false;});
  button.addEventListener("click",async()=>{if(!pending)return;pending.prompt();const choice=await pending.userChoice.catch(()=>null);if(choice?.outcome==="accepted")button.hidden=true;pending=null;});
  window.addEventListener("appinstalled",()=>{button.hidden=true;pending=null;});
})();