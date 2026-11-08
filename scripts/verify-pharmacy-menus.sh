#!/usr/bin/env bash
# Fix-up verification: Radix menus via real pointer events + store scoping.
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
ab eval "(() => { const s=(id,v)=>{const el=document.getElementById(id); if(!el) return; const p=HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p,'value').set.call(el,v); el.dispatchEvent(new Event('input',{bubbles:true}));}; s('register-pharmacy','Chama Chungu Pharmacy'); s('register-owner','Pulse E2E'); s('register-email','${EMAIL}'); s('register-password','PulseE2E2026!x'); s('register-confirm','PulseE2E2026!x'); return 'filled'; })()"
ab eval "(() => { const b = document.querySelector('[role=\"dialog\"] button[type=\"submit\"]'); b.click(); return 'submitted'; })()"
for i in $(seq 1 15); do sleep 2; CUR=$(ab get url 2>/dev/null || echo ""); [[ "$CUR" == *"/pharmacy"* ]] && break; done
echo "URL: $CUR"

# ---- Stores page: declare Northmead Kiosk as main via real clicks ----
echo "== DECLARE MAIN (real pointer) =="
ab eval "(() => { [...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === 'Stores')?.click(); return 'nav'; })()"
sleep 2
ab eval "(() => { [...document.querySelectorAll('button')].find(b => b.textContent.trim().includes('Add store'))?.click(); return 'dialog'; })()"
sleep 1
ab eval "(() => { const s=(id,v)=>{const el=document.getElementById(id); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v); el.dispatchEvent(new Event('input',{bubbles:true}));}; s('store-name','Northmead Kiosk'); s('store-location','Northmead, Lusaka'); s('store-phone','+260 97 555 8080'); return 'filled'; })()"
ab eval "(() => { [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Create store')?.click(); return 'created'; })()"
sleep 1.5
ab find first 'button[aria-label="Actions for Northmead Kiosk"]' click
sleep 1
ab find text "Declare as main store" click
sleep 1.5
ab eval "(() => { const t = document.body.innerText; const cards=[...document.querySelectorAll('article')]; const nm = cards.find(c=>c.textContent.includes('Northmead Kiosk')); return JSON.stringify({ toast: t.includes('Main store declared'), nmIsMain: nm?.textContent.includes('Main') ?? false, nmPurple: !!nm?.querySelector('[class*=\"from-purple\"]') }); })()"
ab screenshot /tmp/verify-stores.png >/dev/null 2>&1

# restore Cairo Road as main
ab find first 'button[aria-label="Actions for Cairo Road Main Store"]' click
sleep 1
ab find text "Declare as main store" click
sleep 1.5
ab eval "(() => JSON.stringify({ restored: document.body.innerText.includes('Main store declared') }))()"

# ---- Store switcher: scope to Kabwata Branch ----
echo "== SWITCH STORE VIEW (real pointer) =="
ab find first 'button[aria-label^="Store view"]' click
sleep 1
ab eval "(() => JSON.stringify({ menuItems: [...document.querySelectorAll('[role=\"menuitem\"]')].map(i => i.textContent.trim()) }))"
ab find role menuitem click --name "Kabwata Branch"
sleep 1.5
ab eval "(() => { [...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === 'Dashboard')?.click(); return 'home'; })()"
sleep 2
ab eval "(() => { const t = document.body.innerText; return JSON.stringify({ heroChip: t.includes('Kabwata Branch'), heroScopedEl: !!document.querySelector('section span[class*=\"bg-white/15\"]'), switcherLabel: document.querySelector('button[aria-label^=\"Store view\"]')?.getAttribute('aria-label') }); })()"
ab screenshot /tmp/verify-scoped-home.png >/dev/null 2>&1

# ---- Inventory scoped to Kabwata ----
ab eval "(() => { [...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === 'Inventory')?.click(); return 'inv'; })()"
sleep 2
ab eval "(() => { const rows=[...document.querySelectorAll('tbody tr')].map(r=>r.querySelector('td')?.textContent.trim()); return JSON.stringify({ rows, coartemGone: !document.body.innerText.includes('Coartem 20/60') }); })()"

# ---- Stock Balance scoped + visual ----
ab eval "(() => { [...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === 'Stock Balance')?.click(); return 'bal'; })()"
sleep 2
ab eval "(() => { const t=document.body.innerText; return JSON.stringify({ paracetamol: t.includes('Paracetamol 500mg'), coartemGone: !t.includes('Coartem 20/60'), purpleBar: !!document.querySelector('[class*=\"from-purple-500\"]') }); })()"
ab screenshot /tmp/verify-balance.png >/dev/null 2>&1

echo "== ERRORS =="
ab errors || true
echo "DONE"
