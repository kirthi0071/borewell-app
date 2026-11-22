// Data + auth layer. Two implementations with the same interface:
//  - Firebase (production)
//  - Demo (in-memory, VITE_DEMO=1) for previews and automated tests
//
// Data model (all under orgs/{orgId}/...):
//   settings/main        business details & rates      read: all members   write: admin
//   customers/{id}                                      read/write: admin, office
//   crew/{id}            rigs & people                  read: all members   write: admin
//   jobs/{id}            work details (no money)        admin/office; crew only jobs they are assigned to
//   billing/{id}         bill, payments (same id as job) admin, office
//   jobexp/{id}          job expenses                   admin only
//   expenses/{id}        general expenses               admin only
// Top level:
//   orgs/{orgId}         {name, ownerUid, ownerMobile}
//   users/{uid}          {orgId, role: admin|office|crew, name, username|mobile, active, crewId?}

export const ROLES = ["admin", "office", "crew"];

// Keys stored in each job document. Everything else about a job lives in billing/jobexp.
export const WORK_KEYS = ["no", "customerId", "cust", "type", "status", "date", "crew", "village", "address", "location",
  "depth", "casingFt", "casingDia", "waterAt", "yield", "motorHp", "stages", "pipeFt", "cableFt", "report", "nextService",
  "createdAt", "updatedAt", "updatedBy"];
export const BILL_KEYS = ["customerId", "useSlab", "slabs", "casingRate", "items", "discount", "gstPct", "payments",
  "notes", "total", "balance", "remind", "updatedAt"];
export const EXP_KEYS = ["expenses", "expTotal", "updatedAt"];
// What crew members may change on their assigned jobs (mirrored in firestore.rules)
export const CREW_KEYS = ["status", "depth", "casingFt", "casingDia", "waterAt", "yield", "motorHp", "stages", "pipeFt",
  "cableFt", "report", "updatedAt", "updatedBy"];

