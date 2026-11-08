#!/usr/bin/env bash
# Local E2E verification of the Pharmacy portal (register → explore → act).
set -uo pipefail

OUT=/home/z/my-project/out
PREVIEW=/tmp/preview
mkdir -p "$PREVIEW"
ln -sfn "$OUT" "$PREVIEW/pulse"

cleanup() {
  agent-browser close >/dev/null 2>&1 || true
  pkill -f "http.server 4173" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cd "$PREVIEW"
python3 -m http.server 4173 >/tmp/server.log 2>&1 &
SERVER_PID=$!
sleep 1

ab() { agent-browser "$@"; }

ab set viewport 1440 900
ab open "http://localhost:4173/pulse/login/?intent=register" || { echo "OPEN FAILED"; exit 1; }
ab wait --load networkidle

# ---- Register a throwaway pharmacy account (real Firebase signup) ----
TS=$(date +%s)
EMAIL="pulse.e2e.${TS}@uberip.com"
ab eval "
(() => {
  const setVal = (id, v) => {
    const el = document.getElementById(id);
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  setVal('register-pharmacy', 'Chama Chungu Pharmacy');
  setVal('register-owner', 'Pulse E2E');
  setVal('register-email', '${EMAIL}');
  setVal('register-password', 'PulseE2E2026!x');
  setVal('register-confirm', 'PulseE2E2026!x');
  return 'filled';
})()
"
ab eval "(() => { const b = document.querySelector('[role=\"dialog\"] button[type=\"submit\"]') || document.querySelector('form button[type=\"submit\"]'); b.click(); return 'submitted: ' + b.textContent.trim(); })()"
echo "$EMAIL" > /tmp/pulse-e2e-email.txt
# Poll up to 30s for the redirect to /pharmacy
NAVIGATED="no"
for i in $(seq 1 15); do
  sleep 2
  CUR=$(ab get url 2>/dev/null || echo "")
  if [[ "$CUR" == *"/pharmacy"* ]]; then NAVIGATED="yes"; break; fi
done
echo "URL after register: $CUR (navigated=$NAVIGATED)"
if [[ "$NAVIGATED" != "yes" ]]; then
  ab eval "(() => JSON.stringify({ alert: document.querySelector('[role=\"alert\"]')?.textContent ?? null, body: document.body.innerText.slice(0, 500) }))()"
fi

# ---- Pharmacy dashboard ----
sleep 2
echo "== DASHBOARD CHECKS =="
ab eval "
(() => {
  const t = document.body.innerText;
  return JSON.stringify({
    hero: t.includes('Chama Chungu Pharmacy') || t.includes('Good'),
    purpleHero: !!document.querySelector('[class*=\"from-purple-700\"]'),
    emeraldLeft: document.body.innerHTML.includes('from-emerald'),
    storeView: t.includes('Store view'),
    allStores: t.includes('All stores'),
    navStores: t.includes('Stores'),
    navUsers: t.includes('User Management'),
    statTiles: t.includes('Stock on Hand'),
    attention: t.includes('Inventory Health'),
  });
})()
"
ab screenshot /tmp/verify-home.png >/dev/null 2>&1

# ---- Stores page: create a store ----
echo "== STORES PAGE =="
ab eval "
[...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === 'Stores')?.click();
'nav-stores'
"
sleep 2
ab eval "
(() => {
  const t = document.body.innerText;
  return JSON.stringify({
    title: t.includes('Stores'),
    mainCard: t.includes('Cairo Road Main Store'),
    kabwata: t.includes('Kabwata Branch'),
    makeni: t.includes('Makeni Clinic Point'),
    addBtn: t.includes('Add store'),
    stats: t.includes('Stores on this account'),
  });
})()
"
ab eval "
[...document.querySelectorAll('button')].find(b => b.textContent.trim().includes('Add store'))?.click();
'open-add-dialog'
"
sleep 1.2
ab eval "
(() => {
  const setVal = (id, v) => {
    const el = document.getElementById(id);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  setVal('store-name', 'Northmead Kiosk');
  setVal('store-location', 'Northmead, Lusaka');
  setVal('store-address', 'Stand 88, Northmead Way');
  setVal('store-phone', '+260 97 555 8080');
  return 'dialog-filled';
})()
"
ab screenshot /tmp/verify-store-dialog.png >/dev/null 2>&1
ab eval "
[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Create store')?.click();
'create-store'
"
sleep 1.5
ab eval "
(() => {
  const t = document.body.innerText;
  return JSON.stringify({ created: t.includes('Northmead Kiosk'), toast: t.includes('Store created') });
})()
"

# ---- Declare Northmead Kiosk as main (then revert) ----
echo "== DECLARE MAIN =="
ab eval "
const cards = [...document.querySelectorAll('article')];
const card = cards.find(c => c.textContent.includes('Northmead Kiosk'));
card?.querySelector('button[aria-label*=\"Actions for\"]')?.click();
'opened-menu'
"
sleep 1
ab eval "
(() => {
  const items = [...document.querySelectorAll('[role=\"menuitem\"]')];
  const target = items.find(i => i.textContent.includes('Declare as main store'));
  target?.click();
  return target ? 'clicked-declare' : 'NOT FOUND: ' + JSON.stringify(items.map(i => i.textContent.trim()));
})()
"
sleep 1.5
ab eval "
(() => {
  const t = document.body.innerText;
  return JSON.stringify({ toast: t.includes('Main store declared'), chips: (t.match(/Main/g) || []).length });
})()
"

# ---- User Management page ----
echo "== USER MANAGEMENT =="
ab eval "
[...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === 'User Management')?.click();
'nav-users'
"
sleep 2
ab eval "
(() => {
  const t = document.body.innerText;
  return JSON.stringify({
    title: t.includes('User Management'),
    inviteBtn: t.includes('Invite user'),
    matrix: t.includes('Role-based access'),
    capabilities: t.includes('Approve stock requests'),
    owner: t.includes('Chungu Chama'),
    invited: t.includes('Konda Njikho'),
    chips: t.includes('Cashiers'),
  });
})()
"
ab screenshot /tmp/verify-users.png >/dev/null 2>&1

# ---- Invite dialog: detailed invitation + email preview ----
ab eval "
[...document.querySelectorAll('button')].find(b => b.textContent.trim().includes('Invite user'))?.click();
'open-invite'
"
sleep 1.2
ab eval "
(() => {
  const setVal = (id, v) => {
    const el = document.getElementById(id);
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  setVal('invite-name', 'Tandiwe Nkhoma');
  setVal('invite-email', 'tandiwe.nkhoma@chamachungu.co.zm');
  setVal('invite-phone', '+260 96 900 1122');
  setVal('invite-message', 'Welcome aboard — you will cover the Kabwata counter.');
  return 'invite-filled';
})()
"
ab eval "
(() => {
  const chips = [...document.querySelectorAll('[role=\"radiogroup\"] button, [role=\"group\"] button')];
  const tech = chips.find(b => b.textContent.trim() === 'Pharmacy Technician');
  tech?.click();
  const kab = [...document.querySelectorAll('[role=\"group\"] button')].find(b => b.textContent.includes('Kabwata'));
  kab?.click();
  return 'picked-role-store';
})()
"
sleep 0.5
ab screenshot /tmp/verify-invite.png >/dev/null 2>&1
ab eval "
(() => {
  const t = document.body.innerText;
  return JSON.stringify({
    preview: t.includes('Email preview'),
    roleInPreview: t.includes('Role: Pharmacy Technician'),
    storesInPreview: t.includes('Stores:'),
    expiry: t.includes('Accept within: 7 days'),
  });
})()
"
ab eval "
[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Send invitation')?.click();
'send-invite'
"
sleep 1.5
ab eval "
(() => {
  const t = document.body.innerText;
  return JSON.stringify({ toast: t.includes('Invitation sent'), row: t.includes('Tandiwe Nkhoma'), invitedTag: t.includes('Invited ·') });
})()
"

# ---- Store scoping: switch to Kabwata Branch and check Inventory ----
echo "== STORE SCOPING =="
ab eval "
document.querySelector('button[aria-label^=\"Store view\"]')?.click();
'opened-switcher'
"
sleep 1
ab eval "
(() => {
  const items = [...document.querySelectorAll('[role=\"menuitem\"]')];
  const kab = items.find(i => i.textContent.includes('Kabwata Branch'));
  kab?.click();
  return kab ? 'switched' : 'NOT FOUND';
})()
"
sleep 1.5
ab eval "
(() => {
  const t = document.body.innerText;
  return JSON.stringify({
    scopeChip: t.includes('Kabwata Branch'),
    heroScoped: !!document.querySelector('[class*=\"bg-white/15\"]'),
  });
})()
"
ab eval "
[...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === 'Inventory')?.click();
'nav-inventory'
"
sleep 2
ab eval "
(() => {
  const t = document.body.innerText;
  return JSON.stringify({
    scopedItems: t.includes('Paracetamol 500mg'),
    notScoped: t.includes('Coartem 20/60'),
    note: t.includes('in this store view'),
  });
})()
"

# ---- Dark mode visual ----
ab eval "
[...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === 'Dashboard')?.click();
'back-home'
"
sleep 1
ab eval "
const sw = [...document.querySelectorAll('button[aria-label=\"Toggle dark mode\"]')];
sw.length ? (sw[0].click(), 'dark-on') : 'no-switch'
"
sleep 1.2
ab screenshot /tmp/verify-dark.png >/dev/null 2>&1
ab eval "document.documentElement.classList.remove('dark'); 'dark-off'"

echo "== CONSOLE ERRORS =="
ab errors || true
echo "DONE"
