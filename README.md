# PCG Punch

Floor-plan punch list for Perimeter Construction Group hotel projects, built on
**GitHub Pages** (the app) and **Firebase** (sign-in, database, photos).

Live address once published: `https://mattsshop.github.io/pcg-punch/`

This replaces the Apps Script version (`mattsshop/punch_list`, v1.6.0), which keeps running
until the switch. The screens, plans, QR labels, Fieldwire export and PDF reports carry over.

## What changes from the Apps Script version

- **Live:** an item a sub adds shows on everyone's screen within a second or two.
- **Works with no signal:** add items and photos offline; they sync when the signal returns, even if the app was closed.
- **Real sign-in:** Google or email/password, with Admin approval and roles (Viewer, Crew, Admin). No forwardable key links.
- **Several hotels in one app**, with a project switcher.
- Email to subs still goes through a small Apps Script, so the Gmail alias setup keeps working.

## Roadmap

| Step | What | Status |
|---|---|---|
| 1 | Repo, Firebase project, security rules, setup check page | done (v0.1) |
| 2 | Sign-in, access requests and approvals, projects, floor plan upload, plan viewer | done (v0.2) |
| 3 | Tags on plans, item details, photos, live updates, offline saving, item numbers | done (v0.3) |
| 4 | Rooms, QR labels, public read-only room pages, scan log | done (v0.4) |
| 5 | Email to subs (Apps Script mailer), Print / PDF, Fieldwire export | done (v0.5) |
| 6 | Move items over from the Apps Script version | not needed |
| 7 | Owner room sign-off on the GC's tablet | done (v0.7) |

## Step 1 — Firebase setup (Firebase console, about 15 minutes)

Use a **new Firebase project** for this, so the rules here don't affect the earlier punch list app.

1. [console.firebase.google.com](https://console.firebase.google.com) → **Add project** → name it `pcg-punch`.
   Google Analytics isn't needed.
2. **Upgrade to Blaze** (bottom-left, *Spark → Upgrade*) and link your existing billing account.
   Storage needs it. Then in Google Cloud Billing set a **budget alert**, e.g. $5/month.
3. **Build → Authentication → Get started.** Sign-in method: turn on **Google** and **Email/Password**.
   Settings → **Authorized domains** → add `mattsshop.github.io`.
4. **Build → Firestore Database → Create database.** Location `us-east1` (or nearest), production mode.
   Rules tab → paste `firebase/firestore.rules` → **Publish**.
5. **Build → Storage → Get started.** Same location. Rules tab → paste `firebase/storage.rules` → **Publish**.
   When it asks to let Storage read Firestore, **allow** it (the rules check each person's role).
6. **Project settings (gear) → Your apps → Web (`</>`)** → nickname `pcg-punch-web` → Register.
   Copy the `firebaseConfig` values into `config.js` here.
7. Open the site and **Sign in with Google**. All checks should turn green.

The owner account in both rules files is `matt@mattsshop.com`. If you sign in with a different
Google account, change it in both files before publishing.

## Step 5 — email setup (Apps Script, about 5 minutes)

Firebase can't send email, so a small Apps Script does it from your Google account.
It only sends for people signed in to PCG Punch as approved Crew or Admin.

1. Go to [script.google.com](https://script.google.com) signed in with the Google account the emails should come from
   → **New project** → name it **PCG Punch Mailer**.
2. Paste the whole of `apps-script/Mailer.gs` over `Code.gs` → **Save**.
   Optional: set `FROM_ALIAS` to a Gmail "Send mail as" address, and `DISPLAY_NAME`.
3. **Deploy → New deployment →** gear → **Web app**. *Execute as:* **Me**. *Who has access:* **Anyone** → **Deploy** →
   **Authorize access** → choose your account → **Allow**.
4. Copy the **Web app URL** (ends in `/exec`) into `config.js` as `MAILER_URL`, and commit.
   To update the mailer later: paste the new code, Save, then **Manage deployments → ✏️ → New version** (same link).

### Plan images in emails (optional since v0.5.8)

Print / PDF shows marked-up plans with no setup. To also put marked-up plans **inside emails**, Storage has to let the
app read plan images. In the [Google Cloud console](https://console.cloud.google.com/) pick project **pcg-punch**,
open **Cloud Shell** (the `>_` icon, top right) and paste:

```
printf '[{"origin":["https://mattsshop.github.io"],"method":["GET"],"maxAgeSeconds":3600}]' > cors.json
gcloud storage buckets update gs://pcg-punch.firebasestorage.app --cors-file=cors.json
```

Since v0.5.8 this isn't needed: without it, the app fetches the plan through the mailer instead. It only makes emails a little faster to prepare.

## Files

| File | What it is |
|---|---|
| `index.html` | The app's screens |
| `app.js` | The app's logic |
| `style.css` | The app's look |
| `fb.js` | Loads the Firebase SDK (one place to change its version) |
| `qr.js` | QR code generator for room labels |
| `seeds.js` | Room lists read off hotel plans (WoodSpring Cartersville) |
| `sw.js`, `manifest.webmanifest`, icons | Home-screen install and opening with no signal |
| `config.js` | Firebase project values — **edit this** |
| `apps-script/Mailer.gs` | Small Apps Script that sends the emails (see step 5 setup) |
| `firebase/firestore.rules` | Who can read and change which data |
| `firebase/storage.rules` | Who can read and upload plans and photos |
| `CHANGELOG.md` | What changed in each version |
