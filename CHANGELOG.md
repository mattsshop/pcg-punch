# PCG Punch changelog

## v0.3.0 (2026-11-07) Step 3 — tags and items
- **+ Tag**, then tap the plan: room, trade, description, assigned to, priority, due date, status, notes and photos. Room and trade are remembered for the next tag.
- Tags are colored by status and numbered 1, 2, 3… per hotel. Tap a tag to open it; **Move tag** to reposition; Admins can delete.
- List panel with search and filters (status, trade, this floor, assigned to me); tap a row to jump to the tag. Floor tabs show open counts. On phones, **List** opens it.
- **Live:** changes from anyone appear within a second or two.
- **No signal:** tags save on the device and sync when the signal returns, even if the app was closed. Photos wait in a queue on the device and upload then. Tags added offline show "…" until they get their number.
- Install to the home screen; the app opens without signal (plans and photos already seen stay available).
- Viewers can look and open tags but not change them.

## v0.2.0 (2026-11-07) Step 2 — sign-in, people, projects, plans
- Sign in with Google or with email + password (new email accounts confirm their address first; "Forgot password?" sends a reset email).
- New people request access with their name and company, then wait. As soon as an Admin approves them, their app opens by itself.
- **Users** (Admin): approve or deny requests, pick Viewer / Crew / Admin, change roles, revoke. A red number shows waiting requests.
- **Projects** (Admin): create a hotel with its number of floors, rename, switch between hotels from the name at top left.
- **Plans** (Admin): upload a plan per floor (PDF or image). PDFs are turned into a sharp image on upload (choose the page for plan sets). Rename floors, add or remove floors, Fieldwire plan name.
- Plan viewer with drag, pinch and wheel zoom; remembers the last hotel and floor.
- Rules v0.2.0: lets the owner account create its own Admin record. **Re-publish firebase/firestore.rules.**

## v0.1.1 (2026-11-07)
- Connected to the Firebase project `pcg-punch` (config.js).

## v0.1.0 (2026-11-07) Step 1 — setup
- Firestore and Storage security rules: owner is always Admin; people request access and an Admin approves them with a role (Viewer, Crew, Admin); anonymous visitors can only read stripped-down QR room cards.
- Setup check page: confirms config, Google sign-in, Firestore and Storage are working.
