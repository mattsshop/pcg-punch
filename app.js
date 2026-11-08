// PCG Punch — app (sign-in, access, projects, floor plans, tags/items)
import * as F from './fb.js';
import { QR } from './qr.js';
import { ROOM_SEEDS } from './seeds.js';

const VERSION = 'v0.5.5';
const OWNER = 'matt@mattsshop.com'; // must match firebase/firestore.rules and storage.rules
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const PLAN_MAX_PX = 4200; // long side of the image made from a PDF plan
const QS = new URLSearchParams(location.search);
const ROOM_CODE = (QS.get('r') || '').replace(/[^\w-]/g, '').slice(0, 40); // from a scanned QR label
const SITE_URL = location.origin + location.pathname.replace(/index\.html$/, '');

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
function toast(msg, ms = 2800) {
  const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}

const S = {
  user: null, me: null, isOwner: false,
  projects: [], pid: null, floors: [], floor: null,
  v: { s: 1, tx: 0, ty: 0, fit: 1 }, unsub: {}
};

// ---------- Firebase ----------
const app = F.initializeApp(window.PCG_CONFIG.firebase);
const auth = F.getAuth(app);
// Compatibility mode (per device): some iPads/iPhones can't use Firestore's saved-on-device database or its live
// connection. There the app keeps data in memory and uses plain requests instead. Turned on automatically when needed.
const FS_SAFE = store('pcg_fs_safe') === '1';
const db = FS_SAFE
  ? F.initializeFirestore(app, { localCache: F.memoryLocalCache(), experimentalForceLongPolling: true })
  : F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
const storage = F.getStorage(app);

const ver = VERSION + (FS_SAFE ? ' (compatibility mode)' : '');
['verSignin'].forEach(id => $(id).textContent = 'PCG Punch ' + ver);
$('ver').textContent = ver;

function stop(key) { if (S.unsub[key]) { S.unsub[key](); delete S.unsub[key]; } }
function stopAll() { Object.keys(S.unsub).forEach(stop); }
function show(id) {
  ['scrSignin', 'scrVerify', 'scrRequest', 'scrWait', 'scrApp', 'scrPublic'].forEach(s => $(s).classList.toggle('hidden', s !== id));
}
const friendly = e => {
  const c = (e && e.code) || '';
  return ({
    'auth/invalid-credential': 'Email or password is wrong.',
    'auth/wrong-password': 'Email or password is wrong.',
    'auth/user-not-found': 'No account with that email — tap Create account.',
    'auth/email-already-in-use': 'That email already has an account — tap Sign in.',
    'auth/weak-password': 'Use at least 6 characters.',
    'auth/invalid-email': 'That email address looks wrong.',
    'auth/popup-closed-by-user': 'Sign-in window was closed.',
    'auth/unauthorized-domain': 'This web address is not allowed yet: add ' + location.hostname + ' in Firebase > Authentication > Settings > Authorized domains.',
    'auth/operation-not-allowed': 'That sign-in method is turned off in Firebase > Authentication > Sign-in method.',
    'auth/network-request-failed': 'No connection — try again.',
    'auth/too-many-requests': 'Too many tries — wait a minute and try again.',
    'permission-denied': 'Permission denied. If this is your owner account, check the email in the Firebase rules.'
  })[c] || (e && e.message) || String(e);
};

// ---------- Sign in ----------
$('googleBtn').onclick = async () => {
  $('siErr').textContent = '';
  const provider = new F.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try { await F.signInWithPopup(auth, provider); }
  catch (e) {
    if (/popup-blocked|cancelled-popup-request|operation-not-supported/.test(e.code || '')) {
      try { await F.signInWithRedirect(auth, provider); return; } catch (e2) { e = e2; }
    }
    $('siErr').textContent = friendly(e);
  }
};
F.getRedirectResult(auth).catch(e => { $('siErr').textContent = friendly(e); });
const creds = () => [$('siEmail').value.trim(), $('siPass').value];
$('siBtn').onclick = async () => {
  $('siErr').textContent = '';
  try { await F.signInWithEmailAndPassword(auth, ...creds()); } catch (e) { $('siErr').textContent = friendly(e); }
};
$('suBtn').onclick = async () => {
  $('siErr').textContent = '';
  try {
    const r = await F.createUserWithEmailAndPassword(auth, ...creds());
    await F.sendEmailVerification(r.user);
  } catch (e) { $('siErr').textContent = friendly(e); }
};
$('forgot').onclick = async ev => {
  ev.preventDefault();
  const em = $('siEmail').value.trim();
  if (!em) { $('siErr').textContent = 'Type your email above first.'; return; }
  try { await F.sendPasswordResetEmail(auth, em); $('siErr').textContent = 'Password reset email sent to ' + em + '.'; }
  catch (e) { $('siErr').textContent = friendly(e); }
};
$('vDone').onclick = async () => {
  await S.user.reload();
  if (auth.currentUser.emailVerified) route(auth.currentUser); else $('vErr').textContent = 'Not confirmed yet — open the link in the email first.';
};
$('vResend').onclick = async () => {
  try { await F.sendEmailVerification(S.user); $('vErr').textContent = 'Sent again.'; } catch (e) { $('vErr').textContent = friendly(e); }
};
['vOut', 'rOut', 'wOut'].forEach(id => $(id).onclick = () => F.signOut(auth));
$('meLink').onclick = ev => {
  ev.preventDefault();
  if (confirm(`Signed in as ${S.user.email} (${S.me.role}).\n\nSign out?`)) F.signOut(auth);
};

F.onAuthStateChanged(auth, u => route(u));

function route(u) {
  stopAll();
  S.user = u; S.me = null; document.body.className = '';
  if (!u) { if (ROOM_CODE && !S.publicDone) showPublic(); else show('scrSignin'); return; }
  const pw = u.providerData.some(p => p.providerId === 'password');
  if (pw && !u.emailVerified) { $('vEmail').textContent = u.email; show('scrVerify'); return; }
  S.isOwner = String(u.email || '').toLowerCase() === OWNER && u.emailVerified;
  const meRef = F.doc(db, 'users', u.uid);
  clearTimeout(S.dbTimer); S.noServer = '';
  if (!S.serverOk) S.dbTimer = setTimeout(noServer, 12000);
  S.unsub.me = F.onSnapshot(meRef, { includeMetadataChanges: true }, async snap => {
    const d = snap.exists() ? snap.data() : null;
    if (!snap.metadata.fromCache) serverSeen();
    if (!d && snap.metadata.fromCache) { showLoading(); return; } // new device: wait for the server before deciding
    if (!d && S.isOwner) {
      await F.setDoc(meRef, { name: u.displayName || 'Matt Holtzclaw', email: u.email, company: 'Perimeter Construction Group',
        role: 'Admin', status: 'Approved', requestedAt: F.serverTimestamp() });
      return;
    }
    if (!d) {
      $('rEmail').textContent = u.email; $('rName').value = $('rName').value || u.displayName || '';
      show('scrRequest'); return;
    }
    if (!S.isOwner && d.status !== 'Approved') {
      $('wTitle').textContent = d.status === 'Pending' ? 'Waiting for approval' : 'Access not active';
      $('wText').textContent = d.status === 'Pending'
        ? `Thanks, ${d.name}. Your request was sent to the project manager. This page opens the punch list by itself once you're approved.`
        : 'Your access to the punch list is not active. Contact the project manager.';
      show('scrWait'); return;
    }
    const first = !S.me;
    S.me = Object.assign({}, d, S.isOwner ? { role: 'Admin' } : {});
    document.body.className = 'role-' + S.me.role;
    $('meLink').textContent = S.me.name || u.email;
    if (first) enterApp();
  }, e => { $('siErr').textContent = friendly(e); show('scrSignin'); });
}

$('rSend').onclick = async () => {
  const name = $('rName').value.trim(), company = $('rCompany').value.trim();
  if (!name) { $('rErr').textContent = 'Enter your name.'; return; }
  try {
    await F.setDoc(F.doc(db, 'users', S.user.uid), {
      name, company, email: S.user.email, role: 'Crew', status: 'Pending', requestedAt: F.serverTimestamp()
    });
  } catch (e) { $('rErr').textContent = friendly(e); }
};

// ---------- App ----------
function enterApp() {
  show('scrApp');
  if (ROOM_CODE && !S.scanHandled) openScan();
  fillTrades(); processPhotoQueue(); loadQueuedThumbs(); updateNet();
  F.updateDoc(F.doc(db, 'users', S.user.uid), { lastSeen: F.serverTimestamp() }).catch(() => {});
  S.unsub.projects = F.onSnapshot(F.query(F.collection(db, 'projects'), F.orderBy('name')), { includeMetadataChanges: true }, snap => {
    if (!snap.metadata.fromCache) serverSeen();
    S.projects = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    if (!S.projects.length && !S.serverOk) { renderProjects(); showProjLoading(); return; } // this device has nothing saved yet
    renderProjects();
    const want = S.projects.find(p => p.id === S.pid) ? S.pid : (S.projects.find(p => p.id === store('pcg_pid')) || S.projects[0] || {}).id;
    if (want !== S.pid) selectProject(want);
    else if (!want) noProjects();
    if ($('projModal').classList.contains('hidden') === false) renderProjTable();
  }, e => toast(friendly(e), 6000));
  if (S.me.role === 'Admin') watchUsers();
}

function renderProjects() {
  $('projSel').innerHTML = S.projects.length
    ? S.projects.map(p => `<option value="${p.id}"${p.id === S.pid ? ' selected' : ''}>${esc(p.name)}</option>`).join('')
    : '<option>No projects yet</option>';
}
$('projSel').onchange = () => selectProject($('projSel').value);

function serverSeen() {
  S.serverOk = true; clearTimeout(S.dbTimer);
  if (S.noServer) { S.noServer = ''; if (!S.projects.length) noProjects(); }
}
// No answer from the database 12 s after sign-in: find out why, and switch this device to compatibility mode if that should help.
async function noServer() {
  if (S.serverOk || !S.user) return;
  let why;
  if (navigator.onLine === false) why = 'This device is offline.';
  else {
    try {
      const t = await S.user.getIdToken();
      const r = await fetch(`https://firestore.googleapis.com/v1/projects/${window.PCG_CONFIG.firebase.projectId}/databases/(default)/documents/users/${S.user.uid}`,
        { headers: { Authorization: 'Bearer ' + t } });
      why = r.ok || r.status === 404 ? 'reachable' : 'The database answered ' + r.status + '.';
    } catch (e) { why = 'The database could not be reached (' + (e.message || e) + ').'; }
  }
  if (S.serverOk) return;
  let tried = false; try { tried = sessionStorage.getItem('pcg_fs_tried') === '1'; } catch (e) {}
  if (why === 'reachable' && !FS_SAFE && !tried) { // network is fine but the live connection isn't: retry in compatibility mode
    try { sessionStorage.setItem('pcg_fs_tried', '1'); } catch (e) {}
    store('pcg_fs_safe', '1'); location.reload(); return;
  }
  S.noServer = why === 'reachable' ? 'The network can reach the database, but the app\'s connection to it isn\'t working.' : why;
  show('scrApp'); noProjects();
}
function showProjLoading() {
  if (S.noServer) { noProjects(); return; }
  $('plan').style.display = 'none'; $('planMsg').classList.remove('hidden');
  $('planMsg').innerHTML = '<div>Loading projects…</div>';
}
function showLoading() {
  show('scrApp'); showProjLoading();
}
function noProjects() {
  S.pid = null; S.floors = []; renderTabs();
  $('plan').style.display = 'none';
  $('planMsg').classList.remove('hidden');
  const who = `<div style="color:#5f6368;font-size:13px;margin-top:8px">Signed in as ${esc(S.user.email || '')}</div>`;
  const role = (S.me || {}).role;
  $('planMsg').innerHTML = !S.serverOk
    ? `<div>Can't reach the PCG Punch database from this device.</div><div style="font-size:13px;margin-top:6px">${esc(S.noServer || 'Still waiting for an answer.')}</div>
       <div style="font-size:13px;margin-top:6px">Check the signal, and turn off content blockers or VPN / ad-blocking apps for this site.</div>
       <div style="margin-top:10px"><button class="primary" id="dbRetry">Try again</button> <button id="dbMode">${FS_SAFE ? 'Turn off compatibility mode' : 'Try compatibility mode'}</button></div>` + who
    : role === 'Admin'
    ? '<div>No projects yet.</div><button class="primary" id="firstProj">Create your first project</button>' + who
    : '<div>No projects yet. Check back once the project manager sets one up.</div>' + who;
  const b = $('firstProj'); if (b) b.onclick = openProjects;
  if ($('dbRetry')) $('dbRetry').onclick = () => location.reload();
  if ($('dbMode')) $('dbMode').onclick = () => { store('pcg_fs_safe', FS_SAFE ? '0' : '1'); location.reload(); };
}

