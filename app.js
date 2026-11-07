// PCG Punch — app (sign-in, access, projects, floor plans, tags/items)
import * as F from './fb.js';

const VERSION = 'v0.3.0';
const OWNER = 'matt@mattsshop.com'; // must match firebase/firestore.rules and storage.rules
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const PLAN_MAX_PX = 4200; // long side of the image made from a PDF plan

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
const db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
const storage = F.getStorage(app);

const ver = VERSION;
['verSignin'].forEach(id => $(id).textContent = 'PCG Punch ' + ver);
$('ver').textContent = ver;

function stop(key) { if (S.unsub[key]) { S.unsub[key](); delete S.unsub[key]; } }
function stopAll() { Object.keys(S.unsub).forEach(stop); }
function show(id) {
  ['scrSignin', 'scrVerify', 'scrRequest', 'scrWait', 'scrApp'].forEach(s => $(s).classList.toggle('hidden', s !== id));
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
  if (!u) { show('scrSignin'); return; }
  const pw = u.providerData.some(p => p.providerId === 'password');
  if (pw && !u.emailVerified) { $('vEmail').textContent = u.email; show('scrVerify'); return; }
  S.isOwner = String(u.email || '').toLowerCase() === OWNER && u.emailVerified;
  const meRef = F.doc(db, 'users', u.uid);
  S.unsub.me = F.onSnapshot(meRef, async snap => {
    const d = snap.exists() ? snap.data() : null;
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
  fillTrades(); processPhotoQueue(); loadQueuedThumbs(); updateNet();
  F.updateDoc(F.doc(db, 'users', S.user.uid), { lastSeen: F.serverTimestamp() }).catch(() => {});
  S.unsub.projects = F.onSnapshot(F.query(F.collection(db, 'projects'), F.orderBy('name')), snap => {
    S.projects = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
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

function noProjects() {
  S.pid = null; S.floors = []; renderTabs();
  $('plan').style.display = 'none';
  $('planMsg').classList.remove('hidden');
  $('planMsg').innerHTML = S.me.role === 'Admin'
    ? '<div>No projects yet.</div><button class="primary" id="firstProj">Create your first project</button>'
    : '<div>No projects yet. Check back once the project manager sets one up.</div>';
  const b = $('firstProj'); if (b) b.onclick = openProjects;
}

function selectProject(pid) {
  stop('floors'); stop('items'); S.items = []; closeModal(true);
  S.pid = pid; S.floor = null;
  if (!pid) { noProjects(); return; }
  store('pcg_pid', pid);
  renderProjects();
  watchItems(pid);
  S.unsub.floors = F.onSnapshot(F.query(F.collection(db, 'projects', pid, 'floors'), F.orderBy('n')), snap => {
    S.floors = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    const keep = S.floors.find(f => f.n === S.floor) ? S.floor : (S.floors.find(f => f.n === Number(store('pcg_floor_' + pid))) || S.floors[0] || {}).n;
    const cur = S.floors.find(f => f.n === S.floor);
    renderTabs();
    if (keep !== S.floor || (cur && cur.planUrl !== S.shownUrl)) loadFloor(keep);
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
  img.onload = () => {
    if (S.floor !== n) return;
    msg.classList.add('hidden'); img.style.display = 'block'; S.shownUrl = f.planUrl;
    $('stage').style.width = img.naturalWidth + 'px'; $('stage').style.height = img.naturalHeight + 'px';
    fit(); renderPins();
    if (S.pendingFocus) { focusItem(S.pendingFocus); S.pendingFocus = null; }
  };
  img.onerror = () => { if (S.floor === n) msg.textContent = 'Could not load the plan — check your connection.'; };
  img.src = f.planUrl;
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
      }).catch(() => {}).finally(() => S.numbering.delete(i.id));
    });
}

function renderAll() { renderTabs(); renderList(); renderPins(); updateSync(); }

function filtered(ignoreFloor) {
  const q = $('fSearch').value.trim().toLowerCase(), st = $('fStatus').value, tr = $('fTrade').value;
  const thisFloor = $('fFloor').checked && !ignoreFloor, mine = $('fMine').checked && S.me;
  const myName = S.me ? String(S.me.name || '').toLowerCase() : '';
  return (S.items || []).filter(i => {
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
  const rooms = [...new Set(S.items.map(i => i.room).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  $('roomList').innerHTML = rooms.map(r => `<option value="${esc(r)}">`).join('');
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
  fillForm({ room: store('pcg_room') || '', trade: store('pcg_trade') || '', description: '', assignedTo: '', priority: 'Medium', dueDate: '', status: 'Open', notes: '', photos: [] });
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
  S.keptPhotos = (it.photos || []).slice(); S.pendingPhotos = [];
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
    status, notes: $('iNotes').value.trim(), photos: S.keptPhotos,
    updatedAt: F.serverTimestamp(), updatedBy: meStamp()
  };
  const before = isNew ? null : S.items.find(i => i.id === ed.id);
  if (status === 'Closed' && (!before || before.status !== 'Closed')) data.closedAt = F.serverTimestamp();
  if (status !== 'Closed') data.closedAt = null;
  if (isNew) Object.assign(data, { number: null, createdAt: F.serverTimestamp(), createdBy: meStamp() });
  store('pcg_room', data.room); store('pcg_trade', data.trade);
  (isNew ? F.setDoc(ref, data) : F.updateDoc(ref, data)).catch(err => toast('Not saved: ' + friendly(err), 8000));
  // photos removed in this edit
  if (before) (before.photos || []).filter(p => !S.keptPhotos.some(k => k.path === p.path))
    .forEach(p => { [p.path, p.thumbPath].filter(Boolean).forEach(x => F.deleteObject(F.ref(storage, x)).catch(() => {})); });
  // new photos go into a queue on this device and upload when there is signal
  const newOnes = S.pendingPhotos.slice();
  closeModal();
  toast(isNew ? 'Tag added' : 'Saved');
  if (newOnes.length) {
    for (const p of newOnes) await PQ.add({ pid: S.pid, itemId: ref.id, full: p.full, thumb: p.thumb, at: Date.now() });
    await loadQueuedThumbs(); renderList(); processPhotoQueue();
  }
};
$('iDelete').onclick = async () => {
  const ed = S.editing;
  if (!confirm(`Delete #${numText(ed)}? This can't be undone.`)) return;
  const it = S.items.find(i => i.id === ed.id) || ed;
  F.deleteDoc(F.doc(db, 'projects', S.pid, 'items', ed.id)).catch(err => toast(friendly(err), 6000));
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
let pqBusy = false;
async function processPhotoQueue() {
  if (pqBusy || navigator.onLine === false || !S.me || !canEdit()) return;
  pqBusy = true;
  try {
    for (const e of await PQ.all()) {
      const base = `projects/${e.pid}/photos/${e.itemId}-${e.at}-${e.k}`;
      try {
        await F.uploadBytes(F.ref(storage, base + '.jpg'), e.full, { contentType: 'image/jpeg' });
        await F.uploadBytes(F.ref(storage, base + '-thumb.jpg'), e.thumb, { contentType: 'image/jpeg' });
        const [url, thumbUrl] = await Promise.all([F.getDownloadURL(F.ref(storage, base + '.jpg')), F.getDownloadURL(F.ref(storage, base + '-thumb.jpg'))]);
        await F.updateDoc(F.doc(db, 'projects', e.pid, 'items', e.itemId),
          { photos: F.arrayUnion({ path: base + '.jpg', url, thumbPath: base + '-thumb.jpg', thumbUrl }) });
        await PQ.del(e.k);
      } catch (err) {
        if (/not-found/.test(err.code || '')) { await PQ.del(e.k); continue; } // item was deleted
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
  $('syncState').textContent = [saving ? `${saving} change(s) to sync` : '', photos ? `${photos} photo(s) to upload` : ''].filter(Boolean).join(' · ');
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
