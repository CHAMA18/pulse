import test from "node:test";
import assert from "node:assert/strict";
import {
  PULSE_ADMIN_DOMAIN,
  PULSE_ADMIN_EMAIL,
  isPulseAdminEmail,
  portalForSelfServiceKind,
  selfServiceAccountKind,
} from "../src/lib/account-policy.ts";

test("Duniya Healthcare emails are Pulse admin accounts", () => {
  assert.equal(isPulseAdminEmail("ceo@duniyahealthcare.com"), true);
  assert.equal(isPulseAdminEmail("  Person@DuniyaHealthcare.com  "), true);
  assert.equal(isPulseAdminEmail(`team@${PULSE_ADMIN_DOMAIN}`), true);
  assert.equal(selfServiceAccountKind("finance@duniyahealthcare.com"), "pulse-admin");
});

test("the designated Gmail inbox is a Pulse admin account", () => {
  assert.equal(isPulseAdminEmail(PULSE_ADMIN_EMAIL), true);
  assert.equal(isPulseAdminEmail("CHUNGU424@GMAIL.COM"), true);
  assert.equal(selfServiceAccountKind(PULSE_ADMIN_EMAIL), "pulse-admin");
});

test("every other valid email self-registers as a pharmacy", () => {
  for (const email of [
    "owner@example.com",
    "pharmacist@gmail.com",
    "someone@duniyahealthcare.co",
    "someone@duniya-healthcare.com",
  ]) {
    assert.equal(isPulseAdminEmail(email), false, email);
    assert.equal(selfServiceAccountKind(email), "pharmacy", email);
  }
});

test("lookalike domains can never claim admin access", () => {
  for (const email of [
    "ceo@mail.duniyahealthcare.com",
    "ceo@notduniyahealthcare.com",
    "ceo@duniyahealthcare.com.evil.example",
    "duniyahealthcare.com@gmail.com",
    "ceo@duniyahealthcare.com.attacker.test",
  ]) {
    assert.equal(isPulseAdminEmail(email), false, email);
  }
});

test("classification waits for a valid email address", () => {
  for (const email of ["", "   ", "not-an-email", "@duniyahealthcare.com", null, undefined]) {
    assert.equal(selfServiceAccountKind(email), null);
    assert.equal(isPulseAdminEmail(email), false);
  }
});

test("account kinds map to the correct console", () => {
  assert.equal(portalForSelfServiceKind("pulse-admin"), "pulse");
  assert.equal(portalForSelfServiceKind("pharmacy"), "pharmacy");
});
