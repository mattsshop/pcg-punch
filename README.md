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
| 4 | Rooms, QR labels, public read-only room pages, scan log | |
| 5 | Email to subs (Apps Script mailer), Print / PDF, Fieldwire export | |
| 6 | Move WoodSpring Cartersville items and photos over from the Sheet and Drive; switch | |

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

## Files

| File | What it is |
|---|---|
| `index.html` | The app's screens |
| `app.js` | The app's logic |
| `style.css` | The app's look |
| `fb.js` | Loads the Firebase SDK (one place to change its version) |
| `sw.js`, `manifest.webmanifest`, icons | Home-screen install and opening with no signal |
| `config.js` | Firebase project values — **edit this** |
| `firebase/firestore.rules` | Who can read and change which data |
| `firebase/storage.rules` | Who can read and upload plans and photos |
| `CHANGELOG.md` | What changed in each version |
