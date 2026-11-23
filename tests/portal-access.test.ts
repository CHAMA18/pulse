import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluatePortalAccess,
  normalizeAccountType,
  portalDisplayName,
  portalForAccountType,
} from "../src/lib/portal-access.ts";

test("account types normalize and map to exactly one console", () => {
  assert.equal(normalizeAccountType("Pulse"), "Pulse");
  assert.equal(normalizeAccountType(" pharmacy "), "Pharmacy");
  assert.equal(normalizeAccountType("Owner"), null);
  assert.equal(portalForAccountType("Pulse"), "pulse");
  assert.equal(portalForAccountType("Pharmacy"), "pharmacy");
  assert.equal(portalForAccountType(null), null);
  assert.equal(portalDisplayName("pharmacy"), "Pharmacy portal");
  assert.equal(portalDisplayName("pulse"), "Pulse console");
});

test("profiles enter only their own console, regardless of role", () => {
  const pulse = evaluatePortalAccess({
    profile: { account_type: "Pulse", access_revoked: false },
    verified: true,
  });
  assert.deepEqual(pulse, { status: "allowed", portal: "pulse", accountType: "Pulse" });

  // Both portals use the "owner" role, so a role label must never decide access.
  const pharmacyOwner = evaluatePortalAccess({
    profile: { account_type: "Pharmacy", access_revoked: false },
    verified: true,
  });
  assert.deepEqual(pharmacyOwner, {
    status: "allowed",
    portal: "pharmacy",
    accountType: "Pharmacy",
  });
});

test("revoked access wins over any account type", () => {
  assert.deepEqual(
    evaluatePortalAccess({
      profile: { account_type: "Pulse", access_revoked: true },
      verified: true,
    }),
    { status: "revoked" }
  );
  assert.deepEqual(
    evaluatePortalAccess({
      profile: { account_type: "Pharmacy", access_revoked: true },
      verified: true,
    }),
    { status: "revoked" }
  );
});

test("missing account types fail closed and unread profiles stay unverified", () => {
  assert.deepEqual(
    evaluatePortalAccess({ profile: { account_type: "", access_revoked: false }, verified: true }),
    { status: "unassigned" }
  );
  assert.deepEqual(
    evaluatePortalAccess({ profile: { account_type: "Pulse" }, verified: false }),
    { status: "allowed", portal: "pulse", accountType: "Pulse" }
  );
  assert.deepEqual(evaluatePortalAccess({ profile: null, verified: false }), {
    status: "unverified",
  });
  assert.deepEqual(evaluatePortalAccess({ profile: null, verified: true }), {
    status: "unassigned",
  });
});
