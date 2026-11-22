# Borewell Manager — setup & Play Store guide

This repo builds the **Borewell Manager** Android app (and the same app as a website for office PCs).

- **Front end:** plain JS + Vite, wrapped as an Android app with Capacitor 8 (target SDK 36)
- **Backend:** Firebase Authentication + Cloud Firestore. The free Spark plan is enough to start.
- **CI/CD:** GitHub Actions does three things:
  - tests the security rules
  - builds a signed AAB (for Play) and APK (for direct install)
  - optionally uploads to Play internal testing and deploys the rules and the website

Total one-time cost: **$25** (Google Play developer account). Firebase is free at this scale.

---

## How logins work

| Who | How they sign in | What they see |
|---|---|---|
| **Admin** (business owner) | Registers in the app with **mobile number + password** → gets an **organization code** (e.g. `4XNQCF`) | Everything: jobs, customers, bills, **profit, expenses, rates, settings, team logins** |
| **Office staff** | Org code + username + password (created by admin) | Jobs, customers, bills, payments, reminders. **No** profit, expenses, rates, settings, logins |
| **Crew / driver** | Org code + username + password (created by admin, linked to a rig/crew) | **Only jobs assigned to their rig/crew**; can update status, depth, water, casing, motor, notes. **No money at all** |

- **Data isolation:** each organization's data lives under `orgs/{code}/…`, and the rules in `firebase/firestore.rules` make sure no login can read another organization.
- **The rules are tested:** `tests/rules.test.mjs` runs on every push, covering cross-org access, office limits, crew limits, disabled logins and registration hijacking.
- **No emails are sent:** behind the scenes, logins are Firebase email/password accounts with internal addresses like `9876543210@owner.borewell-app.example.com`.

---

## 1. Firebase (≈10 min)

1. Go to <https://console.firebase.google.com>, choose **Add project** (e.g. `borewell-app`). Analytics can be off.
2. Turn on email/password login: **Build → Authentication → Get started → Sign-in method → Email/Password → Enable**. Leave "Email link" off.
3. Create the database: **Build → Firestore Database → Create database** → **Production mode** → location **asia-south1 (Mumbai)**.
4. Get the web config: **Project settings (⚙) → General → Your apps → Web (`</>`)** → register an app named "Borewell web" → copy the `firebaseConfig` object.
5. Deploy the security rules **once by hand**. The rules are what keep organizations apart, so this step matters. Use either option:
   - Firebase console → Firestore → **Rules** → paste `firebase/firestore.rules` → **Publish**
   - or from Cloud Shell: `npx firebase-tools deploy --only firestore:rules --project <project-id>`
6. Hosting is optional: it gives you the privacy-policy URL and a web version for office PCs. Step 3 below deploys it automatically, or run `npm run build && npx firebase-tools deploy --only hosting --project <project-id>`. Your privacy policy will then be at `https://<project-id>.web.app/privacy.html`.

> **Before publishing**, edit `public/privacy.html`: replace `[Your business name]`, `[Address]` and the contact email.

## 2. Signing key for the Play Store (once)

The upload key signs every build. **Keep the keystore file and passwords safe**; you need them for every future update.

Run in Google Cloud Shell (it has `keytool`) or on any PC with Java:

```bash
keytool -genkeypair -v -keystore upload.keystore -alias upload \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=Borewell Manager, O=Your Business, C=IN"
base64 -w0 upload.keystore > keystore.b64      # on macOS: base64 -i upload.keystore -o keystore.b64
```

## 3. GitHub settings

Go to **Repo → Settings → Secrets and variables → Actions**.

**Variables** tab:

| Name | Value |
|---|---|
| `FIREBASE_CONFIG` | The config from step 1.4 as JSON, e.g. `{"apiKey":"…","authDomain":"…","projectId":"…","storageBucket":"…","messagingSenderId":"…","appId":"…"}` (the JS object pasted as-is also works) |
| `APP_ID` | Your permanent Android app id, e.g. `com.srimurugan.borewell`. **Can never change after the first Play upload.** |
| `FIREBASE_PROJECT_ID` | e.g. `borewell-app` |
| `PRIVACY_URL` | e.g. `https://borewell-app.web.app/privacy.html` |
| `PLAY_RELEASE_STATUS` | (optional) `draft` until the app is set up in Play, then `completed` |

**Secrets** tab:

