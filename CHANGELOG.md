# PCG Punch changelog

## v0.1.1 (2026-11-07)
- Connected to the Firebase project `pcg-punch` (config.js).

## v0.1.0 (2026-11-07) Step 1 — setup
- Firestore and Storage security rules: owner is always Admin; people request access and an Admin approves them with a role (Viewer, Crew, Admin); anonymous visitors can only read stripped-down QR room cards.
- Setup check page: confirms config, Google sign-in, Firestore and Storage are working.
