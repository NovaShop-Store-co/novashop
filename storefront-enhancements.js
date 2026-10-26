/* NovaShop discovery controls: prominent search, quick categories, result count and reset. */
(() => {
 const $ = (selector) => document.querySelector(selector);
 const fire = (element, type) => element?.dispatchEvent(new Event(type,{bubbles:true}));
 const scrollToCatalog = () => $('#productos')?.scrollIntoView({behavior:'smooth',block:'start'});

 function initPredictiveSearch(input,heroSearch,headerSearch){
  if(!input)return;
  const host=input.closest(".hero-search-shell")||input.closest(".search-inner");
  if(!host)return;
  const panel=document.createElement("div");
  panel.className="search-suggestions";
  panel.id="suggestions-"+input.id;
  panel.setAttribute("role","listbox");
  panel.setAttribute("aria-label","Sugerencias de productos");
  panel.hidden=true;
  host.appendChild(panel);
  input.setAttribute("role","combobox");
  input.setAttribute("aria-autocomplete","list");
  input.setAttribute("aria-expanded","false");
  input.setAttribute("aria-controls",panel.id);
  input.setAttribute("autocomplete","off");
  let activeIndex=-1;
  const normalize=value=>String(value||"").toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim();
  const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const formatPrice=value=>new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:0}).format(Number(value)||0);
  const allProducts=()=>typeof products!=="undefined"&&Array.isArray(products)?products:[];
  const close=()=>{panel.hidden=true;panel.classList.remove("is-open");input.setAttribute("aria-expanded","false");input.removeAttribute("aria-activedescendant");activeIndex=-1;};
  const options=()=>Array.from(panel.querySelectorAll("[data-suggest-product]"));
  const setActive=index=>{
   const items=options();if(!items.length){activeIndex=-1;return;}
   activeIndex=(index+items.length)%items.length;
   items.forEach((item,i)=>{item.classList.toggle("is-active",i===activeIndex);item.setAttribute("aria-selected",i===activeIndex?"true":"false");});
   input.setAttribute("aria-activedescendant",items[activeIndex].id);
   items[activeIndex].scrollIntoView({block:"nearest"});
  };
  const navigate=id=>{window.location.href="producto.html?id="+encodeURIComponent(id);};
  const render=()=>{
   const query=normalize(input.value);
   activeIndex=-1;
   if(query.length<2){close();return;}
   const results=allProducts().filter(product=>{
    const features=Array.isArray(product.features)?product.features.join(" "):"";
    const haystack=normalize([product.name,product.category,product.description,product.tag,features].join(" "));
    return query.split(/\s+/).every(part=>haystack.includes(part));
   }).sort((a,b)=>{
    const qa=normalize(a.name).startsWith(query)?0:1;
    const qb=normalize(b.name).startsWith(query)?0:1;
    return qa-qb||(Number(b.sortOrder)||0)-(Number(a.sortOrder)||0);
   }).slice(0,5);
   const resultsLabel=results.length===1?"1 coincidencia":results.length+" coincidencias";
   panel.innerHTML='<div class="search-suggestions-heading"><span>Sugerencias</span><small>'+resultsLabel+'</small></div>'+
    (results.length?results.map((product,index)=>{
      const image=Array.isArray(product.images)&&product.images[0]?product.images[0]:"images/streaming-placeholder.svg";
      return '<button type="button" class="search-suggestion" role="option" aria-selected="false" id="'+esc(panel.id+'-option-'+index)+'" data-suggest-product="'+esc(product.id)+'">'+
       '<img src="'+esc(image)+'" alt="" loading="lazy"><span class="search-suggestion-copy"><strong>'+esc(product.name)+'</strong><small>'+esc(product.category||"Producto")+'</small></span><strong class="search-suggestion-price">'+formatPrice(product.price)+'</strong></button>';
    }).join(""):'<div class="search-suggestions-empty">No encontramos coincidencias con ese texto.</div>')+
    '<button type="button" class="search-suggestions-all" data-search-all="true">'+(results.length?"Ver todos los resultados":"Explorar todo el catálogo")+' <span aria-hidden="true">→</span></button>';
   panel.hidden=false;panel.classList.add("is-open");input.setAttribute("aria-expanded","true");
  };
  input.addEventListener("input",render);
  input.addEventListener("focus",()=>{if(input.value.trim().length>=2)render();});
  input.addEventListener("blur",()=>window.setTimeout(()=>{if(!panel.contains(document.activeElement))close();},180));
  input.addEventListener("keydown",event=>{
   if(panel.hidden)return;
   if(event.key==="ArrowDown"){event.preventDefault();setActive(activeIndex+1);}
   else if(event.key==="ArrowUp"){event.preventDefault();setActive(activeIndex<=0?options().length-1:activeIndex-1);}
   else if(event.key==="Escape"){close();}
   else if(event.key==="Enter"){
    const items=options();
    if(items.length){event.preventDefault();const chosen=items[activeIndex>=0?activeIndex:0];if(chosen)navigate(chosen.dataset.suggestProduct);}
    else{event.preventDefault();close();if(headerSearch)headerSearch.value=input.value;if(heroSearch)heroSearch.value=input.value;scrollToCatalog();}
   }
  });
  panel.addEventListener("click",event=>{
   const productButton=event.target.closest("[data-suggest-product]");
   if(productButton){event.preventDefault();navigate(productButton.dataset.suggestProduct);return;}
   if(event.target.closest("[data-search-all]")){
    close();if(headerSearch&&input!==headerSearch)headerSearch.value=input.value;if(heroSearch&&input!==heroSearch)heroSearch.value=input.value;
    if(headerSearch)fire(headerSearch,"input");scrollToCatalog();
   }
  });
 }

 function init(){
  const heroSearch=$('#heroProductSearch'), headerSearch=$('#searchInput'), category=$('#categoryFilter');
  const grid=$('#productGrid'), chipBox=$('#heroCategoryChips');
  if(!heroSearch||!headerSearch||!category||!grid)return;
  heroSearch.addEventListener('input',()=>{headerSearch.value=heroSearch.value;fire(headerSearch,'input');});
  headerSearch.addEventListener('input',()=>{if(heroSearch.value!==headerSearch.value)heroSearch.value=headerSearch.value;});
  initPredictiveSearch(heroSearch,heroSearch,headerSearch);
  initPredictiveSearch(headerSearch,heroSearch,headerSearch);

  heroSearch.addEventListener('keydown',event=>{if(event.key==='Enter'&&heroSearch.getAttribute('aria-expanded')!=='true'){event.preventDefault();scrollToCatalog();}});
  $('#heroSearchSubmit')?.addEventListener('click',()=>{headerSearch.value=heroSearch.value;fire(headerSearch,'input');scrollToCatalog();});
  if(chipBox){
   const options=[...category.options].filter(option=>option.value!=='all').map(option=>({value:option.value,label:option.textContent.trim()}));
   const onlyStreaming=options.length===1&&options[0].value==='Streaming';
   const shortlist=options.slice(0,4);
   chipBox.hidden=onlyStreaming;
   chipBox.innerHTML=onlyStreaming?'':'<button type="button" class="hero-category-chip" data-quick-category="all">Ver todo</button>'+shortlist.map(option=>'<button type="button" class="hero-category-chip" data-quick-category="'+option.value.replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'">'+option.label.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</button>').join('');
   chipBox.querySelectorAll('[data-quick-category]').forEach(button=>button.addEventListener('click',()=>{
    category.value=button.dataset.quickCategory;fire(category,'change');scrollToCatalog();
   }));
  }
  let discovery=$('#catalogDiscoveryBar');
  if(!discovery){
   discovery=document.createElement('div');discovery.id='catalogDiscoveryBar';discovery.className='catalog-discovery-bar';
   discovery.innerHTML='<div class="catalog-results-copy" role="status" aria-live="polite"><span class="catalog-results-dot" aria-hidden="true"></span><span id="catalogResultsText">Mostrando productos</span></div><button type="button" id="clearCatalogFilters" class="clear-catalog-btn">Limpiar filtros</button>';
   grid.parentNode.insertBefore(discovery,grid);
  }
  const resultText=$('#catalogResultsText');
  function updateResults(){
   const cards=[...grid.querySelectorAll('.product-card')],count=cards.length;
   const term=headerSearch.value.trim();
   resultText.innerHTML='<strong>'+count+'</strong> '+(count===1?'producto encontrado':'productos encontrados')+(term?' para <strong>“'+term.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))+'”</strong>':'');
   const clear=$('#clearCatalogFilters');
   const active=!!term||category.value!=='all'||!!$('#minPriceFilter')?.value||!!$('#maxPriceFilter')?.value||!!$('#hideSoldOut')?.checked||!!$('#onlyOffers')?.checked||$('#sortSelect')?.value!=='featured';
   clear.hidden=!active;
  }
  const observer=new MutationObserver(updateResults);observer.observe(grid,{childList:true,subtree:false});
  ['change','input'].forEach(type=>{
   ['searchInput','categoryFilter','sortSelect','minPriceFilter','maxPriceFilter','hideSoldOut','onlyOffers'].forEach(id=>{
    const element=$('#'+id);element?.addEventListener(type,updateResults);
   });
  });
  $('#clearCatalogFilters')?.addEventListener('click',()=>{
   headerSearch.value='';heroSearch.value='';
   category.value='all';$('#sortSelect').value='featured';
   $('#minPriceFilter').value='';$('#maxPriceFilter').value='';
   $('#hideSoldOut').checked=false;$('#onlyOffers').checked=false;
   fire(headerSearch,'input');fire(category,'change');fire($('#sortSelect'),'change');
   fire($('#minPriceFilter'),'input');fire($('#maxPriceFilter'),'input');
   fire($('#hideSoldOut'),'change');fire($('#onlyOffers'),'change');
   updateResults();
  });
  updateResults();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
