#!/usr/bin/env node
// Reset a forgotten password (support tool for you, the app operator).
// Run in Google Cloud Shell or any machine with a Firebase service-account key:
//   GOOGLE_APPLICATION_CREDENTIALS=sa.json node scripts/reset-password.mjs owner 9876543210 NewPass123
//   GOOGLE_APPLICATION_CREDENTIALS=sa.json node scripts/reset-password.mjs staff AB12CD ramesh NewPass123
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { adminEmail, staffEmail } from "../src/backend.js";

const [kind, a, b, c] = process.argv.slice(2);
const email = kind === "owner" ? adminEmail(a) : kind === "staff" ? staffEmail(a, b) : null;
const pw = kind === "owner" ? b : c;
if (!email || !pw || pw.length < 6) {
  console.error("Usage:\n  node scripts/reset-password.mjs owner <mobile> <newPassword>\n  node scripts/reset-password.mjs staff <orgCode> <username> <newPassword>");
  process.exit(1);
}
initializeApp({ credential: applicationDefault() });
const auth = getAuth();
const user = await auth.getUserByEmail(email);
await auth.updateUser(user.uid, { password: pw });
console.log(`Password updated for ${email} (uid ${user.uid})`);
