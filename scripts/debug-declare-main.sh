#!/usr/bin/env bash
# Focused debug: declare-as-main dropdown on the Stores page.
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
ab eval "(() => { document.querySelector('[role=\"dialog\"] button[type=\"submit\"]').click(); return 'submitted'; })()"
for i in $(seq 1 15); do sleep 2; CUR=$(ab get url 2>/dev/null || echo ""); [[ "$CUR" == *"/pharmacy"* ]] && break; done
echo "URL: $CUR"

ab eval "(() => { [...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === 'Stores')?.click(); return 'nav'; })()"
sleep 2

echo "== create Northmead =="
ab eval "(() => { [...document.querySelectorAll('button')].find(b => b.textContent.trim().includes('Add store'))?.click(); return 'dialog'; })()"
sleep 1.5
ab eval "(() => { const s=(id,v)=>{const el=document.getElementById(id); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v); el.dispatchEvent(new Event('input',{bubbles:true}));}; s('store-name','Northmead Kiosk'); s('store-location','Northmead, Lusaka'); return 'filled'; })()"
ab eval "(() => { [...document.querySelectorAll('[role=\"dialog\"] button')].find(b => b.textContent.trim() === 'Create store')?.click(); return 'clicked'; })()"
sleep 3
ab eval "(() => JSON.stringify({ created: document.body.innerText.includes('Northmead Kiosk'), toasts: document.body.innerText.match(/Store created|Store updated/g) }))()"

echo "== open menu (real click) =="
ab find first 'button[aria-label="Actions for Northmead Kiosk"]' click
sleep 1.5
ab eval "(() => JSON.stringify({ menus: document.querySelectorAll('[role=\"menu\"]').length, items: [...document.querySelectorAll('[role=\"menuitem\"]')].map(i=>i.textContent.trim()) }))"

echo "== try role-based click =="
ab find role menuitem click --name "Declare as main store" && echo "clicked" || echo "FIND FAILED"
sleep 2
ab eval "(() => JSON.stringify({ toast: document.body.innerText.includes('Main store declared'), northMain: [...document.querySelectorAll('article')].find(c=>c.textContent.includes('Northmead'))?.textContent.includes('Main') }))"

echo "== fallback: reopen + mouse coords =="
if ! ab eval "(() => document.body.innerText.includes('Main store declared'))" | grep -q true; then
  ab find first 'button[aria-label="Actions for Northmead Kiosk"]' click
  sleep 1.2
  BOX=$(ab find role menuitem text --name "Declare as main store" 2>/dev/null || true)
  echo "text lookup: $BOX"
  ab eval "(() => { const el=[...document.querySelectorAll('[role=\"menuitem\"]')].find(i=>i.textContent.includes('Declare as main')); if(!el) return 'no-item'; const r=el.getBoundingClientRect(); window.__mx=r.x+r.width/2; window.__my=r.y+r.height/2; return Math.round(window.__mx)+','+Math.round(window.__my); })()"
  MX=$(ab eval "(() => String(window.__mx ?? 0))()")
  MY=$(ab eval "(() => String(window.__my ?? 0))()")
  ab mouse move "$MX" "$MY"
  ab mouse down left
  ab mouse up left
  sleep 2
  ab eval "(() => JSON.stringify({ toast: document.body.innerText.includes('Main store declared'), northMain: [...document.querySelectorAll('article')].find(c=>c.textContent.includes('Northmead'))?.textContent.includes('Main') }))"
fi
ab screenshot /tmp/verify-stores.png >/dev/null 2>&1
echo "DONE"
