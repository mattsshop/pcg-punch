# PCG Punch changelog

## v0.5.2 (2026-11-07)
- After sending, the message says how many photos went in the email (e.g. "3 of 3 photos"), how many were still waiting to upload, and whether plans were left out.
- If photo uploads are refused, the list footer now says why (e.g. "upload refused: Storage rules") instead of just "photo(s) to upload".
- Mailer v0.5.2: accepts every photo link from this Firebase project, and puts a "View photo" link in the email if a photo can't be attached. Photos in the email link to the full-size picture. **Redeploy the mailer** (Manage deployments → ✏️ → New version).

## v0.5.1 (2026-11-07)
- Email connected to the PCG Punch Mailer (config.js).

## v0.5.0 (2026-11-07) Step 5 — email, print, Fieldwire
- **Email** (Crew and Admin): send the current list, all open items, everything, or one trade's open items. Shows as "Your name (company) via PCG Punch"; replies go to you and you get a copy. Includes photos (up to 150) and, with the one-time Storage setting in the README, marked-up plans. Each trade's email address is remembered on that device.
- Emails go through a small Apps Script (`apps-script/Mailer.gs`) that checks the sender is signed in and approved, and can send from a Gmail "Send mail as" alias.
- **Print / PDF:** summary by floor and status, each floor's plan with colored numbered dots, item table with photos. Letter landscape; choose "Save as PDF".
- **Fieldwire:** builds rows in the Task Importer's column order (title, status, category, plan + pin position, description with notes, sub, priority, photo links and CSI tags). Copy and paste into Fieldwire. Skips items already exported and marks the new ones. Plan names come from the Plans window.

## v0.4.1 (2026-11-07)
- Fix: **Print QR labels** could stay stuck on "Building…" while it waited for the server to confirm the room pages. Labels now build right away; room pages save in the background.

## v0.4.0 (2026-11-07) Step 4 — rooms and QR codes
- **Rooms & QR** (Admin): load the WoodSpring Cartersville room list (122 guest rooms + common areas, positioned from plans A1.1/A1.2), or add rooms by hand ("101-130, Lobby") and **Place** them by tapping the plan. Turn rooms off, **Show** a room's items.
- New tags fill in the nearest room automatically (can be turned off).
- **Print QR labels:** Avery 2"×2" sheets (22806, 12 per sheet, alignment adjustable, start at any label) or single images / one long strip for a mini label printer. One code per room plus one per floor.
- **Scanning a label:** signed-in people jump to that room (plan zoomed in, list filtered — "Show all rooms" clears it). Anyone else sees a read-only card of the room's open items: number, trade, description, status and one photo. No plans, names, notes or dates.
- Room cards update automatically when someone adds, changes, closes or deletes an item in that room. **Refresh public pages** rebuilds them all.
- Switches: public room pages, public photos, scan log, auto-fill room. Scan counts show in the Rooms list.
- Fix: a plan could get stuck on "Loading plan…" if the floor list changed while it loaded.
- Rules v0.4.0: room cards can only be opened one at a time (nobody can list them all). **Re-publish firebase/firestore.rules.**

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