function selectProject(pid) {
  stop('floors'); stop('items'); stop('rooms'); S.items = []; S.rooms = []; closeModal(true);
  if (S.roomFilter && S.roomFilter.pid !== pid) clearRoomFilter(true);
  S.pid = pid; S.floor = null;
  if (!pid) { noProjects(); return; }
  store('pcg_pid', pid);
  renderProjects();
  watchItems(pid);
  watchRooms(pid);
  S.unsub.floors = F.onSnapshot(F.query(F.collection(db, 'projects', pid, 'floors'), F.orderBy('n')), snap => {
    S.floors = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    const keep = S.floors.find(f => f.n === S.floor) ? S.floor : (S.floors.find(f => f.n === Number(store('pcg_floor_' + pid))) || S.floors[0] || {}).n;
    const cur = S.floors.find(f => f.n === S.floor);
    renderTabs();
    if (keep !== S.floor || (cur && cur.planUrl !== S.shownUrl && cur.planUrl !== S.loadingUrl)) loadFloor(keep);
    if (!$('plansModal').classList.contains('hidden')) renderPlans();
  }, e => toast(friendly(e), 6000));
}

function renderTabs() {
  $('floorTabs').innerHTML = S.floors.map(f => {
    const n = (S.items || []).filter(i => i.floor === f.n && i.status !== 'Closed').length;
    return `<button data-f="${f.n}" class="${f.n === S.floor ? 'sel' : ''}">${esc(String(f.label || 'Level ' + f.n).replace(/^Level\s*/i, 'L'))}${n ? ` <small>${n}</small>` : ''}</button>`;
  }).join('');
}
$('floorTabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) loadFloor(Number(b.dataset.f)); });

function loadFloor(n) {
  S.floor = n; renderTabs(); renderList(); $('pins').innerHTML = '';
  if (S.pid && n != null) store('pcg_floor_' + S.pid, String(n));
  const f = S.floors.find(x => x.n === n), img = $('plan'), msg = $('planMsg');
  img.style.display = 'none'; S.shownUrl = null;
  if (!f) { msg.classList.remove('hidden'); msg.innerHTML = '<div>This project has no floors yet.</div>'; return; }
  if (!f.planUrl) {
    msg.classList.remove('hidden');
    msg.innerHTML = `<div>No plan uploaded for ${esc(f.label)} yet.</div>` + (S.me.role === 'Admin' ? '<button class="primary" id="upHere">Upload plan</button>' : '');
    const b = $('upHere'); if (b) b.onclick = openPlans;
    return;
  }
  msg.classList.remove('hidden'); msg.textContent = 'Loading plan…';
  S.loadingUrl = f.planUrl;
  img.onload = () => {
    if (S.floor !== n) return;
    msg.classList.add('hidden'); img.style.display = 'block'; S.shownUrl = f.planUrl; S.loadingUrl = null;
    $('stage').style.width = img.naturalWidth + 'px'; $('stage').style.height = img.naturalHeight + 'px';
    fit(); renderPins();
    if (S.pendingFocus) { focusItem(S.pendingFocus); S.pendingFocus = null; }
    if (S.pendingRoom && S.pendingRoom.floor === n) { const r = S.pendingRoom; S.pendingRoom = null; renderList(); focusRoom(r); }
  };
  img.onerror = () => { if (S.floor === n) msg.textContent = 'Could not load the plan — check your connection.'; };
  if (img.getAttribute('src') === f.planUrl && img.complete && img.naturalWidth) img.onload(); // same image already loaded
  else img.src = f.planUrl;
}

// ---------- Pan / zoom ----------
const viewer = $('viewer');
function apply() {
  $('stage').style.transform = `translate(${S.v.tx}px,${S.v.ty}px) scale(${S.v.s})`;
  $('stage').style.setProperty('--inv', 1 / S.v.s);
}
function fit() {
  const img = $('plan'); if (!img.naturalWidth) return;
  const w = viewer.clientWidth, h = viewer.clientHeight;
  const s = Math.min(w / img.naturalWidth, h / img.naturalHeight) * 0.98;
  S.v = { s, fit: s, tx: (w - img.naturalWidth * s) / 2, ty: (h - img.naturalHeight * s) / 2 };
  apply();
}
function zoomAt(cx, cy, f) {
  const r = viewer.getBoundingClientRect();
  const wx = (cx - r.left - S.v.tx) / S.v.s, wy = (cy - r.top - S.v.ty) / S.v.s;
  const ns = Math.min(Math.max(S.v.s * f, S.v.fit * 0.5), S.v.fit * 25);
  S.v.tx = cx - r.left - wx * ns; S.v.ty = cy - r.top - wy * ns; S.v.s = ns; apply();
}
const centerZoom = f => { const r = viewer.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, f); };
$('zin').onclick = () => centerZoom(1.5);
$('zout').onclick = () => centerZoom(1 / 1.5);
$('zfit').onclick = fit;
addEventListener('resize', () => fit());
viewer.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
const ptrs = new Map(); let drag = null, pinch = null;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
viewer.addEventListener('pointerdown', e => {
  if (e.target.closest('.zoomctl') || e.target.closest('#planMsg button')) return;
  viewer.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, tx: S.v.tx, ty: S.v.ty, moved: false, pin: e.target.closest('.pin') };
  else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: dist(a, b), s: S.v.s, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, tx: S.v.tx, ty: S.v.ty }; drag = null; }
});
viewer.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()], r = viewer.getBoundingClientRect();
    const ns = Math.min(Math.max(pinch.s * dist(a, b) / pinch.d, S.v.fit * 0.5), S.v.fit * 25);
    const wx = (pinch.cx - r.left - pinch.tx) / pinch.s, wy = (pinch.cy - r.top - pinch.ty) / pinch.s;
    S.v.s = ns; S.v.tx = (a.x + b.x) / 2 - r.left - wx * ns; S.v.ty = (a.y + b.y) / 2 - r.top - wy * ns; apply();
  } else if (drag) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) drag.moved = true;
    if (drag.moved) { S.v.tx = drag.tx + e.clientX - drag.x; S.v.ty = drag.ty + e.clientY - drag.y; apply(); }
  }
});
const endPtr = (e, cancel) => {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2) pinch = null;
  if (ptrs.size === 1) { const p = [...ptrs.values()][0]; drag = { x: p.x, y: p.y, tx: S.v.tx, ty: S.v.ty, moved: true }; }
  if (!ptrs.size) { if (drag && !drag.moved && !cancel) handleTap(e, drag.pin); drag = null; }
};
viewer.addEventListener('pointerup', e => endPtr(e, false));
viewer.addEventListener('pointercancel', e => endPtr(e, true));

// ---------- Modals ----------
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('.modal').classList.add('hidden'));

// Projects (Admin)
function openProjects() { renderProjTable(); $('projModal').classList.remove('hidden'); }
$('projBtn').onclick = openProjects;
function renderProjTable() {
  $('projTable').innerHTML = S.projects.length
    ? '<tr><th>Hotel</th><th>Floors</th><th></th></tr>' + S.projects.map(p =>
      `<tr><td><input data-pname="${p.id}" value="${esc(p.name)}"></td><td>${p.floorCount || ''}</td>
       <td><button data-psave="${p.id}">Rename</button> <button data-popen="${p.id}">Open</button></td></tr>`).join('')
    : '<tr><td>No projects yet.</td></tr>';
}
$('projTable').addEventListener('click', async e => {
  const s = e.target.closest('[data-psave]'), o = e.target.closest('[data-popen]');
  if (s) {
    const name = $('projTable').querySelector(`[data-pname="${s.dataset.psave}"]`).value.trim();
    if (!name) return;
    await F.updateDoc(F.doc(db, 'projects', s.dataset.psave), { name }).then(() => toast('Renamed')).catch(err => toast(friendly(err), 6000));
  }
  if (o) { selectProject(o.dataset.popen); $('projModal').classList.add('hidden'); }
});
$('npCreate').onclick = async () => {
  const name = $('npName').value.trim(), n = Math.min(30, Math.max(1, Number($('npFloors').value) || 1));
  if (!name) { toast('Enter the hotel name'); return; }
  const pref = F.doc(F.collection(db, 'projects'));
  const b = F.writeBatch(db);
  b.set(pref, { name, floorCount: n, nextNumber: 1, createdAt: F.serverTimestamp(), createdBy: S.user.uid });
  for (let i = 1; i <= n; i++) b.set(F.doc(db, 'projects', pref.id, 'floors', String(i)), { n: i, label: 'Level ' + i });
  try {
    await b.commit();
    $('npName').value = '';
    $('projModal').classList.add('hidden');
    selectProject(pref.id);
    toast('Project created — now upload the floor plans');
    openPlans();
  } catch (err) { toast(friendly(err), 6000); }
};

