const CACHE='lantern-public-v2';
const ASSETS=['/offline.html','/icons/icon-192.png','/icons/icon-512.png','/images/hollow-v2-wide.webp','/images/silk-v2-wide.webp','/images/hollow-v2-portrait.webp','/images/silk-v2-portrait.webp','/images/office-practice.webp'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('lantern-public-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin||u.pathname.startsWith('/api/')||u.pathname.includes('chatgpt')||u.search)return;
 if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(()=>caches.match('/offline.html')));return;}
 if(/\.(js|css|woff2|png|webp|svg)$/.test(u.pathname)){e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request).then(r=>{if(r.ok&&r.type==='basic'){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}return r;})));}
});