const ORG_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const newOrgCode = () => Array.from({ length: 6 }, () => ORG_ALPHABET[Math.floor(Math.random() * ORG_ALPHABET.length)]).join("");
export const cleanMobile = m => String(m || "").replace(/\D/g, "").slice(-10);
export const cleanUsername = u => String(u || "").trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
export const cleanOrg = o => String(o || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
// Firebase Auth needs an email; these are internal login ids, no email is ever sent to them.
export const adminEmail = mobile => `${cleanMobile(mobile)}@owner.borewell-app.example.com`;
export const staffEmail = (org, username) => `${cleanUsername(username)}.${cleanOrg(org).toLowerCase()}@staff.borewell-app.example.com`;

const pick = (o, keys) => { const r = {}; keys.forEach(k => { if (o[k] !== undefined) r[k] = o[k]; }); return r; };
const clone = o => JSON.parse(JSON.stringify(o));

// Merge the three job documents into the single job object the UI works with.
export function mergeJobs(jobs, billing, jobexp) {
  const out = {};
  for (const [id, j] of Object.entries(jobs)) out[id] = Object.assign({}, billing[id] || {}, jobexp[id] || {}, j, { id });
  return out;
}

export class AppError extends Error { constructor(code, message) { super(message || code); this.code = code; } }

/* ============================ Firebase ============================ */
export async function createFirebaseBackend(config) {
  const { initializeApp, deleteApp } = await import("firebase/app");
  const A = await import("firebase/auth");
  const F = await import("firebase/firestore");
  const app = initializeApp(config);
  let auth;
  try { auth = A.initializeAuth(app, { persistence: [A.indexedDBLocalPersistence, A.browserLocalPersistence] }); }
  catch (e) { auth = A.getAuth(app); }
  let db;
  try { db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentSingleTabManager() }), ignoreUndefinedProperties: true }); }
  catch (e) { db = F.getFirestore(app); }

  let unsubs = [];
  let profile = null;
  let registering = false, authCb = null;
  const errHandlers = new Set();
  const report = e => errHandlers.forEach(h => h(e));
  const orgPath = (...p) => ["orgs", profile.orgId, ...p].join("/");
  // Writes are not awaited for the server: they apply locally at once (works offline) and sync later.
  const fire = p => { p.catch(report); };

  async function loadProfile(user) {
    const snap = await F.getDoc(F.doc(db, "users", user.uid));
    if (!snap.exists()) throw new AppError("no-profile");
    const p = snap.data();
    if (p.active === false) throw new AppError("inactive");
    return Object.assign({ uid: user.uid }, p);
  }
  const mapAuthErr = e => {
    const c = e && e.code || "";
    if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(c)) return new AppError("bad-login");
    if (/email-already-in-use/.test(c)) return new AppError("exists");
    if (/weak-password/.test(c)) return new AppError("weak-password");
    if (/network/.test(c)) return new AppError("network");
    if (/too-many-requests/.test(c)) return new AppError("too-many");
    if (/requires-recent-login/.test(c)) return new AppError("recent-login");
    return e instanceof AppError ? e : new AppError("unknown", String(e && e.message || e));
  };

  return {
    kind: "firebase",
    onError(h) { errHandlers.add(h); },
    onAuth(cb) {
      authCb = cb;
      return A.onAuthStateChanged(auth, async user => {
        if (registering) return;
        if (!user) { profile = null; cb(null); return; }
        try { profile = await loadProfile(user); cb(profile); }
        catch (e) { await A.signOut(auth).catch(() => {}); profile = null; cb(null, e instanceof AppError ? e : mapAuthErr(e)); }
      });
    },
    async registerOrg({ bizName, ownerName, mobile, password }) {
      let cred;
      registering = true;
      try { cred = await A.createUserWithEmailAndPassword(auth, adminEmail(mobile), password); }
      catch (e) { registering = false; throw mapAuthErr(e); }
      const uid = cred.user.uid;
      try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const orgId = newOrgCode();
        const batch = F.writeBatch(db);
        batch.set(F.doc(db, "orgs", orgId), { name: bizName, ownerUid: uid, ownerMobile: cleanMobile(mobile), createdAt: new Date().toISOString() });
        batch.set(F.doc(db, "users", uid), { orgId, role: "admin", name: ownerName, mobile: cleanMobile(mobile), active: true, createdAt: new Date().toISOString() });
        try {
          await batch.commit();
          await F.setDoc(F.doc(db, "orgs", orgId, "settings", "main"), { bizName, phone: cleanMobile(mobile) });
          profile = await loadProfile(cred.user);
          registering = false;
          if (authCb) authCb(profile);
          return { orgId };
        } catch (e) { if (attempt === 3) throw mapAuthErr(e); }
      }
      } catch (e) {
        registering = false;
        // Registration failed after the login was created: remove the half-made login so the mobile can be reused.
        await A.deleteUser(cred.user).catch(() => {});
        if (authCb) authCb(null);
        throw e;
      }
    },
    async loginAdmin(mobile, password) {
      try { await A.signInWithEmailAndPassword(auth, adminEmail(mobile), password); } catch (e) { throw mapAuthErr(e); }
    },
    async loginStaff(org, username, password) {
      try { await A.signInWithEmailAndPassword(auth, staffEmail(org, username), password); } catch (e) { throw mapAuthErr(e); }
    },
    async logout() { unsubs.forEach(u => u()); unsubs = []; await A.signOut(auth); },
    async changePassword(oldPw, newPw) {
      const u = auth.currentUser; if (!u) throw new AppError("bad-login");
      try { await A.reauthenticateWithCredential(u, A.EmailAuthProvider.credential(u.email, oldPw)); await A.updatePassword(u, newPw); }
      catch (e) { throw mapAuthErr(e); }
    },
    // Subscribe to everything this role may see. handlers.set(name, objById) ; handlers.ready() ; handlers.error(e)
    subscribe(handlers) {
      unsubs.forEach(u => u()); unsubs = [];
      const role = profile.role;
      const listen = (name, q) => {
        unsubs.push(F.onSnapshot(q, { includeMetadataChanges: false }, snap => {
          const o = {}; snap.docs.forEach(d => { o[d.id] = Object.assign({}, d.data(), { id: d.id }); });
          handlers.set(name, o, snap.metadata.fromCache);
        }, e => handlers.error(name, e)));
      };
      unsubs.push(F.onSnapshot(F.doc(db, orgPath("settings", "main")), d => handlers.set("settings", d.exists() ? d.data() : null, d.metadata.fromCache), e => handlers.error("settings", e)));
      listen("crew", F.collection(db, orgPath("crew")));
      if (role === "admin" || role === "office") {
        listen("customers", F.collection(db, orgPath("customers")));
        listen("jobs", F.collection(db, orgPath("jobs")));
        listen("billing", F.collection(db, orgPath("billing")));
      }
      if (role === "admin") {
        listen("jobexp", F.collection(db, orgPath("jobexp")));
        listen("expenses", F.collection(db, orgPath("expenses")));
        listen("users", F.query(F.collection(db, "users"), F.where("orgId", "==", profile.orgId)));
      }
      if (role === "crew") {
        if (profile.crewId) listen("jobs", F.query(F.collection(db, orgPath("jobs")), F.where("crew", "array-contains", profile.crewId)));
        else handlers.set("jobs", {}, false);
      }
    },
    saveDoc(coll, id, obj) {
      if (coll === "settings") return fire(F.setDoc(F.doc(db, orgPath("settings", "main")), obj));
      return fire(F.setDoc(F.doc(db, orgPath(coll, id)), obj));
    },
    deleteDoc(coll, id) { return fire(F.deleteDoc(F.doc(db, orgPath(coll, id)))); },
    saveJob(j) {
      const id = j.id;
      if (profile.role === "crew") {
        return fire(F.updateDoc(F.doc(db, orgPath("jobs", id)), pick(j, CREW_KEYS)));
      }
      fire(F.setDoc(F.doc(db, orgPath("jobs", id)), pick(j, WORK_KEYS)));
      fire(F.setDoc(F.doc(db, orgPath("billing", id)), pick(j, BILL_KEYS)));
      if (profile.role === "admin") fire(F.setDoc(F.doc(db, orgPath("jobexp", id)), pick(j, EXP_KEYS)));
    },
    deleteJob(id) {
      fire(F.deleteDoc(F.doc(db, orgPath("jobs", id))));
      fire(F.deleteDoc(F.doc(db, orgPath("billing", id))));
      if (profile.role === "admin") fire(F.deleteDoc(F.doc(db, orgPath("jobexp", id))));
    },
    // Admin creates a staff login without being signed out (uses a second, in-memory auth instance).
    async createStaff({ name, username, password, role, crewId }) {
      const sec = initializeApp(config, "staff-" + Date.now());
      try {
        const secAuth = A.initializeAuth(sec, { persistence: A.inMemoryPersistence });
        let cred;
        try { cred = await A.createUserWithEmailAndPassword(secAuth, staffEmail(profile.orgId, username), password); }
        catch (e) { throw mapAuthErr(e); }
        const uid = cred.user.uid;
        await A.signOut(secAuth).catch(() => {});
        const doc = { orgId: profile.orgId, role, name, username: cleanUsername(username), active: true, createdAt: new Date().toISOString() };
        if (crewId) doc.crewId = crewId;
        await F.setDoc(F.doc(db, "users", uid), doc);
        return uid;
      } finally { deleteApp(sec).catch(() => {}); }
    },
    updateStaff(uid, patch) { return fire(F.updateDoc(F.doc(db, "users", uid), patch)); },
    // Play Store requires in-app account deletion.
    async deleteMyAccount(password, allOrgData) {
      const u = auth.currentUser; if (!u) return;
      try { await A.reauthenticateWithCredential(u, A.EmailAuthProvider.credential(u.email, password)); } catch (e) { throw mapAuthErr(e); }
      if (allOrgData && profile.role === "admin") {
        for (const c of ["customers", "crew", "jobs", "billing", "jobexp", "expenses", "settings"]) {
          const snap = await F.getDocs(F.collection(db, orgPath(c)));
          for (const d of snap.docs) await F.deleteDoc(d.ref);
        }
        const staff = await F.getDocs(F.query(F.collection(db, "users"), F.where("orgId", "==", profile.orgId)));
        for (const d of staff.docs) if (d.id !== u.uid) await F.updateDoc(d.ref, { active: false, deleted: true });
        await F.updateDoc(F.doc(db, "orgs", profile.orgId), { deleted: true, deletedAt: new Date().toISOString() });
      }
      await F.deleteDoc(F.doc(db, "users", u.uid)).catch(() => {});
      try { await A.deleteUser(u); } catch (e) { throw mapAuthErr(e); }
    },
    profile: () => profile,
  };
}