// Floors and plans (Admin)
function openPlans() {
  if (!S.pid) { toast('Create a project first'); return; }
  renderPlans(); $('plansModal').classList.remove('hidden');
}
$('plansBtn').onclick = openPlans;
function renderPlans() {
  const p = S.projects.find(x => x.id === S.pid) || {};
  $('plProj').textContent = p.name || '';
  $('plList').innerHTML = S.floors.map(f => `
    <div class="floorRow" data-n="${f.n}">
      <div class="head"><input data-k="label" value="${esc(f.label)}" aria-label="Floor name">
        <button data-save>Save</button></div>
      <div class="grid" style="margin-top:6px">
        <div><label>Fieldwire plan name (optional)<input data-k="fwPlan" value="${esc(f.fwPlan || '')}" placeholder="e.g. A1.1"></label></div>
        <div><label>PDF page<input data-k="page" type="number" min="1" value="${f.page || 1}"></label></div>
      </div>
      <div class="meta">${f.planUrl ? 'Plan: ' + esc(f.srcName || 'uploaded') + (f.width ? ` · ${f.width}×${f.height}px` : '') : 'No plan yet'}</div>
      <div class="btns" style="margin-top:6px">
        <label style="display:inline"><input type="file" accept="application/pdf,image/*" data-file hidden>
          <span class="primary" style="display:inline-block;background:var(--acc);color:#fff;border-radius:8px;padding:7px 12px;cursor:pointer;font-size:14px">${f.planUrl ? 'Replace plan' : 'Upload plan'}</span></label>
        <span class="sp"></span>${S.floors.length > 1 ? '<button class="danger" data-del>Remove floor</button>' : ''}
      </div>
      <div class="prog hidden"><div></div></div>
    </div>`).join('');
}
$('plList').addEventListener('click', async e => {
  const row = e.target.closest('.floorRow'); if (!row) return;
  const n = Number(row.dataset.n), ref = F.doc(db, 'projects', S.pid, 'floors', String(n));
  if (e.target.closest('[data-save]')) {
    const v = k => row.querySelector(`[data-k="${k}"]`).value;
    await F.updateDoc(ref, { label: v('label').trim() || 'Level ' + n, fwPlan: v('fwPlan').trim(), page: Math.max(1, Number(v('page')) || 1) })
      .then(() => toast('Saved')).catch(err => toast(friendly(err), 6000));
  }
  if (e.target.closest('[data-del]')) {
    if (!confirm('Remove ' + (S.floors.find(f => f.n === n) || {}).label + '? Its plan is removed too.')) return;
    await F.deleteDoc(ref).then(() => F.updateDoc(F.doc(db, 'projects', S.pid), { floorCount: S.floors.length - 1 })).catch(err => toast(friendly(err), 6000));
  }
});
$('plList').addEventListener('change', async e => {
  if (!e.target.matches('[data-file]')) return;
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  const row = e.target.closest('.floorRow'), n = Number(row.dataset.n);
  const page = Math.max(1, Number(row.querySelector('[data-k="page"]').value) || 1);
  try { await uploadPlan(n, file, page, row); }
  catch (err) { toast('Upload failed: ' + friendly(err), 7000); row.querySelector('.prog').classList.add('hidden'); }
});
$('plAdd').onclick = async () => {
  const n = (S.floors.reduce((m, f) => Math.max(m, f.n), 0) || 0) + 1;
  await F.setDoc(F.doc(db, 'projects', S.pid, 'floors', String(n)), { n, label: 'Level ' + n })
    .then(() => F.updateDoc(F.doc(db, 'projects', S.pid), { floorCount: S.floors.length + 1 }))
    .catch(err => toast(friendly(err), 6000));
};

let PDFJS_P = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve();
  if (!PDFJS_P) PDFJS_P = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = PDFJS + 'pdf.min.js';
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; res(); };
    s.onerror = () => { PDFJS_P = null; rej(new Error('Could not load the PDF reader — check your connection.')); };
    document.head.appendChild(s);
  });
  return PDFJS_P;
}
const canvasBlob = (c, type, q) => new Promise(r => c.toBlob(r, type, q));

// PDF -> high-resolution JPEG (viewers only download an image; no CORS setup needed on the bucket).
async function planImage(file, page) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    await loadPdfJs();
    const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    if (page > doc.numPages) throw new Error(`This PDF has ${doc.numPages} page(s) — set PDF page to 1–${doc.numPages}.`);
    const pg = await doc.getPage(page), v1 = pg.getViewport({ scale: 1 });
    const scale = Math.min(8, PLAN_MAX_PX / Math.max(v1.width, v1.height)), vp = pg.getViewport({ scale });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    return { blob: await canvasBlob(c, 'image/jpeg', 0.88), w: c.width, h: c.height, ext: 'jpg', type: 'image/jpeg' };
  }
  const bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That file is not a readable image or PDF.')); i.src = URL.createObjectURL(file); });
  const k = Math.min(1, 6000 / Math.max(bmp.naturalWidth, bmp.naturalHeight));
  if (k === 1 && file.size < 15 * 1024 * 1024) return { blob: file, w: bmp.naturalWidth, h: bmp.naturalHeight, ext: (file.name.split('.').pop() || 'jpg').toLowerCase(), type: file.type || 'image/jpeg' };
  const c = document.createElement('canvas'); c.width = Math.round(bmp.naturalWidth * k); c.height = Math.round(bmp.naturalHeight * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return { blob: await canvasBlob(c, 'image/jpeg', 0.9), w: c.width, h: c.height, ext: 'jpg', type: 'image/jpeg' };
}

async function uploadPlan(n, file, page, row) {
  const bar = row.querySelector('.prog'); bar.classList.remove('hidden');
  const set = p => bar.firstElementChild.style.width = Math.round(p * 100) + '%';
  set(0.05); toast('Preparing plan…', 20000);
  const img = await planImage(file, page);
  const path = `projects/${S.pid}/plans/floor${n}-${Date.now()}.${img.ext}`;
  const task = F.uploadBytesResumable(F.ref(storage, path), img.blob, { contentType: img.type });
  await new Promise((res, rej) => task.on('state_changed', s => set(0.1 + 0.85 * s.bytesTransferred / Math.max(1, s.totalBytes)), rej, res));
  const url = await F.getDownloadURL(F.ref(storage, path));
  const old = (S.floors.find(f => f.n === n) || {}).planPath;
  await F.updateDoc(F.doc(db, 'projects', S.pid, 'floors', String(n)), {
    planUrl: url, planPath: path, width: img.w, height: img.h, srcName: file.name, page,
    updatedAt: F.serverTimestamp(), updatedBy: S.user.uid
  });
  if (old && old !== path) F.deleteObject(F.ref(storage, old)).catch(() => {});
  set(1); toast('Plan uploaded');
  setTimeout(() => bar.classList.add('hidden'), 800);
}

// Users (Admin)
function watchUsers() {
  S.unsub.users = F.onSnapshot(F.collection(db, 'users'), snap => {
    S.users = snap.docs.map(d => Object.assign({ uid: d.id }, d.data()));
    const n = S.users.filter(u => u.status === 'Pending').length;
    $('pendBadge').innerHTML = n ? `<span class="badge">${n}</span>` : '';
    if (!$('usersModal').classList.contains('hidden')) renderUsers();
  }, () => {});
}
$('usersBtn').onclick = () => { renderUsers(); $('usersModal').classList.remove('hidden'); };
function renderUsers() {
  const order = { Pending: 0, Approved: 1, Revoked: 2 };
  const us = (S.users || []).slice().sort((a, b) => (order[a.status] - order[b.status]) || String(a.name).localeCompare(b.name));
  const roleSel = u => `<select data-role="${u.uid}">${['Viewer', 'Crew', 'Admin'].map(r => `<option${r === u.role ? ' selected' : ''}>${r}</option>`).join('')}</select>`;
  $('uTable').innerHTML = '<tr><th>Name</th><th>Company</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr>' + us.map(u => {
    const self = u.uid === S.user.uid;
    return `<tr><td>${esc(u.name)}${self ? ' (you)' : ''}</td><td>${esc(u.company)}</td><td>${esc(u.email)}</td>
      <td>${self ? esc(u.role) : roleSel(u)}</td><td><span class="pill ${esc(u.status)}">${esc(u.status)}</span></td>
      <td style="white-space:nowrap">${self ? '' :
        (u.status !== 'Approved' ? `<button class="primary" data-act="approve" data-u="${u.uid}">Approve</button> ` : `<button data-act="role" data-u="${u.uid}">Save role</button> `) +
        (u.status !== 'Revoked' ? `<button class="danger" data-act="revoke" data-u="${u.uid}">${u.status === 'Pending' ? 'Deny' : 'Revoke'}</button>` : '')}</td></tr>`;
  }).join('');
}
$('uTable').addEventListener('click', async e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const uid = b.dataset.u, role = $('uTable').querySelector(`[data-role="${uid}"]`).value;
  const ref = F.doc(db, 'users', uid);
  let change;
  if (b.dataset.act === 'approve') change = { status: 'Approved', role, approvedAt: F.serverTimestamp(), approvedBy: S.user.uid };
  else if (b.dataset.act === 'revoke') { if (!confirm('Remove this person\'s access?')) return; change = { status: 'Revoked' }; }
  else change = { role };
  b.disabled = true;
  try { await F.updateDoc(ref, change); toast(b.dataset.act === 'approve' ? 'Approved — their app opens by itself' : b.dataset.act === 'revoke' ? 'Access removed' : 'Role saved'); }
  catch (err) { toast(friendly(err), 6000); b.disabled = false; }
});

// =====================================================================
// Tags / items (step 3)
// =====================================================================
const TRADES = ['General / Carpentry', 'Drywall', 'Paint', 'Flooring', 'Tile', 'Doors & Hardware', 'Millwork / Casework',
  'Plumbing', 'HVAC / PTAC', 'Electrical', 'Low Voltage / Data', 'Fire Sprinkler', 'Fire Alarm', 'Windows / Storefront',
  'Roofing', 'Exterior / Siding', 'Concrete', 'Sitework', 'Signage', 'FF&E', 'Elevator', 'Cleaning'];
const STATUS_CLS = s => 's-' + String(s || 'Open').replace(/\s+/g, '');
const canEdit = () => S.me && S.me.role !== 'Viewer';
const meStamp = () => ({ uid: S.user.uid, name: S.me.name || S.user.email });
Object.assign(S, { items: [], adding: false, editing: null, moving: false, pendingPhotos: [], keptPhotos: [], queued: {}, numbering: new Set() });

function fillTrades() {
  const opts = TRADES.map(t => `<option>${esc(t)}</option>`).join('');
  $('iTrade').innerHTML = '<option value="">— Select —</option>' + opts;
  $('fTrade').innerHTML = '<option value="">All trades</option>' + opts;
}

function watchItems(pid) {
  S.unsub.items = F.onSnapshot(F.collection(db, 'projects', pid, 'items'), { includeMetadataChanges: true }, snap => {
    if (S.pid !== pid) return;
    S.items = snap.docs.map(d => Object.assign({ id: d.id, _pending: d.metadata.hasPendingWrites }, d.data()));
    S.fromCache = snap.metadata.fromCache;
    renderAll(); assignNumbers(); updateNet();
  }, e => toast(friendly(e), 6000));
}

// Item numbers: given out one at a time from the project's counter, only while online.
// Items added with no signal show "…" until the phone reconnects.
function assignNumbers() {
  if (!S.pid || !canEdit() || navigator.onLine === false) return;
  const pid = S.pid, projRef = F.doc(db, 'projects', pid);
  S.items.filter(i => i.number == null && (S.me.role === 'Admin' || (i.createdBy && i.createdBy.uid === S.user.uid)))
    .forEach(i => {
      if (S.numbering.has(i.id)) return;
      S.numbering.add(i.id);
      const itemRef = F.doc(db, 'projects', pid, 'items', i.id);
      F.runTransaction(db, async tx => {
        const p = await tx.get(projRef), it = await tx.get(itemRef);
        if (!it.exists() || it.data().number != null) return;
        const n = (p.exists() && p.data().nextNumber) || 1;
        tx.update(projRef, { nextNumber: n + 1 });
        tx.update(itemRef, { number: n });
      }).then(() => markDirty(i)).catch(() => {}).finally(() => S.numbering.delete(i.id));
    });
}

function renderAll() { renderTabs(); renderList(); renderPins(); updateSync(); }

