# Stock request sandbox

This sandbox uses Firebase Auth, Firestore, and Functions emulators under the
`demo-pulse-stock-sandbox` project ID. It does not connect to the production
Firebase project. The Functions emulator also disables email delivery.

## Start it

In separate terminals, from the repository root:

```sh
bun run emulators:stock-sandbox
```

After the emulators report ready:

```sh
bun run seed:stock-sandbox
bun run dev:stock-sandbox
```

Open `http://localhost:3100`. The production-connected app on port 3000 is
separate and unchanged. Emulator data is in memory and resets when the
emulators stop.

## Sandbox logins

| Portal | Email | Password |
| --- | --- | --- |
| Pharmacy | `pharmacy.owner@sandbox.test` | `SandboxPharmacy!2026` |
| Pulse Admin | `pulse.admin@sandbox.test` | `SandboxPulse!2026` |

## Add the test item

After the Pharmacy account signs in, the localhost sandbox creates a main store
and `Sandbox Paracetamol 500mg` in its browser-local catalogue, with a shelf
price of `10` ZMW and opening stock of `20`. This fixture is idempotent and
does not overwrite existing pharmacy data.

Open **Stock Requests → New request** to confirm the item is available. Keep
the form unsubmitted until you are ready to create a sandbox request. The Pulse
admin can view the receiving desk at `http://127.0.0.1:3100/dashboard` in a
separate tab; the two hostnames keep the account sessions separate.

The stock request path writes to the Firestore emulator. The receiving desk
can approve or reject it, then dispatch an approved request with a manual test
batch, expiry, and cost. Return to the Pharmacy account to receive the delivery
and enter its retail price. The Functions emulator records no outgoing email.

For two simultaneous portal sessions, open `http://127.0.0.1:3100` in a second
browser tab and use the other account; the two hostnames keep browser sessions
separate while both connect to the same local emulators.
