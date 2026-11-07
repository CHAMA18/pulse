#!/bin/bash
# Serve static export, login, open Audit Logs, dump snapshot + screenshot.
cd /home/z/my-project

python3 -m http.server 4000 -d /tmp/pulse-root >/tmp/serve-al.log 2>&1 &
SRV=$!
trap "kill $SRV 2>/dev/null" EXIT
sleep 1

agent-browser open http://localhost:4000/pulse/dashboard >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 2

# Login (exact refs parsed from snapshot)
agent-browser snapshot -i -c > /tmp/al-login.txt 2>&1
EMAIL_REF=$(rg -o 'textbox "Email address" \[ref=(e\d+)\]' -r '$1' /tmp/al-login.txt | head -1)
PASS_REF=$(rg -o 'textbox "Password" \[ref=(e\d+)\]' -r '$1' /tmp/al-login.txt | head -1)
SIGNIN_REF=$(rg -o 'button "Sign In" \[ref=(e\d+)\]' -r '$1' /tmp/al-login.txt | head -1)
agent-browser fill "@$EMAIL_REF" "demo@pulse.dev" >/dev/null 2>&1
agent-browser fill "@$PASS_REF" "PulseDemo2026!" >/dev/null 2>&1
agent-browser click "@$SIGNIN_REF" >/dev/null 2>&1
agent-browser wait --text "Inventory Health" --timeout 40000 >/dev/null 2>&1 || true
sleep 2

# Navigate: Home -> Pulse Pharmacies -> Audit Logs (records real events)
agent-browser snapshot -i -c > /tmp/al-dash.txt 2>&1
NAV_PHARM=$(rg -o 'button "Pulse Pharmacies" \[ref=(e\d+)\]' -r '$1' /tmp/al-dash.txt | head -1)
agent-browser click "@$NAV_PHARM" >/dev/null 2>&1
sleep 2
NAV_AUDIT=$(agent-browser snapshot -i -c 2>/dev/null | rg -o 'button "Audit Logs" \[ref=(e\d+)\]' -r '$1' | head -1)
agent-browser click "@$NAV_AUDIT" >/dev/null 2>&1
sleep 2.5

agent-browser snapshot -i -c > /tmp/al-final.txt 2>&1
echo "=== AUDIT LOGS PAGE ==="
head -55 /tmp/al-final.txt

agent-browser set viewport 1540 900 2>/dev/null
sleep 1
agent-browser screenshot /tmp/render/al-page.png >/dev/null 2>&1
echo "=== console ==="
agent-browser console 2>&1 | tail -4
echo "=== errors ==="
agent-browser errors 2>&1 | tail -4