function filtered(ignoreFloor) {
  const q = $('fSearch').value.trim().toLowerCase(), st = $('fStatus').value, tr = $('fTrade').value, rf = S.roomFilter;
  const thisFloor = $('fFloor').checked && !ignoreFloor, mine = $('fMine').checked && S.me;
  const myName = S.me ? String(S.me.name || '').toLowerCase() : '';
  return (S.items || []).filter(i => {
    if (rf && (i.floor !== rf.floor || !roomMatch(i.room, rf.room))) return false;
    if (thisFloor && i.floor !== S.floor) return false;
    if (st === 'active' && i.status === 'Closed') return false;
    if (st && st !== 'active' && i.status !== st) return false;
    if (tr && i.trade !== tr) return false;
    if (mine && String(i.assignedTo || '').toLowerCase() !== myName) return false;
    if (q && ![i.number, i.room, i.description, i.assignedTo, i.trade, i.notes].join(' ').toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => a.floor - b.floor || (a.number || 1e9) - (b.number || 1e9));
}
['fSearch', 'fStatus', 'fTrade', 'fFloor', 'fMine'].forEach(id => $(id).addEventListener('input', () => { renderList(); renderPins(); }));

const floorLabel = n => (S.floors.find(f => f.n === n) || {}).label || 'Level ' + n;
const numText = i => i.number == null ? '…' : i.number;

function renderPins() {
  const img = $('plan'); if (!img.naturalWidth || img.style.display === 'none') { $('pins').innerHTML = ''; return; }
  const ed = S.editing;
  let html = filtered(true).filter(i => i.floor === S.floor).map(i => {
    if (ed && ed.id === i.id && ed._moved) return '';
    return `<div class="pw" style="left:${i.x * 100}%;top:${i.y * 100}%"><div class="pin ${STATUS_CLS(i.status)}${i._pending ? ' pending' : ''}" data-id="${i.id}" title="#${numText(i)} ${esc(i.room)} – ${esc(i.description)}"><span>${numText(i)}</span></div></div>`;
  }).join('');
  if (ed && ed.floor === S.floor && ed.x != null && (!ed.id || ed._moved)) {
    html += `<div class="pw" style="left:${ed.x * 100}%;top:${ed.y * 100}%"><div class="pin temp"><span>${ed.id ? numText(ed) : '+'}</span></div></div>`;
  }
  $('pins').innerHTML = html;
}

function renderList() {
  if (!S.me) return;
  const items = filtered();
  $('list').innerHTML = items.length ? items.map(i => `
    <div class="row" data-id="${i.id}">
      <div class="num ${STATUS_CLS(i.status)}">${numText(i)}</div>
      <div class="body">
        <div class="t">${esc(i.room || '—')} · ${esc(i.trade || 'No trade')}</div>
        <div class="d">${esc(i.description)}</div>
        <div class="m">${esc(floorLabel(i.floor))} · ${esc(i.status)}${i.assignedTo ? ' · ' + esc(i.assignedTo) : ''}${i.dueDate ? ' · due ' + esc(i.dueDate) : ''} · <span class="pri-${esc(i.priority)}">${esc(i.priority)}</span>${(i.photos || []).length || (S.queued[i.id] || []).length ? ' · 📷' + ((i.photos || []).length + (S.queued[i.id] || []).length) : ''}${i._pending ? ' · <i>saving…</i>' : ''}</div>
      </div>
    </div>`).join('') : `<div style="padding:16px;color:var(--mut)">${S.items.length ? 'No items match.' : 'No items yet.' + (canEdit() ? ' Tap <b>+ Tag</b>, then tap the plan.' : '')}</div>`;
  const open = S.items.filter(i => i.status !== 'Closed').length;
  $('counts').textContent = `Showing ${items.length} · ${open} open of ${S.items.length} total`;
  const known = new Set((S.rooms || []).map(r => r.room));
  const typed = [...new Set(S.items.map(i => i.room).filter(r => r && !known.has(r)))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  $('roomList').innerHTML = (S.rooms || []).filter(r => r.type !== 'Floor' && r.active !== false)
    .sort((a, b) => (a.floor === S.floor ? 0 : 1) - (b.floor === S.floor ? 0 : 1) || a.room.localeCompare(b.room, undefined, { numeric: true }))
    .map(r => `<option value="${esc(r.room)}">${esc(r.name || '')} · L${r.floor}</option>`).join('') + typed.map(r => `<option value="${esc(r)}">`).join('');
  $('assignList').innerHTML = [...new Set(S.items.map(i => i.assignedTo).filter(Boolean))].sort().map(r => `<option value="${esc(r)}">`).join('');
}
$('list').addEventListener('click', e => {
  const row = e.target.closest('.row'); if (!row) return;
  const it = S.items.find(i => i.id === row.dataset.id); if (!it) return;
  $('panel').classList.remove('open');
  if (it.floor !== S.floor) { S.pendingFocus = it.id; loadFloor(it.floor); } else { focusItem(it.id); openItem(it.id); }
});
$('listBtn').onclick = () => $('panel').classList.toggle('open');

function centerOn(x, y, s) {
  const img = $('plan');
  S.v.s = s; S.v.tx = viewer.clientWidth / 2 - x * img.naturalWidth * s; S.v.ty = viewer.clientHeight / 2 - y * img.naturalHeight * s; apply();
}
function focusItem(id) {
  const it = S.items.find(i => i.id === id); if (!it || !$('plan').naturalWidth) return;
  centerOn(it.x, it.y, Math.max(S.v.s, S.v.fit * 3));
  const p = document.querySelector(`.pin[data-id="${id}"]`);
  if (p) { p.classList.remove('flash'); void p.offsetWidth; p.classList.add('flash'); }
}

// ---- tapping the plan
function planCoords(e) {
  const img = $('plan'); if (!img.naturalWidth || img.style.display === 'none') return null;
  const r = viewer.getBoundingClientRect();
  const x = (e.clientX - r.left - S.v.tx) / S.v.s / img.naturalWidth, y = (e.clientY - r.top - S.v.ty) / S.v.s / img.naturalHeight;
  return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x: +x.toFixed(5), y: +y.toFixed(5) };
}
function hint(t) { $('hint').textContent = t; $('hint').classList.toggle('hidden', !t); }
function handleTap(e, pin) {
  if (S.placing) { placeRoomAt(e); return; }
  if (S.moving) {
    const c = planCoords(e); if (!c) return;
    Object.assign(S.editing, { x: c.x, y: c.y, _moved: true }); S.moving = false;
    hint(S.adding ? 'Tap the plan where the issue is' : ''); renderPins(); $('itemModal').classList.remove('hidden');
    toast('New spot set — tap Save to keep it'); return;
  }
  if (pin && pin.dataset.id) { openItem(pin.dataset.id); return; }
  if (S.adding && canEdit()) { const c = planCoords(e); if (c) openNew(c.x, c.y); }
}
$('addBtn').onclick = () => {
  if (!$('plan').naturalWidth || $('plan').style.display === 'none') { toast('Upload a plan for this floor first'); return; }
  S.adding = !S.adding;
  $('addBtn').textContent = S.adding ? 'Done tagging' : '+ Tag';
  $('addBtn').classList.toggle('danger', S.adding);
  viewer.classList.toggle('adding', S.adding);
  hint(S.adding ? 'Tap the plan where the issue is' : '');
  if (S.adding) $('panel').classList.remove('open');
};

// ---- item window
function openNew(x, y) {
  S.editing = { x, y, floor: S.floor, status: 'Open', priority: 'Medium', photos: [] };
  const near = nearestRoom(S.floor, x, y);
  fillForm({ room: near ? near.room : (S.roomFilter ? S.roomFilter.room : (store('pcg_room') || '')), trade: store('pcg_trade') || '', description: '', assignedTo: '', priority: 'Medium', dueDate: '', status: 'Open', notes: '', photos: [] });
  $('itemTitle').textContent = 'New tag – ' + floorLabel(S.floor);
  $('iDelete').style.display = 'none'; $('iMove').style.display = 'none'; $('iMeta').textContent = '';
  showModal(); setTimeout(() => $('iDesc').focus(), 50);
}
function openItem(id) {
  const it = S.items.find(i => i.id === id); if (!it) return;
  S.editing = Object.assign({}, it);
  fillForm(it);
  $('itemTitle').textContent = `#${numText(it)} – ${floorLabel(it.floor)}`;
  $('iDelete').style.display = ''; $('iMove').style.display = '';
  const when = t => t ? new Date(t.toDate ? t.toDate() : t).toLocaleString() : '';
  $('iMeta').textContent = [it.createdBy ? `Added by ${it.createdBy.name} ${when(it.createdAt)}` : '',
    it.updatedBy ? `Updated by ${it.updatedBy.name} ${when(it.updatedAt)}` : '', it.closedAt ? 'Closed ' + when(it.closedAt) : ''].filter(Boolean).join(' · ');
  showModal();
}
function fillForm(it) {
  const ro = !canEdit();
  ['iRoom', 'iTrade', 'iDesc', 'iAssigned', 'iPriority', 'iDue', 'iStatus', 'iNotes'].forEach(id => $(id).disabled = ro);
  $('iRoom').value = it.room || ''; $('iTrade').value = it.trade || ''; $('iDesc').value = it.description || '';
  $('iAssigned').value = it.assignedTo || ''; $('iPriority').value = it.priority || 'Medium';
  $('iDue').value = it.dueDate || ''; $('iStatus').value = it.status || 'Open'; $('iNotes').value = it.notes || '';
  S.keptPhotos = (it.photos || []).slice(); S.openedPhotos = S.keptPhotos.slice(); S.pendingPhotos = [];
  renderPhotos();
}
function showModal() { $('itemModal').classList.remove('hidden'); renderPins(); }
function closeModal(quiet) {
  $('itemModal').classList.add('hidden'); S.editing = null; S.moving = false;
  if (!quiet) { hint(S.adding ? 'Tap the plan where the issue is' : ''); renderPins(); }
}
$('iCancel').onclick = () => closeModal();
$('iMove').onclick = () => {
  if (S.editing.floor !== S.floor) { toast('Switch to ' + floorLabel(S.editing.floor) + ' first'); return; }
  S.moving = true; $('itemModal').classList.add('hidden'); hint('Tap the new spot for #' + numText(S.editing));
};

function renderPhotos() {
  const box = $('iPhotos'), edit = canEdit();
  const queued = S.editing && S.editing.id ? (S.queued[S.editing.id] || []) : [];
  let html = S.keptPhotos.map((p, i) => `<div class="ph"><img src="${esc(p.thumbUrl || p.url)}" data-full="${esc(p.url)}" alt="">${edit ? `<button data-rm="${i}">×</button>` : ''}</div>`).join('');
  html += queued.map(u => `<div class="ph queued" title="Uploading when there is signal"><img src="${u}" data-full="${u}" alt=""></div>`).join('');
  html += S.pendingPhotos.map((p, i) => `<div class="ph"><img src="${p.preview}" data-full="${p.preview}" alt=""><button data-rmnew="${i}">×</button></div>`).join('');
  if (edit) html += '<div class="addph" id="addPh">+ Photo</div>';
  box.innerHTML = html;
}
$('iPhotos').addEventListener('click', e => {
  if (e.target.id === 'addPh') { $('iFile').click(); return; }
  if (e.target.dataset.rm != null) { S.keptPhotos.splice(Number(e.target.dataset.rm), 1); renderPhotos(); return; }
  if (e.target.dataset.rmnew != null) { S.pendingPhotos.splice(Number(e.target.dataset.rmnew), 1); renderPhotos(); return; }
  if (e.target.tagName === 'IMG') { $('lightbox').querySelector('img').src = e.target.dataset.full || e.target.src; $('lightbox').classList.remove('hidden'); }
});
$('lightbox').onclick = () => $('lightbox').classList.add('hidden');

function resizeImage(file, max, q) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      c.toBlob(b => b ? res(b) : rej(new Error('Could not read photo')), 'image/jpeg', q);
    };
    img.onerror = () => rej(new Error('Could not read photo')); img.src = url;
  });
}
$('iFile').addEventListener('change', async e => {
  for (const f of e.target.files) {
    try {
      const full = await resizeImage(f, 1600, 0.8), thumb = await resizeImage(f, 400, 0.7);
      S.pendingPhotos.push({ full, thumb, preview: URL.createObjectURL(thumb) });
    } catch (err) { toast(err.message); }
  }
  e.target.value = ''; renderPhotos();
});

