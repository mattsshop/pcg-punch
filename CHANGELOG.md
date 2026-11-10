# PCG Punch changelog

## v0.6.6 (2026-11-10)
- Shared QR labels are sent as JPEG instead of PNG: Phomemo opened from a shared PNG but didn't load the picture.

## v0.6.5 (2026-11-10)
- **Share QR labels to a printer app.** On phones and tablets, with "Single label images", tapping a label opens the share menu: pick **Phomemo** (or another label printer app) and print. No saving to photos first. "Download as one strip" also shares when it's 30 labels or fewer. Phones that can't share keep the old save-and-print way.

## v0.6.4 (2026-11-10) Trade QR codes
- **QR codes → "Project office: one label, pick your trade"** makes a single label for the project office. Scanning it shows "Punch list by trade": every trade with open items and how many; tap a trade to see its open items by floor and room (general items once, with the rooms still open). No sign-in needed, like room labels.
- **QR codes → "One label per trade"** makes a label for each trade that opens straight on that trade.
- Signed-in people who scan either label get the app's list for all floors, set to that trade.
- The trade board updates by itself when items change, and follows the same settings as room pages (on/off, photos, scan log).

## v0.6.3 (2026-11-10)
- On phones and tablets the item window has two photo buttons: **📷 Camera** opens the camera directly, **🖼 Photos** picks from the phone. Newer Android phones' photo picker doesn't offer the camera, so the camera needed its own button. Computers keep a single **+ Photo**.

## v0.6.2 (2026-11-10)
- **Rooms** and **QR codes** are now separate buttons (Admin). **QR codes** opens straight to label making; **Rooms** has the room list, placing rooms and the QR page settings.

## v0.6.1 (2026-11-10)
- **Delete all** button on the purple general-item bar (Admin): tap a general item's row, then Delete all removes it from every room in one step, with its photos. (Still also in Edit all.)

## v0.6.0 (2026-11-09) General items, Save-only item window
- **Item window has only Save** (no Close) for Crew and Admin. Save with nothing changed just closes; a new tag saved with no description is dropped. Viewers, who can't save, still get Close.
- **+ General:** one item for many rooms. Choose all guest rooms, guest rooms on one floor, common / BOH areas, every room, or pick rooms (with All / None per floor). Each room gets its own copy at that room's spot on the plan, so rooms are closed one by one and show on their QR page. Copies share a code (G1, G2…) and don't use up regular item numbers.
- In the list a general item is **one row** ("G1 · 87 of 122 open"). Tap it to see each room; **Edit all** changes description, trade, assigned, priority, due date, notes (and status if you pick one) in every room, adds photos to every room, or deletes the item from all rooms (Admin).
- A room's copy says which general item it belongs to, with a link to edit all rooms. Changes there are for that room only.
- New **General items** filter checkbox hides them from the list and plan.
- **Email and Print / PDF** show each general item once, listing the rooms still open, in a "General items" section after the floors. Fieldwire export still makes one task per room (titled PL-G1 …).
- Photos shared by a general item's rooms are only deleted when no room uses them any more.
- Rooms must be placed on the plans (Rooms & QR) to receive general items.

## v0.5.11 (2026-11-08)
- Mailer back to sending from matt@mattsshop.com (no alias) until an alias is set up. Mailer-only change.

## v0.5.10 (2026-11-08)
- Mailer alias changed to **pcgpunch@gmail.com** (a "Send mail as" address on matt@mattsshop.com). Mailer-only change; the app is unchanged.

## v0.5.9 (2026-11-08)
- Mailer sends from **punchlist@perimeterconstructiongroup.com** (Gmail "Send mail as" alias). Opening the mailer link shows which address it sends from, or why the alias isn't being used.
- After sending, the app's message shows the From address. **Redeploy the mailer** and allow the new Gmail permission.

## v0.5.8 (2026-11-08)
- **Plans in emails without the Cloud Shell step.** If the browser can't read the plan image, the app gets it through the mailer instead, then draws the numbered dots as before. **Redeploy the mailer** (v0.5.8).
- If plans are still left out, the message after sending says why.

## v0.5.7 (2026-11-07)
- More in **Details for support**: the signed-in account's ID and sign-in method, how many projects a direct check finds, and what the app's database library answers when asked to go to the server.

## v0.5.6 (2026-11-07)
- "Can't reach the database" screen has a **Details for support** section: device and browser, mode, the result of a direct database check, and the app's recent warnings and errors.

## v0.5.5 (2026-11-07)
- **Compatibility mode** for devices (some iPads and iPhones) where the app signs in but never gets data. If the database hasn't answered 12 seconds after sign-in but the network can reach it, the app switches that device to compatibility mode by itself and reloads. The version label then reads "(compatibility mode)". In this mode, items added with no signal are kept until the app is closed (photos still wait on the device as before).
- If the database still can't be reached, the screen says why (offline, blocked, or the error code), with **Try again** and a button to turn compatibility mode on or off.

## v0.5.4 (2026-11-07)
- On a new phone or tablet, the app shows "Loading projects…" until it has heard from the database, instead of "No projects yet" with a Create button (which could make a duplicate project).
- If the database can't be reached after about 12 seconds, it says so and suggests what to check (signal, content blockers, iCloud Private Relay).
- The empty-projects message shows which account is signed in.
- On a new device, the owner's user record is no longer rewritten before the database answers.

## v0.5.3 (2026-11-07)
- **Fixed lost photos.** If an item was open while its photo was still uploading, saving it afterward removed the photo and deleted the file. Saving now only removes photos you took off with ×.
- If a phone or browser can't keep photos on the device (some private-browsing modes), the photo uploads straight away instead of being dropped, with a "Photo uploaded" / "Photo not uploaded: reason" message.

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
