// Security-rule tests. Run with:  npx firebase emulators:exec --only firestore --project demo-borewell "node --test tests/"
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, writeBatch } from "firebase/firestore";

let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-borewell", firestore: { rules: readFileSync("firebase/firestore.rules", "utf8") } });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    const put = (p, d) => setDoc(doc(db, p), d);
    await put("orgs/ORGA", { name: "A", ownerUid: "adminA" });
    await put("orgs/ORGB", { name: "B", ownerUid: "adminB" });
    await put("users/adminA", { orgId: "ORGA", role: "admin", active: true });
    await put("users/officeA", { orgId: "ORGA", role: "office", active: true });
    await put("users/crewA", { orgId: "ORGA", role: "crew", crewId: "rig1", active: true });
    await put("users/crewA2", { orgId: "ORGA", role: "crew", crewId: "rig2", active: true });
    await put("users/disabledA", { orgId: "ORGA", role: "office", active: false });
    await put("users/adminB", { orgId: "ORGB", role: "admin", active: true });
    await put("orgs/ORGA/settings/main", { bizName: "A" });
    await put("orgs/ORGA/customers/c1", { name: "Selvam" });
    await put("orgs/ORGA/jobs/j1", { no: 1, crew: ["rig1"], status: "Scheduled", depth: 0, customerId: "c1" });
    await put("orgs/ORGA/jobs/j2", { no: 2, crew: ["rig2"], status: "Scheduled" });
    await put("orgs/ORGA/billing/j1", { total: 1000, payments: [] });
    await put("orgs/ORGA/jobexp/j1", { expenses: [{ amount: 300 }] });
    await put("orgs/ORGA/expenses/e1", { amount: 500 });
  });
});
const as = uid => env.authenticatedContext(uid).firestore();

test("organizations are isolated", async () => {
  const b = as("adminB");
  await assertFails(getDoc(doc(b, "orgs/ORGA/jobs/j1")));
  await assertFails(getDoc(doc(b, "orgs/ORGA/customers/c1")));
  await assertFails(setDoc(doc(b, "orgs/ORGA/customers/x"), { name: "hack" }));
  await assertFails(getDoc(doc(b, "users/adminA")));
  await assertFails(getDocs(query(collection(b, "users"), where("orgId", "==", "ORGA"))));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "orgs/ORGA/jobs/j1")));
});

test("admin can do everything in own org", async () => {
  const a = as("adminA");
  await assertSucceeds(getDoc(doc(a, "orgs/ORGA/jobexp/j1")));
  await assertSucceeds(getDocs(collection(a, "orgs/ORGA/expenses")));
  await assertSucceeds(setDoc(doc(a, "orgs/ORGA/settings/main"), { bizName: "A2" }));
  await assertSucceeds(getDocs(query(collection(a, "users"), where("orgId", "==", "ORGA"))));
  await assertSucceeds(setDoc(doc(a, "users/newStaff"), { orgId: "ORGA", role: "office", name: "N", active: true }));
  await assertSucceeds(updateDoc(doc(a, "users/officeA"), { active: false }));
  await assertSucceeds(deleteDoc(doc(a, "orgs/ORGA/jobs/j2")));
});

test("admin cannot create logins in another org or move users", async () => {
  const a = as("adminA");
  await assertFails(setDoc(doc(a, "users/evil"), { orgId: "ORGB", role: "admin", active: true }));
  await assertFails(updateDoc(doc(a, "users/officeA"), { orgId: "ORGB" }));
  await assertFails(updateDoc(doc(a, "users/adminB"), { active: false }));
});