// Save: written to the phone first (works with no signal), then synced by Firestore.
$('iSave').onclick = async () => {
  const ed = S.editing;
  if (!$('iDesc').value.trim()) { toast('Add a description'); $('iDesc').focus(); return; }
  const isNew = !ed.id;
  const ref = isNew ? F.doc(F.collection(db, 'projects', S.pid, 'items')) : F.doc(db, 'projects', S.pid, 'items', ed.id);
  const status = $('iStatus').value;
  const data = {
    floor: ed.floor, x: ed.x, y: ed.y,
    room: $('iRoom').value.trim(), trade: $('iTrade').value, description: $('iDesc').value.trim(),
    assignedTo: $('iAssigned').value.trim(), priority: $('iPriority').value, dueDate: $('iDue').value,
    status, notes: $('iNotes').value.trim(),
    updatedAt: F.serverTimestamp(), updatedBy: meStamp()
  };
  const before = isNew ? null : S.items.find(i => i.id === ed.id);
  if (status === 'Closed' && (!before || before.status !== 'Closed')) data.closedAt = F.serverTimestamp();
  if (status !== 'Closed') data.closedAt = null;
  if (isNew) Object.assign(data, { number: null, photos: [], createdAt: F.serverTimestamp(), createdBy: meStamp() });
  // Only remove the photos taken off in this window. Never rewrite the whole list, so a photo that
  // finished uploading while the window was open isn't dropped.
  const removed = isNew ? [] : (S.openedPhotos || []).filter(p => !S.keptPhotos.some(k => k.path === p.path));
  if (removed.length) data.photos = F.arrayRemove(...removed);
  store('pcg_room', data.room); store('pcg_trade', data.trade);
  if (before) markDirty(before);
  markDirty({ floor: data.floor, room: data.room });
  (isNew ? F.setDoc(ref, data) : F.updateDoc(ref, data)).catch(err => toast('Not saved: ' + friendly(err), 8000));
  // photos removed in this edit
  removed.forEach(p => { [p.path, p.thumbPath].filter(Boolean).forEach(x => F.deleteObject(F.ref(storage, x)).catch(() => {})); });
  // new photos go into a queue on this device and upload when there is signal
  const newOnes = S.pendingPhotos.slice();
  closeModal();
  toast(isNew ? 'Tag added' : 'Saved');
  if (newOnes.length) {
    for (const p of newOnes) {
      const e = { pid: S.pid, itemId: ref.id, full: p.full, thumb: p.thumb, at: Date.now() };
      try { await PQ.add(e); }
      catch (err) { // this browser can't keep photos on the device: upload straight away instead
        console.warn('Photo queue unavailable', err);
        e.k = 'd' + e.at + Math.random().toString(36).slice(2, 6);
        uploadPhoto(e).then(() => toast('Photo uploaded')).catch(er => toast('Photo not uploaded: ' + (er.code || er.message), 10000));
      }
    }
    await loadQueuedThumbs(); renderList(); processPhotoQueue();
  }
};
$('iDelete').onclick = async () => {
  const ed = S.editing;
  if (!confirm(`Delete #${numText(ed)}? This can't be undone.`)) return;
  const it = S.items.find(i => i.id === ed.id) || ed;
  F.deleteDoc(F.doc(db, 'projects', S.pid, 'items', ed.id)).catch(err => toast(friendly(err), 6000));
  markDirty(it);
  (it.photos || []).forEach(p => [p.path, p.thumbPath].filter(Boolean).forEach(x => F.deleteObject(F.ref(storage, x)).catch(() => {})));
  closeModal(); toast('Deleted #' + numText(ed));
};