/* ============================ Demo (in-memory) ============================ */
export function createDemoBackend() {
  const LS = "borewell-demo-v1";
  let db = { auth: {}, users: {}, orgs: {}, data: {} }; // data[orgId][coll][id]
  try { const s = JSON.parse(localStorage.getItem(LS) || "null"); if (s) db = s; } catch (e) {}
  const persist = () => { try { localStorage.setItem(LS, JSON.stringify(db)); } catch (e) {} };
  let profile = null, authCb = null, handlers = null, current = null;
  const uidGen = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const coll = (c) => { const o = (db.data[profile.orgId] = db.data[profile.orgId] || {}); return (o[c] = o[c] || {}); };
  const emit = () => {
    if (!handlers || !profile) return;
    const r = profile.role;
    handlers.set("settings", (db.data[profile.orgId] || {}).settings ? coll("settings").main || null : null, false);
    handlers.set("crew", clone(coll("crew")), false);
    if (r !== "crew") { handlers.set("customers", clone(coll("customers")), false); handlers.set("jobs", clone(coll("jobs")), false); handlers.set("billing", clone(coll("billing")), false); }
    if (r === "admin") {
      handlers.set("jobexp", clone(coll("jobexp")), false); handlers.set("expenses", clone(coll("expenses")), false);
      const us = {}; Object.entries(db.users).forEach(([k, v]) => { if (v.orgId === profile.orgId) us[k] = Object.assign({}, v, { id: k }); }); handlers.set("users", us, false);
    }
    if (r === "crew") { const js = {}; Object.entries(coll("jobs")).forEach(([k, v]) => { if ((v.crew || []).includes(profile.crewId)) js[k] = clone(v); }); handlers.set("jobs", js, false); }
  };
  const later = f => setTimeout(f, 0);
  const signIn = (email, pw) => {
    const a = db.auth[email]; if (!a || a.pw !== pw) throw new AppError("bad-login");
    const p = db.users[a.uid]; if (!p) throw new AppError("no-profile"); if (p.active === false) throw new AppError("inactive");
    current = a.uid; profile = Object.assign({ uid: a.uid }, p); sessionStorage.setItem("demo-uid", a.uid); later(() => authCb && authCb(profile));
  };
  return {
    kind: "demo",
    onError() {},
    onAuth(cb) {
      authCb = cb; const uid = sessionStorage.getItem("demo-uid");
      later(() => { if (uid && db.users[uid] && db.users[uid].active !== false) { current = uid; profile = Object.assign({ uid }, db.users[uid]); cb(profile); } else cb(null); });
      return () => {};
    },
    async registerOrg({ bizName, ownerName, mobile, password }) {
      const email = adminEmail(mobile); if (db.auth[email]) throw new AppError("exists"); if (String(password).length < 6) throw new AppError("weak-password");
      const uid = uidGen(), orgId = newOrgCode();
      db.auth[email] = { uid, pw: password }; db.orgs[orgId] = { name: bizName, ownerUid: uid };
      db.users[uid] = { orgId, role: "admin", name: ownerName, mobile: cleanMobile(mobile), active: true };
      db.data[orgId] = { settings: { main: { bizName, phone: cleanMobile(mobile) } } }; persist();
      signIn(email, password); return { orgId };
    },
    async loginAdmin(m, p) { signIn(adminEmail(m), p); },
    async loginStaff(o, u, p) { signIn(staffEmail(o, u), p); },
    async logout() { profile = null; current = null; handlers = null; sessionStorage.removeItem("demo-uid"); later(() => authCb && authCb(null)); },
    async changePassword(o, n) { const e = Object.keys(db.auth).find(k => db.auth[k].uid === current); if (db.auth[e].pw !== o) throw new AppError("bad-login"); if (n.length < 6) throw new AppError("weak-password"); db.auth[e].pw = n; persist(); },
    subscribe(h) { handlers = h; later(emit); },
    saveDoc(c, id, obj) { if (c === "settings") coll("settings").main = clone(obj); else coll(c)[id] = clone(obj); persist(); later(emit); },
    deleteDoc(c, id) { delete coll(c)[id]; persist(); later(emit); },
    saveJob(j) {
      if (profile.role === "crew") { const cur = coll("jobs")[j.id]; if (!cur || !(cur.crew || []).includes(profile.crewId)) return; Object.assign(cur, pick(clone(j), CREW_KEYS)); }
      else { coll("jobs")[j.id] = pick(clone(j), WORK_KEYS); coll("billing")[j.id] = pick(clone(j), BILL_KEYS); if (profile.role === "admin") coll("jobexp")[j.id] = pick(clone(j), EXP_KEYS); }
      persist(); later(emit);
    },
    deleteJob(id) { delete coll("jobs")[id]; delete coll("billing")[id]; delete coll("jobexp")[id]; persist(); later(emit); },
    async createStaff({ name, username, password, role, crewId }) {
      const email = staffEmail(profile.orgId, username); if (db.auth[email]) throw new AppError("exists"); if (String(password).length < 6) throw new AppError("weak-password");
      const uid = uidGen(); db.auth[email] = { uid, pw: password };
      db.users[uid] = Object.assign({ orgId: profile.orgId, role, name, username: cleanUsername(username), active: true }, crewId ? { crewId } : {});
      persist(); later(emit); return uid;
    },
    updateStaff(uid, patch) { Object.assign(db.users[uid], patch); persist(); later(emit); },
    async deleteMyAccount(pw, all) {
      const e = Object.keys(db.auth).find(k => db.auth[k].uid === current); if (db.auth[e].pw !== pw) throw new AppError("bad-login");
      if (all && profile.role === "admin") delete db.data[profile.orgId];
      delete db.auth[e]; delete db.users[current]; persist(); await this.logout();
    },
    profile: () => profile,
  };
}