| Name | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | Contents of `keystore.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | `upload` |
| `ANDROID_KEY_PASSWORD` | Key password (same as keystore password if you didn't set a separate one) |
| `FIREBASE_SERVICE_ACCOUNT` | (optional) JSON key of a service account with the **Firebase Admin** role, to auto-deploy rules and the website |
| `PLAY_SERVICE_ACCOUNT_JSON` | (optional) see step 5 |

Then **Actions → Build & release → Run workflow**. Each run produces an artifact `borewell-app-<n>` containing:

- `app-release.aab`, which you upload to the Play Store
- `app-release.apk`, which you can install directly on a phone for a quick test

Without the keystore secrets, the run produces a debug APK instead.

## 4. Google Play Console

1. Create the developer account at <https://play.google.com/console> ($25 one-time, plus identity verification).
2. **Create app**: name "Borewell Manager" (or your brand), default language Tamil or English, App, Free.
3. Fill in **App content**:
   - **Privacy policy:** your `PRIVACY_URL`
   - **App access:** "All or some functionality is restricted". Give reviewers a **test admin login**: register a demo business in the app and enter its mobile number and password, plus the steps "Admin tab → enter mobile + password".
   - **Ads:** No
   - **Content rating:** fill in the questionnaire (Business/Productivity, no objectionable content)
   - **Target audience:** 18+
   - **Data safety:**
     - Collected: **Name**, **Phone number** (personal info); **Other financial info** (bills and payments the business enters)
     - Purpose: App functionality and Account management
     - Not shared with third parties
     - Encrypted in transit: **Yes**
     - Users can request deletion: **Yes** (in-app: 👤 → Delete account)
   - **Financial features:** none
   - **Government app:** No
4. **Store listing**:
   - icon: `assets/play-icon-512.png`
   - feature graphic: `assets/play-feature-1024x500.png`
   - at least 2 phone screenshots
   - short and full description in Tamil and English
5. **Testing → Internal testing → Create release** → upload `app-release.aab` → add your staff's Gmail addresses as testers → **Save → Review → Roll out**. Share the **opt-in link**: staff open it, accept, and install from the Play Store.
   - Internal testing has **no review wait** and allows up to 100 testers, which is ideal for your own business.
   - On the first upload, accept **Play App Signing** (Google keeps the final signing key; your keystore is the *upload* key).

### Going public (other borewell businesses download it)

- **New personal account:** Google requires a **closed test with at least 12 testers opted in for 14 days in a row** before you can apply for Production access.
  - Testing → Closed testing → create a track, upload the same AAB, add 12+ Gmail testers, and keep them installed for 14 days.
  - Then apply for production.
- **Organization account:** if you register the Play account as an organization (needs a D-U-N-S number), this test isn't required.

## 5. (Optional) automatic upload to Play on every push

1. In Google Cloud (the same project as Firebase is fine), go to **IAM → Service accounts → Create**, then **Keys → Add key → JSON**.
2. Enable the **Google Play Android Developer API** for that project.
3. In Play Console → **Users and permissions → Invite new user** → enter the service-account email → give it access to the app with **Release to testing tracks**.
4. Save the JSON as the `PLAY_SERVICE_ACCOUNT_JSON` secret. After the first manual upload, every push to `main` uploads a new internal-testing build. Set `PLAY_RELEASE_STATUS=completed` once the app is out of draft.

## 6. Everyday operations

- **Forgot password (staff):** the admin disables that login in **Team & logins** and creates a new one. Alternatively, you (the operator) can run the reset script below.
- **Forgot password (owner):** you run the reset script in Cloud Shell with a service-account key:
  ```bash
  GOOGLE_APPLICATION_CREDENTIALS=sa.json node scripts/reset-password.mjs owner 9876543210 NewPass123
  GOOGLE_APPLICATION_CREDENTIALS=sa.json node scripts/reset-password.mjs staff 4XNQCF ramesh NewPass123
  ```
- **Releasing an update:** bump `"version"` in `package.json` (e.g. `1.0.1`) and push. The `versionCode` is set automatically from the build number.
- **Offline use:** the app caches data and queues changes when there is no signal, then syncs when the network returns. First login needs internet.
- **Voice input in Tamil:** staff tap the 🎤 on the Gboard keyboard in any text box. The AI assistant from the Claude version isn't included yet.
- **Free-plan limits:** 50k reads and 20k writes per day, plus 1 GB storage. That's plenty for several small businesses. If many organizations sign up, switch Firebase to the Blaze plan (pay as you go).

## 7. Developing locally

```bash
npm ci
npm run dev:demo          # demo mode: no Firebase, data stays in the browser
cp .env.example .env      # put your Firebase config here, then:
npm run dev
npm run test:rules        # needs Java 21; runs the Firestore emulator + rule tests
npm run build && npx cap sync android && npx cap open android   # Android Studio (optional)
```