// ---- photo upload queue (IndexedDB) — survives closing the app with no signal
const PQ = {
  open() {
    return this.p || (this.p = new Promise((res, rej) => {
      const r = indexedDB.open('pcg-punch', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('photoQueue', { keyPath: 'k', autoIncrement: true });
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => { const t = db.transaction('photoQueue', mode); const out = fn(t.objectStore('photoQueue')); t.oncomplete = () => res(out && out.result); t.onerror = () => rej(t.error); });
  },
  add(v) { return this.tx('readwrite', s => s.add(v)); },
  all() { return this.tx('readonly', s => s.getAll()); },
  del(k) { return this.tx('readwrite', s => s.delete(k)); }
};
async function loadQueuedThumbs() {
  try {
    Object.values(S.queued).flat().forEach(u => URL.revokeObjectURL(u));
    const q = await PQ.all(); S.queued = {};
    q.forEach(e => (S.queued[e.itemId] = S.queued[e.itemId] || []).push(URL.createObjectURL(e.thumb)));
    updateSync();
  } catch (e) { /* storage unavailable (private mode) */ }
}
async function uploadPhoto(e) {
  const base = `projects/${e.pid}/photos/${e.itemId}-${e.at}-${e.k}`;
  await F.uploadBytes(F.ref(storage, base + '.jpg'), e.full, { contentType: 'image/jpeg' });
  await F.uploadBytes(F.ref(storage, base + '-thumb.jpg'), e.thumb, { contentType: 'image/jpeg' });
  const [url, thumbUrl] = await Promise.all([F.getDownloadURL(F.ref(storage, base + '.jpg')), F.getDownloadURL(F.ref(storage, base + '-thumb.jpg'))]);
  await F.updateDoc(F.doc(db, 'projects', e.pid, 'items', e.itemId),
    { photos: F.arrayUnion({ path: base + '.jpg', url, thumbPath: base + '-thumb.jpg', thumbUrl }) });
  const it = S.items.find(x => x.id === e.itemId); if (it && e.pid === S.pid) markDirty(it);
}
let pqBusy = false;
async function processPhotoQueue() {
  if (pqBusy || navigator.onLine === false || !S.me || !canEdit()) return;
  pqBusy = true;
  try {
    for (const e of await PQ.all()) {
      try {
        await uploadPhoto(e);
        await PQ.del(e.k); S.pqError = '';
      } catch (err) {
        if (/not-found/.test(err.code || '') && !/object-not-found/.test(err.code || '')) { await PQ.del(e.k); continue; } // item was deleted
        console.warn('Photo upload failed', err);
        S.pqError = navigator.onLine === false ? '' : (err.code || err.message || 'unknown error');
        break; // no signal or another problem: try again later
      }
    }
  } catch (e) { /* ignore */ }
  pqBusy = false;
  await loadQueuedThumbs(); renderList();
}
setInterval(processPhotoQueue, 30000);

// ---- connection / sync status
function updateSync() {
  const saving = (S.items || []).filter(i => i._pending).length, photos = Object.values(S.queued).flat().length;
  const why = photos && S.pqError ? ` (upload refused: ${/unauthorized/.test(S.pqError) ? 'Storage rules — see README step 1.5' : S.pqError})` : '';
  $('syncState').textContent = [saving ? `${saving} change(s) to sync` : '', photos ? `${photos} photo(s) to upload${why}` : ''].filter(Boolean).join(' · ');
}
function updateNet() {
  const off = navigator.onLine === false;
  $('netState').textContent = off ? 'Offline — changes are saved on this device' : '';
}
addEventListener('online', () => { updateNet(); processPhotoQueue(); assignNumbers(); });
addEventListener('offline', updateNet);

// ---- install + offline app shell
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// =====================================================================
// Rooms, public QR pages, scan log, QR labels (step 4)
// =====================================================================
const SETTINGS_DEFAULT = { publicRooms: true, publicPhotos: true, logScans: true, autoRoom: true };
const project = () => S.projects.find(p => p.id === S.pid) || {};
const settings = () => Object.assign({}, SETTINGS_DEFAULT, project().settings || {});

function roomMatch(itemRoom, room) {
  const a = String(itemRoom || '').trim().toLowerCase(), b = String(room || '').trim().toLowerCase();
  if (!a || !b) return false;
  return a === b || a.startsWith(b + ' ') || a.startsWith(b + '-') || a.startsWith(b + ',');
}
function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789', b = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(b, x => A[x % A.length]).join('');
}

function watchRooms(pid) {
  S.unsub.rooms = F.onSnapshot(F.collection(db, 'projects', pid, 'rooms'), snap => {
    if (S.pid !== pid) return;
    S.rooms = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    renderList();
    if (!$('roomsModal').classList.contains('hidden')) renderRooms();
    if (S.scanWant && S.scanWant.pid === pid) {
      const r = S.rooms.find(x => x.code === S.scanWant.code);
      if (r) { S.scanWant = null; setRoomFilter(r, true); }
    }
  }, () => {});
}

// ---- nearest room for a new tag
function nearestRoom(floor, x, y) {
  if (!settings().autoRoom || !S.rooms) return null;
  const img = $('plan'), W = img.naturalWidth || 4000, H = img.naturalHeight || 1500;
  let best = null, bd = Infinity;
  S.rooms.forEach(r => {
    if (r.floor !== floor || r.type === 'Floor' || r.x == null || r.active === false) return;
    const d = Math.hypot((r.x - x) * W, (r.y - y) * H);
    if (d < bd) { bd = d; best = r; }
  });
  return best && bd < 0.12 * W ? best : null;
}

// ---- room filter (from a scan or the Rooms list)
function setRoomFilter(r, fromScan) {
  if (r.type === 'Floor') { clearRoomFilter(true); loadFloor(r.floor); if (fromScan) toast(r.room + ' — all rooms on this floor'); return; }
  S.roomFilter = Object.assign({ pid: S.pid }, r);
  $('roomChipText').textContent = 'Room ' + r.room + (r.name ? ' · ' + r.name : '') + ' · L' + r.floor;
  $('roomChip').classList.remove('hidden');
  if (r.floor !== S.floor || !$('plan').naturalWidth) { S.pendingRoom = r; loadFloor(r.floor); } else { renderList(); renderPins(); focusRoom(r); }
  if (fromScan && innerWidth <= 800) $('panel').classList.add('open');
}
function clearRoomFilter(quiet) { S.roomFilter = null; $('roomChip').classList.add('hidden'); if (!quiet) { renderList(); renderPins(); fit(); } }
$('roomChipX').onclick = () => clearRoomFilter();
function focusRoom(r) { if (r.x != null && $('plan').naturalWidth) centerOn(r.x, r.y, Math.max(S.v.fit * 4, S.v.s)); }

// ---- scans
function logScan(code, uid, allowed) {
  if (!allowed) return;
  F.setDoc(F.doc(F.collection(db, 'scans')), { code, at: F.serverTimestamp(), uid: uid || null }).catch(() => {});
}
async function openScan() {
  S.scanHandled = true;
  try {
    const snap = await F.getDoc(F.doc(db, 'public', ROOM_CODE));
    if (!snap.exists()) { toast('That QR code is not set up yet — ask the project manager.', 6000); return; }
    const p = snap.data();
    logScan(ROOM_CODE, S.user.uid, p.log);
    S.scanWant = { pid: p.pid, code: ROOM_CODE };
    if (p.pid !== S.pid) selectProject(p.pid);
    else { const r = (S.rooms || []).find(x => x.code === ROOM_CODE); if (r) { S.scanWant = null; setRoomFilter(r, true); } }
  } catch (e) { toast(friendly(e), 6000); }
}
async function showPublic() {
  show('scrPublic');
  $('pubSignIn').onclick = () => { S.publicDone = true; show('scrSignin'); };
  $('pubRoom').textContent = 'Loading…'; $('pubSub').textContent = ''; $('pubList').innerHTML = '';
  let p = null;
  try { const snap = await F.getDoc(F.doc(db, 'public', ROOM_CODE)); p = snap.exists() ? snap.data() : null; }
  catch (e) { $('pubRoom').textContent = 'Could not load'; $('pubSub').textContent = 'Check your connection and scan again.'; return; }
  $('pubProj').textContent = p && p.projectName || '';
  if (!p || p.off) {
    $('pubRoom').textContent = p ? 'Sign in required' : 'QR code not active';
    $('pubSub').textContent = p ? 'Room pages are turned off for this project. Sign in to see the punch list.' : 'This label is not in use. Ask the project manager for a new one.';
    return;
  }
  logScan(ROOM_CODE, null, p.log);
  const isFloor = p.type === 'Floor';
  $('pubRoom').textContent = isFloor ? p.floorLabel : 'Room ' + p.room;
  $('pubSub').textContent = isFloor ? 'Open punch items on this floor' : [p.name, p.floorLabel].filter(Boolean).join(' · ');
  const card = i => `<div class="pub-card">${i.thumbUrl ? `<img src="${esc(i.thumbUrl)}" alt="">` : ''}<div>
    <div class="t">#${esc(i.number == null ? '…' : i.number)}${i.trade ? ' · ' + esc(i.trade) : ''}</div>
    <div class="d">${esc(i.description)}</div><span class="stp ${STATUS_CLS(i.status)}">${esc(i.status)}</span></div></div>`;
  const items = p.items || [];
  if (!items.length) { $('pubList').innerHTML = '<div class="pub-card"><div class="t">No open punch items here.</div></div>'; return; }
  if (isFloor) {
    const g = {}; items.forEach(i => (g[i.room || 'Other'] = g[i.room || 'Other'] || []).push(i));
    $('pubList').innerHTML = Object.keys(g).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map(k => `<div class="pub-room">Room ${esc(k)} — ${g[k].length}</div>` + g[k].map(card).join('')).join('');
  } else $('pubList').innerHTML = `<div class="meta" style="margin-bottom:6px">${items.length} open item(s)</div>` + items.map(card).join('');
}

// ---- public room cards: rebuilt by whoever changes an item in that room
let dirty = new Set(), dirtyT = null;
function codesFor(item) {
  if (!item || !S.rooms) return [];
  return S.rooms.filter(r => r.floor === item.floor && (r.type === 'Floor' || roomMatch(item.room, r.room))).map(r => r.code);
}
function markDirty(item) {
  if (!canEdit()) return;
  codesFor(item).forEach(c => dirty.add(c));
  clearTimeout(dirtyT); dirtyT = setTimeout(() => { const c = [...dirty]; dirty.clear(); publishRooms(c); }, 1500);
}
function publicDoc(r) {
  const st = settings(), p = project();
  if (!st.publicRooms || r.active === false) return { pid: S.pid, projectName: p.name || '', off: true, log: !!st.logScans };
  const items = S.items.filter(i => i.status !== 'Closed' && i.floor === r.floor && (r.type === 'Floor' || roomMatch(i.room, r.room)))
    .sort((a, b) => String(a.room).localeCompare(String(b.room), undefined, { numeric: true }) || (a.number || 1e9) - (b.number || 1e9))
    .map(i => {
      const o = { number: i.number == null ? null : i.number, room: i.room || '', trade: i.trade || '', description: i.description || '', status: i.status };
      const ph = (i.photos || [])[0];
      if (st.publicPhotos && ph) o.thumbUrl = ph.thumbUrl || ph.url;
      return o;
    });
  return { pid: S.pid, projectName: p.name || '', room: r.room, name: r.name || '', type: r.type || '', floor: r.floor,
    floorLabel: floorLabel(r.floor), log: !!st.logScans, items, updatedAt: F.serverTimestamp() };
}
// Writes go to the device first and sync in the background. The returned promise settles when the
// server confirms (or after 15 s), so nothing on screen ever waits on it for long.
function publishRooms(codes) {
  const rs = (S.rooms || []).filter(r => codes.includes(r.code)), jobs = [];
  for (let k = 0; k < rs.length; k += 400) {
    const b = F.writeBatch(db);
    rs.slice(k, k + 400).forEach(r => b.set(F.doc(db, 'public', r.code), publicDoc(r)));
    jobs.push(b.commit().catch(e => { toast('Room pages not updated: ' + friendly(e), 7000); throw e; }));
  }
  return Promise.race([Promise.all(jobs), new Promise(res => setTimeout(res, 15000))]).catch(() => {});
}

// ---- Rooms & QR window (Admin)
$('roomsBtn').onclick = () => {
  if (!S.pid) { toast('Create a project first'); return; }
  $('rmSeed').innerHTML = '<option value="">Room list from…</option>' + Object.keys(ROOM_SEEDS).map(k => `<option>${esc(k)}</option>`).join('');
  $('rmAddFloor').innerHTML = S.floors.map(f => `<option value="${f.n}">${esc(f.label)}</option>`).join('');
  $('rmFloor').innerHTML = '<option value="">All floors</option>' + S.floors.map(f => `<option value="${f.n}">${esc(f.label)}</option>`).join('');
  $('rmFloor').value = String(S.floor || '');
  const st = settings();
  document.querySelectorAll('[data-set]').forEach(c => c.checked = !!st[c.dataset.set]);
  renderRooms(); loadScanCounts();
  $('roomsModal').classList.remove('hidden');
};
$('rmFloor').onchange = () => renderRooms();
document.querySelectorAll('[data-set]').forEach(c => c.onchange = async () => {
  const next = Object.assign(settings(), { [c.dataset.set]: c.checked });
  await F.updateDoc(F.doc(db, 'projects', S.pid), { settings: next }).catch(e => toast(friendly(e), 6000));
  if (c.dataset.set !== 'autoRoom') { toast('Updating public pages…'); setTimeout(() => publishRooms(S.rooms.map(r => r.code)).then(() => toast('Public pages updated')), 600); }
});
$('rmPublish').onclick = () => { toast('Updating room pages…', 15000); publishRooms(S.rooms.map(r => r.code)).then(() => toast('Room pages updated')); };

async function loadScanCounts() {
  S.scanCounts = {};
  try {
    const snap = await F.getDocs(F.collection(db, 'scans'));
    snap.docs.forEach(d => { const c = d.data().code; S.scanCounts[c] = (S.scanCounts[c] || 0) + 1; });
    if (!$('roomsModal').classList.contains('hidden')) renderRooms();
  } catch (e) { /* only Admins can read the log */ }
}
function sortRooms(a, b) {
  return a.floor - b.floor || (a.type === 'Floor' ? -1 : b.type === 'Floor' ? 1 : 0) || a.room.localeCompare(b.room, undefined, { numeric: true });
}
function renderRooms() {
  $('rmProj').textContent = project().name || '';
  const f = Number($('rmFloor').value) || null;
  const rs = (S.rooms || []).filter(r => !f || r.floor === f).sort(sortRooms);
  $('rmCount').textContent = `${(S.rooms || []).filter(r => r.type === 'Guest room').length} guest rooms · ${(S.rooms || []).length} QR codes`;
  $('rmTable').innerHTML = rs.length ? '<tr><th>Room</th><th>Name</th><th>Floor</th><th>On plan</th><th>Scans</th><th></th></tr>' + rs.map(r => `
    <tr class="${r.active === false ? 'dim' : ''}"><td><b>${esc(r.room)}</b></td><td>${esc(r.name || '')}</td><td>${esc(floorLabel(r.floor))}</td>
    <td>${r.type === 'Floor' ? '—' : r.x != null ? '✓' : '<span class="dim">not placed</span>'}</td><td>${(S.scanCounts || {})[r.code] || ''}</td>
    <td style="white-space:nowrap">${r.type === 'Floor' ? '' : `<button data-place="${r.id}">Place</button> `}<button data-show="${r.id}">Show</button>
      <button data-toggle="${r.id}">${r.active === false ? 'Turn on' : 'Turn off'}</button></td></tr>`).join('')
    : '<tr><td>No rooms yet. Load a room list or add rooms by hand.</td></tr>';
}
$('rmTable').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  const id = b.dataset.place || b.dataset.show || b.dataset.toggle, r = S.rooms.find(x => x.id === id); if (!r) return;
  if (b.dataset.place) {
    $('roomsModal').classList.add('hidden');
    if (r.floor !== S.floor) loadFloor(r.floor);
    S.placing = r; hint('Tap the spot for room ' + r.room + ' on the plan');
  } else if (b.dataset.show) { $('roomsModal').classList.add('hidden'); setRoomFilter(r); }
  else {
    await F.updateDoc(F.doc(db, 'projects', S.pid, 'rooms', r.id), { active: r.active === false }).catch(err => toast(friendly(err), 6000));
    publishRooms([r.code]);
  }
});
function placeRoomAt(e) {
  const c = planCoords(e), r = S.placing; S.placing = null; hint(S.adding ? 'Tap the plan where the issue is' : '');
  if (!c) return;
  F.updateDoc(F.doc(db, 'projects', S.pid, 'rooms', r.id), { x: c.x, y: c.y }).then(() => toast('Room ' + r.room + ' placed')).catch(err => toast(friendly(err), 6000));
}
async function addRooms(list) {
  const have = new Set((S.rooms || []).map(r => r.floor + '|' + r.room.toLowerCase()));
  const fresh = list.filter(r => !have.has(r.floor + '|' + r.room.toLowerCase()));
  for (let k = 0; k < fresh.length; k += 400) {
    const b = F.writeBatch(db);
    fresh.slice(k, k + 400).forEach(r => b.set(F.doc(F.collection(db, 'projects', S.pid, 'rooms')),
      Object.assign({ x: null, y: null, active: true }, r, { code: newCode() })));
    await b.commit();
  }
  return fresh.length;
}
$('rmLoadSeed').onclick = async () => {
  const key = $('rmSeed').value; if (!key) { toast('Pick a room list first'); return; }
  const rows = ROOM_SEEDS[key].split(';').map(t => { const [room, floor, name, x, y] = t.split('|'); return { room, floor: Number(floor), name, x: Number(x), y: Number(y), type: /suite|king/i.test(name) ? 'Guest room' : 'Common / BOH' }; });
  const floors = [...new Set(rows.map(r => r.floor))];
  if (floors.some(n => !S.floors.find(f => f.n === n))) { toast(`That list needs floors ${floors.join(', ')} — add them under Plans first.`, 7000); return; }
  floors.forEach(n => rows.unshift({ room: floorLabel(n), floor: n, name: 'Whole floor', type: 'Floor' }));
  try { const n = await addRooms(rows); toast(n + ' rooms added'); setTimeout(() => publishRooms(S.rooms.map(r => r.code)), 1500); }
  catch (err) { toast(friendly(err), 6000); }
};
$('rmAddBtn').onclick = async () => {
  const floor = Number($('rmAddFloor').value), type = $('rmAddType').value, out = [];
  $('rmAdd').value.split(',').map(t => t.trim()).filter(Boolean).forEach(t => {
    const m = t.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) for (let n = Number(m[1]); n <= Number(m[2]) && out.length < 500; n++) out.push({ room: String(n), floor, type, name: '' });
    else out.push({ room: t, floor, type: /^\d+[A-Z]?$/i.test(t) ? type : 'Common / BOH', name: /^\d/.test(t) ? '' : t });
  });
  if (!out.length) { toast('Type some rooms first'); return; }
  try { const n = await addRooms(out); $('rmAdd').value = ''; toast(n + ' room(s) added'); setTimeout(() => publishRooms(S.rooms.map(r => r.code)), 1500); }
  catch (err) { toast(friendly(err), 6000); }
};

