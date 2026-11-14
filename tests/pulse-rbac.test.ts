import assert from "node:assert/strict";
import test from "node:test";
import {
  ALL_PULSE_PAGES,
  assignablePulseRoles,
  canChangePulseRole,
  canManageConsoleUsers,
  canOpenPulsePage,
  canRemovePulseUser,
  normalizePulseRole,
  PULSE_ROLE_PAGES,
  type PulsePage,
  type PulseRole,
} from "../src/lib/pulse-rbac.ts";

const ADMIN_PAGES: PulsePage[] = ["audit", "users", "sales"];
const STAFF_PAGES: PulsePage[] = [
  "home",
  "pharmacies",
  "catalogue",
  "inventory",
  "movement",
  "stock",
  "walkthrough",
];

test("role labels and legacy values normalize to the three console roles", () => {
  const cases: Array<[string | null | undefined, PulseRole | undefined]> = [
    ["Owner", "owner"],
    ["owner", "owner"],
    [" Admin ", "admin"],
    ["Administrator", "admin"],
    ["Staff", "staff"],
    ["member", "staff"],
    ["USER", "staff"],
    ["Cashier", undefined],
    ["", undefined],
    [null, undefined],
  ];
  for (const [input, expected] of cases) {
    assert.equal(normalizePulseRole(input), expected, `normalizing ${String(input)}`);
  }
});

test("Owner can open every Pulse console page", () => {
  for (const page of ALL_PULSE_PAGES) {
    assert.equal(canOpenPulsePage("owner", page), true, `Owner denied ${page}`);
  }
});

test("Admin can open every Pulse console page", () => {
  for (const page of ALL_PULSE_PAGES) {
    assert.equal(canOpenPulsePage("admin", page), true, `Admin denied ${page}`);
  }
});

test("Staff gets exactly the operational pages it needs", () => {
  const allowed = ALL_PULSE_PAGES.filter((page) => canOpenPulsePage("staff", page));
  assert.deepEqual(allowed, STAFF_PAGES);
  assert.deepEqual([...PULSE_ROLE_PAGES.staff], STAFF_PAGES);
});

test("Staff is denied every Owner/Admin-only console page", () => {
  for (const page of ADMIN_PAGES) {
    assert.equal(canOpenPulsePage("staff", page), false, `Staff allowed ${page}`);
  }
});

test("Owners and Admins can manage console users, Staff cannot", () => {
  assert.equal(canManageConsoleUsers("owner"), true);
  assert.equal(canManageConsoleUsers("admin"), true);
  assert.equal(canManageConsoleUsers("staff"), false);
});

test("role changes: managers edit non-Owners, never themselves or an Owner", () => {
  assert.equal(canChangePulseRole("owner", "owner-1", "staff-1", "staff"), true);
  assert.equal(canChangePulseRole("owner", "owner-1", "owner-1", "owner"), false);
  assert.equal(canChangePulseRole("owner", "owner-1", "owner-2", "owner"), true);
  assert.equal(canChangePulseRole("admin", "admin-1", "staff-1", "staff"), true);
  assert.equal(canChangePulseRole("admin", "admin-1", "admin-2", "admin"), true);
  assert.equal(canChangePulseRole("admin", "admin-1", "owner-1", "owner"), false);
  assert.equal(canChangePulseRole("admin", "admin-1", "admin-1", "admin"), false);
  assert.equal(canChangePulseRole("staff", "staff-1", "staff-2", "staff"), false);
});

test("removals: Admins delete other registered users, but never Owners or themselves", () => {
  assert.equal(canRemovePulseUser("owner", "owner-1", "staff-1", "staff"), true);
  assert.equal(canRemovePulseUser("owner", "owner-1", "owner-1", "owner"), false);
  assert.equal(canRemovePulseUser("owner", "owner-1", "owner-2", "owner"), true);
  assert.equal(canRemovePulseUser("admin", "admin-1", "staff-1", "staff"), true);
  assert.equal(canRemovePulseUser("admin", "admin-1", "admin-2", "admin"), true);
  assert.equal(canRemovePulseUser("admin", "admin-1", "owner-1", "owner"), false);
  assert.equal(canRemovePulseUser("admin", "admin-1", "admin-1", "admin"), false);
  assert.equal(canRemovePulseUser("staff", "staff-1", "staff-2", "staff"), false);
});

test("only Owners may hand out the Owner role", () => {
  assert.deepEqual(assignablePulseRoles("owner"), ["owner", "admin", "staff"]);
  assert.deepEqual(assignablePulseRoles("admin"), ["admin", "staff"]);
  assert.deepEqual(assignablePulseRoles("staff"), []);
});
