#!/usr/bin/env bash
# Debug the register flow locally.
set -uo pipefail
PREVIEW=/tmp/preview
ln -sfn /home/z/my-project/out "$PREVIEW/pulse"
pkill -f "http.server 4173" >/dev/null 2>&1 || true
cd "$PREVIEW"
python3 -m http.server 4173 >/tmp/server.log 2>&1 &
sleep 1
cleanup() { agent-browser close >/dev/null 2>&1 || true; pkill -f "http.server 4173" >/dev/null 2>&1 || true; }
trap cleanup EXIT

agent-browser set viewport 1440 900
agent-browser open "http://localhost:4173/pulse/login/?intent=register"
agent-browser wait --load networkidle
sleep 2
echo "== has register fields? =="
agent-browser eval "(() => ({ pharmacy: !!document.getElementById('register-pharmacy'), dialogOpen: !!document.querySelector('[role=\"dialog\"]'), body: document.body.innerText.slice(0, 300) }))()"
TS=$(date +%s)
EMAIL="pulse.e2e.${TS}@uberip.com"
echo "== fill =="
agent-browser eval "(() => { const s=(id,v)=>{const el=document.getElementById(id); if(!el) return 'MISSING:'+id; const p=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p,'value').set.call(el,v); el.dispatchEvent(new Event('input',{bubbles:true})); return 'ok';}; return [s('register-pharmacy','Chama Chungu Pharmacy'),s('register-owner','Pulse E2E'),s('register-email','${EMAIL}'),s('register-password','PulseE2E2026!x'),s('register-confirm','PulseE2E2026!x')].join(','); })()"
echo "== submit =="
agent-browser eval "(() => { const b=document.querySelector('[role=\"dialog\"] button[type=\"submit\"]') || document.querySelector('button[type=\"submit\"]'); b.click(); return 'clicked:'+b.textContent.trim(); })()"
sleep 3
echo "== after 3s =="
agent-browser eval "(() => ({ url: location.href, dialog: !!document.querySelector('[role=\"dialog\"]'), err: document.querySelector('[role=\"alert\"]')?.textContent ?? null, body: document.body.innerText.slice(0, 400) }))()"
sleep 5
echo "== after 8s =="
agent-browser eval "(() => ({ url: location.href, err: document.querySelector('[role=\"alert\"]')?.textContent ?? null }))()"
echo "== page errors =="
agent-browser errors || true
echo "== network failures =="
agent-browser network requests --filter identitytoolkit 2>/dev/null | tail -5 || true
