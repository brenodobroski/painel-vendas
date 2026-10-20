// Service Worker mínimo — necessário apenas para o app ser INSTALÁVEL.
// Propositalmente NÃO faz cache (sem modo offline): toda requisição passa
// direto pela rede, então o app instalado se comporta exatamente igual ao site.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* pass-through: deixa o navegador buscar na rede normalmente */ });
