#!/usr/bin/env bash
# Final clean check: declare-as-main + role pill persistence.
set -uo pipefail
PREVIEW=/tmp/preview
ln -sfn /home/z/my-project/out "$PREVIEW/pulse"
pkill -f "http.server 4173" >/dev/null 2>&1 || true
cd "$PREVIEW"
python3 -m http.server 4173 >/tmp/server.log 2>&1 &
sleep 1
cleanup() { agent-browser close >/dev/null 2>&1 || true; pkill -f "http.server 4173" >/dev/null 2>&1 || true; }
trap cleanup EXIT
ab() { agent-browser "$@"; }

ab set viewport 1440 900
ab open "http://localhost:4173/pulse/login/?intent=register"
ab wait --load networkidle
TS=$(date +%s)
EMAIL="pulse.e2e.${TS}@uberip.com"
ab eval "(() => { const s=(id,v)=>{const el=document.getElementById(id); if(!el) return; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v); el.dispatchEvent(new Event('input',{bubbles:true}));}; s('register-pharmacy','Chama Chungu Pharmacy'); s('register-owner','Pulse E2E'); s('register-email','${EMAIL}'); s('register-password','PulseE2E2026!x'); s('register-confirm','PulseE2E2026!x'); return 'filled'; })()"
ab eval "(() => { document.querySelector('[role=\"dialog\"] button[type=\"submit\"]').click(); return 'submitted'; })()"
for i in $(seq 1 15); do sleep 2; CUR=$(ab get url 2>/dev/null || echo ""); [[ "$CUR" == *"/pharmacy"* ]] && break; done
echo "URL: $CUR"

ab eval "(() => { [...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === 'Stores')?.click(); return 'nav'; })()"
sleep 2
ab eval "(() => { [...document.querySelectorAll('button')].find(b => b.textContent.trim().includes('Add store'))?.click(); return 'dialog'; })()"
sleep 1.5
ab eval "(() => { const s=(id,v)=>{const el=document.getElementById(id); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v); el.dispatchEvent(new Event('input',{bubbles:true}));}; s('store-name','Northmead Kiosk'); s('store-location','Northmead, Lusaka'); return 'filled'; })()"
ab eval "(() => { [...document.querySelectorAll('[role=\"dialog\"] button')].find(b => b.textContent.trim() === 'Create store')?.click(); return 'clicked'; })()"
sleep 3

echo "== open menu + declare =="
ab find first 'button[aria-label="Actions for Northmead Kiosk"]' click
sleep 1.5
ab eval "(() => JSON.stringify({ menus: document.querySelectorAll('[role=\"menu\"]').length, items: [...document.querySelectorAll('[role=\"menuitem\"]')].map(i=>i.textContent.trim()) }))()"
ab find role menuitem click --name "Declare as main store"
sleep 2
ab eval "(() => { const t = document.body.innerText; const nm = [...document.querySelectorAll('article')].find(c=>c.textContent.includes('Northmead Kiosk')); return JSON.stringify({ toast: t.includes('Main store declared'), nmIsMain: nm ? nm.textContent.includes('Main') : null, nmPurpleRing: nm ? !!nm.querySelector('[class*=\"ring-purple\"]') : null, mainStats: t.includes('Main store') }); })()"
ab screenshot /tmp/verify-stores.png >/dev/null 2>&1

echo "== sidebar switcher shows Northmead as MAIN (badge) =="
ab find first 'button[aria-label^="Store view"]' click
sleep 1.2
ab eval "(() => JSON.stringify({ items: [...document.querySelectorAll('[role=\"menuitem\"]')].map(i => i.textContent.trim()) }))()"
ab press Escape
echo "== remove guard: try removing main store (should refuse politely) =="
ab find first 'button[aria-label="Actions for Cairo Road Main Store"]' click
sleep 1.2
ab eval "(() => JSON.stringify({ removeDisabled: [...document.querySelectorAll('[role=\"menuitem\"]')].find(i=>i.textContent.includes('Remove store'))?.getAttribute('aria-disabled') ?? [...document.querySelectorAll('[role=\"menuitem\"]')].find(i=>i.textContent.includes('Remove store'))?.getAttribute('data-disabled') ?? 'not-found' }))()"
ab press Escape
ab screenshot /tmp/verify-stores-menu.png >/dev/null 2>&1
echo "DONE"
