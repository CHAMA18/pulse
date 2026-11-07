#!/bin/bash
# Login via exact refs (parsed from snapshot), then open User Management.
cd /home/z/my-project

python3 -m http.server 4000 -d /tmp/pulse-root >/tmp/serve-um.log 2>&1 &
SRV=$!
trap "kill $SRV 2>/dev/null" EXIT
sleep 1

# Close any leftover tabs except the main one, then reload main.
agent-browser tab 2>/dev/null | rg -o '\[t\d+\]' | head -1 > /tmp/um-maintab.txt
agent-browser tab 1 >/dev/null 2>&1 || true
agent-browser reload >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 2

agent-browser snapshot -i -c > /tmp/um-login.txt 2>&1
EMAIL_REF=$(rg -o 'textbox "Email address" \[ref=(e\d+)\]' -r '$1' /tmp/um-login.txt | head -1)
PASS_REF=$(rg -o 'textbox "Password" \[ref=(e\d+)\]' -r '$1' /tmp/um-login.txt | head -1)
SIGNIN_REF=$(rg -o 'button "Sign In" \[ref=(e\d+)\]' -r '$1' /tmp/um-login.txt | head -1)
echo "refs: email=$EMAIL_REF pass=$PASS_REF signin=$SIGNIN_REF"

agent-browser fill "@$EMAIL_REF" "demo@pulse.dev" 2>&1
agent-browser fill "@$PASS_REF" "PulseDemo2026!" 2>&1
agent-browser click "@$SIGNIN_REF" 2>&1

agent-browser wait --text "Inventory Health" --timeout 40000 2>&1 || true
sleep 2
agent-browser snapshot -i -c > /tmp/um-dash.txt 2>&1
echo "=== DASH (top) ==="
head -25 /tmp/um-dash.txt
