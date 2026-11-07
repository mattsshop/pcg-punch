// PCG Punch — app (step 2: sign-in, access, projects, floor plans)
import * as F from './fb.js';

const VERSION = 'v0.2.0';
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
  stop('floors');
  S.pid = pid; S.floor = null;
  if (!pid) { noProjects(); return; }
  store('pcg_pid', pid);
  renderProjects();
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
  $('floorTabs').innerHTML = S.floors.map(f =>
    `<button data-f="${f.n}" class="${f.n === S.floor ? 'sel' : ''}">${esc(String(f.label || 'Level ' + f.n).replace(/^Level\s*/i, 'L'))}</button>`).join('');
}
$('floorTabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) loadFloor(Number(b.dataset.f)); });

function loadFloor(n) {
  S.floor = n; renderTabs();
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
    fit();
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
  if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, tx: S.v.tx, ty: S.v.ty };
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
  } else if (drag) { S.v.tx = drag.tx + e.clientX - drag.x; S.v.ty = drag.ty + e.clientY - drag.y; apply(); }
});
const endPtr = e => {
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2) pinch = null;
  if (ptrs.size === 1) { const p = [...ptrs.values()][0]; drag = { x: p.x, y: p.y, tx: S.v.tx, ty: S.v.ty }; }
  if (!ptrs.size) drag = null;
};
viewer.addEventListener('pointerup', endPtr);
viewer.addEventListener('pointercancel', endPtr);

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