// ---- QR labels
const AVERY = { top: 0.625, left: 0.625, px: 2.625, py: 2.5 };
const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
$('qrOpen').onclick = () => {
  const a = Object.assign({}, AVERY); try { Object.assign(a, JSON.parse(store('pcg_avery') || '{}')); } catch (e) {}
  $('qTop').value = a.top; $('qLeft').value = a.left; $('qPx').value = a.px; $('qPy').value = a.py;
  $('qOut').innerHTML = ''; $('qStrip').classList.add('hidden');
  $('roomsModal').classList.add('hidden'); qrCount(); $('qrModal').classList.remove('hidden');
};
function qrRooms() {
  const v = $('qWhich').value, rs = (S.rooms || []).filter(r => r.active !== false).slice().sort(sortRooms);
  if (v === 'all') return rs;
  if (v === 'guest') return rs.filter(r => r.type === 'Guest room');
  if (v === 'common') return rs.filter(r => r.type !== 'Guest room' && r.type !== 'Floor');
  if (v === 'floors') return rs.filter(r => r.type === 'Floor');
  if (v === 'floor') return rs.filter(r => r.floor === S.floor);
  const want = new Set();
  $('qList').value.split(',').map(t => t.trim().toLowerCase()).filter(Boolean).forEach(t => {
    const m = t.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) for (let n = Number(m[1]); n <= Number(m[2]); n++) want.add(String(n)); else want.add(t);
  });
  return rs.filter(r => want.has(r.room.toLowerCase()));
}
function qrCount() {
  const n = qrRooms().length, avery = $('qFormat').value === 'avery';
  $('qListWrap').classList.toggle('hidden', $('qWhich').value !== 'list');
  $('qAdj').classList.toggle('hidden', !avery);
  $('qCount').textContent = n + ' label(s)' + (avery ? ' · ' + Math.ceil((n + (Number($('qStart').value) || 1) - 1) / 12) + ' sheet(s)' : '');
}
['qWhich', 'qFormat', 'qStart', 'qList'].forEach(id => $(id).addEventListener('input', qrCount));

function labelCanvas(r, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.fillStyle = '#000'; x.textAlign = 'center';
  const pad = Math.round(w * 0.05);
  const fitText = (t, max, size, weight) => { let s = Math.round(size); do { x.font = `${weight} ${s}px Arial, Helvetica, sans-serif`; s--; } while (x.measureText(t).width > max && s > 6); };
  const big = r.type === 'Floor' ? r.room.toUpperCase() : 'Room ' + r.room;
  let y = pad + h * 0.115;
  fitText(big, w - 2 * pad, h * 0.13, 'bold'); x.fillText(big, w / 2, y);
  const sub = r.type === 'Floor' ? 'Whole floor' : [r.name, floorLabel(r.floor)].filter(Boolean).join(' · ');
  y += h * 0.065; fitText(sub, w - 2 * pad, h * 0.052, 'normal'); x.fillText(sub, w / 2, y);
  const foot = String(project().name || '').replace(/\s+Suites\b/i, '') + ' · scan for punch list';
  const footH = h * 0.06, qrTop = y + h * 0.012, side = Math.min(w - 2 * pad * 0.4, h - qrTop - footH - pad * 0.6);
  QR.draw(x, QR.encode(SITE_URL + '?r=' + r.code, 'M'), Math.round((w - side) / 2), Math.round(qrTop), Math.round(side));
  fitText(foot, w - 2 * pad, h * 0.042, 'normal'); x.fillText(foot, w / 2, h - pad * 0.7);
  return c;
}
$('qGo').onclick = async () => {
  const rooms = qrRooms();
  if (!rooms.length) { toast('No rooms selected'); return; }
  const btn = $('qGo'); btn.disabled = true; btn.textContent = 'Building…';
  await new Promise(r => setTimeout(r, 30));
  try {
    publishRooms(rooms.map(r => r.code)); // room pages save in the background (also with no signal); labels don't wait for it
    if ($('qFormat').value === 'avery') {
      const a = { top: Number($('qTop').value), left: Number($('qLeft').value), px: Number($('qPx').value), py: Number($('qPy').value) };
      store('pcg_avery', JSON.stringify(a));
      let slot = Math.min(12, Math.max(1, Number($('qStart').value) || 1)) - 1, html = '', page = '';
      rooms.forEach(r => {
        page += `<div class="lbl" style="left:${a.left + (slot % 3) * a.px}in;top:${a.top + Math.floor(slot / 3) * a.py}in"><img src="${labelCanvas(r, 600, 600).toDataURL('image/png')}"></div>`;
        if (++slot === 12) { html += `<div class="lbl-page">${page}</div>`; page = ''; slot = 0; }
      });
      if (page) html += `<div class="lbl-page">${page}</div>`;
      $('pageStyle').textContent = '@media print{@page{size:letter portrait;margin:0}}';
      $('printArea').innerHTML = html;
      $('qrModal').classList.add('hidden');
      setTimeout(() => window.print(), 250);
    } else {
      S.labelImgs = rooms.map(r => ({ r, url: labelCanvas(r, 384, 448).toDataURL('image/png') }));
      $('qOut').innerHTML = '<div class="meta">Tap a label to open it, then save it (long-press on a phone or iPad) and print it from your label printer\'s app.</div><div class="lblgrid">' +
        S.labelImgs.map((l, i) => `<figure><a href="${l.url}" download="Room_${esc(l.r.room).replace(/\s+/g, '_')}.png" data-i="${i}"><img src="${l.url}" alt=""></a>${esc(l.r.room)}</figure>`).join('') + '</div>';
      $('qStrip').classList.remove('hidden');
    }
  } catch (err) { toast('Error: ' + (err.message || err), 6000); }
  finally { btn.disabled = false; btn.textContent = 'Build labels'; }
};
addEventListener('afterprint', () => { $('printArea').innerHTML = ''; });
$('qOut').addEventListener('click', e => {
  const a = e.target.closest('a[data-i]'); if (!a || !IOS) return;
  e.preventDefault(); $('lightbox').querySelector('img').src = a.getAttribute('href'); $('lightbox').classList.remove('hidden');
});
// One tall image per 30 labels with cut lines — label-printer apps can print it in one go.
$('qStrip').onclick = async () => {
  const L = S.labelImgs || [], per = 30, gap = 24;
  for (let k = 0; k < L.length; k += per) {
    const part = L.slice(k, k + per), c = document.createElement('canvas');
    c.width = 384; c.height = part.length * (448 + gap);
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < part.length; i++) {
      const im = await new Promise(res => { const m = new Image(); m.onload = () => res(m); m.src = part[i].url; });
      x.drawImage(im, 0, i * (448 + gap));
      x.setLineDash([8, 8]); x.beginPath(); x.moveTo(0, i * (448 + gap) + 448 + gap / 2); x.lineTo(384, i * (448 + gap) + 448 + gap / 2); x.stroke();
    }
    const url = c.toDataURL('image/png');
    if (IOS) { $('lightbox').querySelector('img').src = url; $('lightbox').classList.remove('hidden'); }
    else { const a = document.createElement('a'); a.href = url; a.download = `QR_labels_${k + 1}-${k + part.length}.png`; document.body.appendChild(a); a.click(); a.remove(); }
  }
};

// =====================================================================
// Email, Print / PDF, Fieldwire (step 5)
// =====================================================================
const COLORS = { 'Open': '#d93025', 'In Progress': '#f29900', 'Ready for Review': '#1a73e8', 'Closed': '#188038' };
const TRADE_TAGS = {
  'General / Carpentry': '06_wood_and_plastics', 'Drywall': '09_finishes', 'Paint': '09_finishes', 'Flooring': '09_finishes',
  'Tile': '09_finishes', 'Doors & Hardware': '08_openings', 'Millwork / Casework': '06_wood_and_plastics', 'Plumbing': '22_plumbing',
  'HVAC / PTAC': '23_mechanical', 'Electrical': '26_electrical', 'Low Voltage / Data': '27_communications',
  'Fire Sprinkler': '21-00_fire_suppression', 'Fire Alarm': '28_safety_&_security', 'Windows / Storefront': '08_openings',
  'Roofing': '07_thermal_moisture', 'Exterior / Siding': '07_thermal_moisture', 'Concrete': '03_concrete',
  'Sitework': '32_exterior_improvement', 'Signage': '10_specialties', 'FF&E': '12_furnishings', 'Elevator': '14_conveying_systems',
  'Cleaning': '01_general_conditions'
};

// "Items" picker shared by the three windows
function fillScope(sel) {
  const cur = filtered();
  const trades = TRADES.filter(t => S.items.some(i => i.trade === t && i.status !== 'Closed'));
  sel.innerHTML = `<option value="filter">Current list / filters (${cur.length})</option>
    <option value="allopen">All open items, all floors</option><option value="all">Everything, including closed</option>` +
    trades.map(t => `<option value="trade:${esc(t)}">${esc(t)} – open items</option>`).join('');
}
function scopeItems(v) {
  const items = v === 'filter' ? filtered() : v === 'allopen' ? S.items.filter(i => i.status !== 'Closed')
    : v === 'all' ? S.items.slice() : S.items.filter(i => i.trade === v.slice(6) && i.status !== 'Closed');
  return items.slice().sort((a, b) => a.floor - b.floor || (a.number || 1e9) - (b.number || 1e9));
}
const scopeLabel = v => v.startsWith('trade:') ? ' – ' + v.slice(6) : '';

// Plan image with numbered dots, as a JPEG — for email. Needs the Storage CORS setting (see README); returns null without it.
async function planSnapshot(floor, items) {
  const f = S.floors.find(x => x.n === floor); if (!f || !f.planUrl) return null;
  try {
    const blob = await (await fetch(f.planUrl, { mode: 'cors' })).blob();
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(blob); });
    const k = Math.min(1, 2400 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    const x = c.getContext('2d'); x.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.src);
    const r = Math.max(12, Math.round(c.width / 140));
    items.forEach(i => {
      const px = i.x * c.width, py = i.y * c.height, t = String(i.number == null ? '…' : i.number);
      x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fillStyle = COLORS[i.status] || COLORS.Open; x.fill();
      x.lineWidth = Math.max(2, r / 5); x.strokeStyle = '#fff'; x.stroke();
      x.fillStyle = '#fff'; x.font = `bold ${Math.round(r * (t.length > 2 ? 0.9 : 1.1))}px Arial`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(t, px, py + 1);
    });
    return c.toDataURL('image/jpeg', 0.85).split(',')[1];
  } catch (e) { return null; }
}