test("office: jobs, customers, billing yes; profit, expenses, settings, users no", async () => {
  const o = as("officeA");
  await assertSucceeds(getDocs(collection(o, "orgs/ORGA/jobs")));
  await assertSucceeds(getDoc(doc(o, "orgs/ORGA/billing/j1")));
  await assertSucceeds(setDoc(doc(o, "orgs/ORGA/customers/c2"), { name: "New" }));
  await assertSucceeds(setDoc(doc(o, "orgs/ORGA/billing/j1"), { total: 2000, payments: [] }));
  await assertSucceeds(getDoc(doc(o, "orgs/ORGA/settings/main")));
  await assertFails(getDoc(doc(o, "orgs/ORGA/jobexp/j1")));
  await assertFails(getDocs(collection(o, "orgs/ORGA/expenses")));
  await assertFails(setDoc(doc(o, "orgs/ORGA/settings/main"), { bizName: "X" }));
  await assertFails(getDocs(query(collection(o, "users"), where("orgId", "==", "ORGA"))));
  await assertFails(setDoc(doc(o, "users/x"), { orgId: "ORGA", role: "admin", active: true }));
  await assertFails(deleteDoc(doc(o, "orgs/ORGA/jobs/j1")));
  await assertFails(updateDoc(doc(o, "users/officeA"), { role: "admin" }));
});

test("crew: only assigned jobs, only work fields, no money", async () => {
  const c = as("crewA");
  await assertSucceeds(getDoc(doc(c, "orgs/ORGA/jobs/j1")));
  await assertSucceeds(getDocs(query(collection(c, "orgs/ORGA/jobs"), where("crew", "array-contains", "rig1"))));
  await assertFails(getDoc(doc(c, "orgs/ORGA/jobs/j2")));
  await assertFails(getDocs(collection(c, "orgs/ORGA/jobs")));
  await assertFails(getDoc(doc(c, "orgs/ORGA/billing/j1")));
  await assertFails(getDoc(doc(c, "orgs/ORGA/customers/c1")));
  await assertFails(getDoc(doc(c, "orgs/ORGA/jobexp/j1")));
  await assertSucceeds(updateDoc(doc(c, "orgs/ORGA/jobs/j1"), { depth: 450, waterAt: "380", status: "Completed", report: "ok" }));
  await assertFails(updateDoc(doc(c, "orgs/ORGA/jobs/j1"), { crew: ["rig1", "rig2"] }));
  await assertFails(updateDoc(doc(c, "orgs/ORGA/jobs/j1"), { customerId: "c9" }));
  await assertFails(updateDoc(doc(c, "orgs/ORGA/jobs/j1"), { status: "Cancelled" }));
  await assertFails(updateDoc(doc(c, "orgs/ORGA/jobs/j2"), { depth: 1 }));
  await assertFails(setDoc(doc(c, "orgs/ORGA/jobs/new"), { crew: ["rig1"] }));
});

test("disabled logins lose access", async () => {
  const d = as("disabledA");
  await assertFails(getDocs(collection(d, "orgs/ORGA/jobs")));
  await assertSucceeds(getDoc(doc(d, "users/disabledA")));
});

test("registration: new owner creates org + admin profile, cannot hijack existing org", async () => {
  const n = as("newOwner");
  const batch = writeBatch(n);
  batch.set(doc(n, "orgs/ORGC"), { name: "C", ownerUid: "newOwner" });
  batch.set(doc(n, "users/newOwner"), { orgId: "ORGC", role: "admin", active: true });
  await assertSucceeds(batch.commit());
  await assertSucceeds(setDoc(doc(n, "orgs/ORGC/settings/main"), { bizName: "C" }));

  const h = as("hacker");
  await assertFails(setDoc(doc(h, "users/hacker"), { orgId: "ORGA", role: "admin", active: true }));
  const b2 = writeBatch(h);
  b2.set(doc(h, "orgs/ORGA"), { name: "A", ownerUid: "hacker" });
  b2.set(doc(h, "users/hacker"), { orgId: "ORGA", role: "admin", active: true });
  await assertFails(b2.commit());
  // already has an org -> cannot create a second one
  await assertFails(setDoc(doc(as("adminA"), "orgs/ORGZ"), { name: "Z", ownerUid: "adminA" }));
});