// ---- Email
const tradeEmail = t => { try { return JSON.parse(store('pcg_tradeEmails') || '{}')[S.pid + '|' + t] || ''; } catch (e) { return ''; } };
function rememberTradeEmail(t, to) {
  try { const m = JSON.parse(store('pcg_tradeEmails') || '{}'); m[S.pid + '|' + t] = to; store('pcg_tradeEmails', JSON.stringify(m)); } catch (e) {}
}
function mailScopeChanged() {
  const v = $('mScope').value, items = scopeItems(v);
  $('mSubject').value = (project().name || '') + ' – Punch List' + scopeLabel(v);
  if (v.startsWith('trade:') && tradeEmail(v.slice(6))) $('mTo').value = tradeEmail(v.slice(6));
  $('mCount').textContent = `${items.length} item(s) on ${new Set(items.map(i => i.floor)).size} floor(s)`;
}
$('mailBtn').onclick = () => {
  if (!(window.PCG_CONFIG || {}).MAILER_URL) { toast('Email is not connected yet — the mailer link goes in config.js (see README, step 5).', 8000); return; }
  fillScope($('mScope')); $('mTo').value = ''; $('mNote').value = ''; mailScopeChanged();
  $('mailModal').classList.remove('hidden');
};
$('mScope').onchange = mailScopeChanged;
$('mSend').onclick = async () => {
  const v = $('mScope').value, items = scopeItems(v), to = $('mTo').value.trim();
  if (!items.length) { toast('No items to send'); return; }
  if (!to) { toast('Enter an email address'); return; }
  const btn = $('mSend'); btn.disabled = true; btn.textContent = 'Preparing…';
  try {
    const plans = [];
    let noPlans = false;
    if ($('mPlans').checked) for (const fl of [...new Set(items.map(i => i.floor))].sort((a, b) => a - b)) {
      const data = await planSnapshot(fl, items.filter(i => i.floor === fl));
      if (data) plans.push({ floor: fl, label: floorLabel(fl), data }); else noPlans = true;
    }
    btn.textContent = 'Sending…';
    const body = {
      idToken: await S.user.getIdToken(), to, subject: $('mSubject').value, note: $('mNote').value,
      projectName: project().name || '', includePhotos: $('mPhotos').checked, plans,
      items: items.map(i => ({ number: i.number, floor: i.floor, floorLabel: floorLabel(i.floor), room: i.room, trade: i.trade,
        description: i.description, notes: i.notes, assignedTo: i.assignedTo, priority: i.priority, dueDate: i.dueDate, status: i.status,
        photos: (i.photos || []).map(p => p.thumbUrl || p.url) }))
    };
    const resp = await fetch(window.PCG_CONFIG.MAILER_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    const out = await resp.json().catch(() => ({ ok: false, error: 'The mailer sent an unexpected reply — check its deployment.' }));
    if (!out.ok) throw new Error(out.error);
    if (v.startsWith('trade:')) rememberTradeEmail(v.slice(6), to);
    $('mailModal').classList.add('hidden');
    const r = out.result || {}, notes = [];
    const inApp = body.items.reduce((n, i) => n + i.photos.length, 0);
    const waiting = items.reduce((n, i) => n + (S.queued[i.id] || []).length, 0);
    if (body.includePhotos) notes.push(`${r.photos != null ? r.photos : '?'} of ${inApp} photo(s)` + (r.mailer ? '' : ' (old mailer — redeploy it)'));
    if (waiting) notes.push(`${waiting} photo(s) not uploaded yet, left out`);
    if (noPlans) notes.push('plans left out (see README: plan images in email)');
    toast(`Sent ${r.sent} item(s)` + (notes.length ? ' — ' + notes.join(' · ') : ''), 10000);
  } catch (e) { toast('Not sent: ' + (navigator.onLine === false ? 'no signal' : e.message), 8000); }
  finally { btn.disabled = false; btn.textContent = 'Send'; }
};

// ---- Print / PDF (works without any setup: plans are shown as images with numbered dots on top)
function prScopeChanged() {
  const v = $('prScope').value, items = scopeItems(v);
  $('prTitle').value = (project().name || '') + ' – Punch List' + scopeLabel(v);
  $('prCount').textContent = `${items.length} item(s), ${items.reduce((n, i) => n + (i.photos || []).length, 0)} photo(s)`;
}
$('printBtn').onclick = () => { fillScope($('prScope')); prScopeChanged(); $('printModal').classList.remove('hidden'); };
$('prScope').onchange = prScopeChanged;
$('prGo').onclick = async () => {
  const items = scopeItems($('prScope').value);
  if (!items.length) { toast('No items to print'); return; }
  const btn = $('prGo'); btn.disabled = true; btn.textContent = 'Preparing…';
  try {
    const withPlans = $('prPlans').checked, withPhotos = $('prPhotos').checked, now = new Date();
    const statuses = ['Open', 'In Progress', 'Ready for Review', 'Closed'];
    const floors = [...new Set(items.map(i => i.floor))].sort((a, b) => a - b);
    const dot = s => `<span class="pr-dot" style="background:${COLORS[s] || COLORS.Open}"></span>`;
    let html = `<div class="pr-head"><h1>${esc($('prTitle').value)}</h1><div>${now.toLocaleDateString()} · ${items.length} item(s) · prepared by ${esc(S.me.name || '')} · Perimeter Construction Group</div></div>`;
    html += '<table class="pr-sum"><tr><th>Floor</th>' + statuses.map(s => `<th>${dot(s)}${s}</th>`).join('') + '<th>Total</th></tr>' +
      floors.map(f => { const fi = items.filter(i => i.floor === f); return `<tr><td>${esc(floorLabel(f))}</td>` + statuses.map(s => `<td>${fi.filter(i => i.status === s).length || ''}</td>`).join('') + `<td><b>${fi.length}</b></td></tr>`; }).join('') +
      `<tr><td><b>Total</b></td>` + statuses.map(s => `<td><b>${items.filter(i => i.status === s).length || ''}</b></td>`).join('') + `<td><b>${items.length}</b></td></tr></table>`;
    floors.forEach(f => {
      const fi = items.filter(i => i.floor === f), fl = S.floors.find(x => x.n === f) || {};
      html += `<div class="pr-floor"><h2>${esc(floorLabel(f))} — ${fi.length} item(s)</h2>`;
      const plan = withPlans && fl.planUrl;
      if (plan) html += `<div class="pr-planbox"><img src="${esc(fl.planUrl)}" alt="">` + fi.map(i =>
        `<div class="pr-pin" style="left:${i.x * 100}%;top:${i.y * 100}%;background:${COLORS[i.status] || COLORS.Open}">${esc(i.number == null ? '…' : i.number)}</div>`).join('') + '</div>';
      html += `<table class="pr-tbl${plan ? ' brk' : ''}"><tr><th>#</th><th>Room</th><th>Trade</th><th>Description</th><th>Assigned</th><th>Priority</th><th>Due</th><th>Status</th>${withPhotos ? '<th>Photos</th>' : ''}</tr>` +
        fi.map(i => `<tr><td><b>${esc(i.number == null ? '…' : i.number)}</b></td><td>${esc(i.room)}</td><td>${esc(i.trade)}</td>
          <td>${esc(i.description)}${i.notes ? '<br><i>' + esc(i.notes) + '</i>' : ''}</td><td>${esc(i.assignedTo)}</td><td>${esc(i.priority)}</td><td>${esc(i.dueDate)}</td>
          <td>${dot(i.status)}${esc(i.status)}</td>${withPhotos ? '<td>' + (i.photos || []).map(p => `<img class="pr-ph" src="${esc(p.thumbUrl || p.url)}" alt="">`).join('') + '</td>' : ''}</tr>`).join('') + '</table></div>';
    });
    html += `<div class="pr-foot">Generated ${now.toLocaleString()} · PCG Punch ${VERSION}</div>`;
    const area = $('printArea'); area.className = 'report'; area.innerHTML = html;
    btn.textContent = 'Loading images…';
    await Promise.all([...area.querySelectorAll('img')].map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; setTimeout(r, 20000); })));
    $('printModal').classList.add('hidden');
    $('pageStyle').textContent = '@media print{@page{size:letter landscape;margin:.4in}}';
    setTimeout(() => window.print(), 150);
  } catch (e) { toast('Error: ' + e.message, 6000); }
  finally { btn.disabled = false; btn.textContent = 'Build & print'; }
};
addEventListener('afterprint', () => { $('printArea').className = ''; });

// ---- Fieldwire (paste into Tasks → + Import Tasks → Task importer)
const FW_STATUS = { 'Open': 'Sent', 'In Progress': 'Sent', 'Ready for Review': 'Completed', 'Closed': 'Verified' };
function fwItems() {
  let items = scopeItems($('fwScope').value);
  if ($('fwSkip').checked) items = items.filter(i => !i.fieldwireAt);
  return items;
}
function fwCount() { const n = fwItems().length; $('fwCount').textContent = n + ' item(s) will be exported' + (n > 500 ? ' — Fieldwire takes 500 per import' : ''); }
$('fwBtn').onclick = () => {
  fillScope($('fwScope')); $('fwScope').value = 'allopen';
  const st = settings(); $('fwCat').value = st.fwCategory || 'Job site task'; $('fwTag').value = st.fwTag == null ? 'punch' : st.fwTag;
  $('fwResult').classList.add('hidden'); $('fwCopy').classList.add('hidden');
  fwCount(); $('fwModal').classList.remove('hidden');
};
['fwScope', 'fwSkip'].forEach(id => $(id).addEventListener('change', fwCount));
$('fwBuild').onclick = () => {
  const items = fwItems();
  if (!items.length) { toast('Nothing to export'); return; }
  if (items.length > 500) { toast('Fieldwire imports up to 500 at a time — narrow the list (by trade or floor).', 7000); return; }
  const cat = $('fwCat').value.trim() || 'Job site task', tag = $('fwTag').value.trim();
  const clean = s => String(s == null ? '' : s).replace(/[\t\r\n]+/g, ' ').trim();
  const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
  const day = t => { if (!t) return ''; const d = t.toDate ? t.toDate() : new Date(t); return isNaN(d) ? '' : d.toISOString().slice(0, 10); };
  const noPlan = new Set();
  const rows = items.map(i => {
    const fl = S.floors.find(x => x.n === i.floor) || {}, plan = fl.fwPlan || '';
    if (!plan) noPlan.add(fl.label || 'Level ' + i.floor);
    let title = clean(`PL-${i.number == null ? '?' : i.number} ${i.room ? i.room + ' - ' : ''}${i.trade ? i.trade + ': ' : ''}${i.description}`);
    if (title.length > 120) title = title.slice(0, 117) + '...';
    const desc = [clean(i.description)];
    if (i.notes) desc.push('Notes: ' + clean(i.notes));
    if (i.assignedTo && !isEmail(i.assignedTo)) desc.push('Assigned to: ' + clean(i.assignedTo));
    desc.push('Priority: ' + (i.priority || 'Medium'));
    if ((i.photos || []).length) desc.push('Photos: ' + i.photos.map(p => p.url).join(' '));
    desc.push(`Punch #${i.number == null ? '?' : i.number} (${floorLabel(i.floor)})`);
    const tags = [tag, TRADE_TAGS[i.trade], 'level_' + i.floor].filter(Boolean).map(t => '#' + t);
    return [title, FW_STATUS[i.status] || 'Sent', cat, isEmail(i.assignedTo) ? i.assignedTo.trim() : '', day(i.createdAt), i.dueDate || '',
      plan, plan ? Math.round(i.x * 1000) / 10 : '', plan ? Math.round(i.y * 1000) / 10 : '', '', '', '', '', '', '', '',
      desc.join(' | ') + ' ' + tags.join(', '), '', '', '', '', ''].map(String);
  });
  $('fwText').value = rows.map(r => r.join('\t')).join('\n');
  $('fwWarn').textContent = noPlan.size ? `No Fieldwire plan name for ${[...noPlan].join(', ')} (Plans window) — those import without pins.` : '';
  $('fwResult').classList.remove('hidden'); $('fwCopy').classList.remove('hidden');
  $('fwCount').textContent = rows.length + ' row(s) ready';
  if ($('fwMark').checked) items.forEach(i => F.updateDoc(F.doc(db, 'projects', S.pid, 'items', i.id), { fieldwireAt: F.serverTimestamp() }).catch(() => {}));
  if (S.me.role === 'Admin' && (cat !== (settings().fwCategory || 'Job site task') || tag !== (settings().fwTag == null ? 'punch' : settings().fwTag)))
    F.updateDoc(F.doc(db, 'projects', S.pid), { settings: Object.assign(settings(), { fwCategory: cat, fwTag: tag }) }).catch(() => {});
};
$('fwCopy').onclick = async () => {
  const ta = $('fwText');
  try { await navigator.clipboard.writeText(ta.value); toast('Copied — paste into the Fieldwire Task importer'); return; } catch (e) {}
  ta.focus(); ta.select();
  try { document.execCommand('copy'); toast('Copied — paste into the Fieldwire Task importer'); } catch (e) { toast('Select the text box and copy it'); }
};
