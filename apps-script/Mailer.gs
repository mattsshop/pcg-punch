/**
 * PCG Punch — email sender (v0.7.0)
 *
 * The PCG Punch app (GitHub Pages + Firebase) asks this script to send punch-list emails,
 * because Firebase can't send email itself. It only sends for people who are signed in to
 * PCG Punch and approved as Crew or Admin.
 *
 * SETUP (one time, at script.google.com, signed in with the Google account the emails should come from):
 *   1. New project → name it "PCG Punch Mailer" → paste this whole file over Code.gs → Save.
 *   2. Deploy → New deployment → gear → Web app.
 *      Execute as: Me.  Who has access: Anyone.  → Deploy → Authorize access → Allow.
 *   3. Copy the Web app URL (ends in /exec) into config.js in the pcg-punch repo (MAILER_URL).
 * UPDATING: paste the new version, Save, then Deploy → Manage deployments → ✏️ → Version: New version → Deploy
 * (keeps the same /exec link).
 */

// ---- Settings ----
const FIREBASE_API_KEY = 'AIzaSyDHpwkWGCCgBz7_VZt0qo84mkaQdO9B2Wo'; // from config.js (not secret)
const FIREBASE_PROJECT = 'pcg-punch';
const OWNER_EMAIL = 'matt@mattsshop.com';     // always allowed to send
const FROM_ALIAS = '';                          // optional: an address set up in Gmail > Settings > Accounts > "Send mail as"
const DISPLAY_NAME = 'PCG Punch';               // emails show as "<Sender> via PCG Punch"
const CC_SENDER = true;                         // send the person who emailed a copy
const MAX_PHOTOS = 150;
const COMPANY = 'Perimeter Construction Group';

function doGet() {
  let from = Session.getEffectiveUser().getEmail(), note = '';
  if (FROM_ALIAS) {
    let aliases = [];
    try { aliases = GmailApp.getAliases(); } catch (e) { note = ' (could not read Gmail aliases: ' + e.message + ')'; }
    if (aliases.some(a => a.toLowerCase() === FROM_ALIAS.toLowerCase())) from = FROM_ALIAS;
    else if (!note) note = ' (' + FROM_ALIAS + ' is not a "Send mail as" address in this Gmail account. Found: ' + (aliases.join(', ') || 'none') + ')';
  }
  return ContentService.createTextOutput('PCG Punch mailer v0.7.0 is running. Sends from: ' + from + note +
    '. Daily emails left: ' + MailApp.getRemainingDailyQuota());
}

/** Body (text/plain JSON): { idToken, to, subject, note, projectName, items: [...], plans: [{floor, label, data}], includePhotos } */
function doPost(e) {
  let out;
  try {
    const p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    out = { ok: true, result: p.action === 'plan' ? plan_(p) : p.action === 'signoff' ? signoff_(p) : send_(p) };
  }
  catch (err) { out = { ok: false, error: String((err && err.message) || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** Checks the Firebase sign-in token with Google, then reads the person's role from Firestore (using their own access). */
function sender_(idToken) {
  if (!idToken) throw new Error('Please sign in again.');
  const r = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: idToken }), muteHttpExceptions: true
  });
  const u = r.getResponseCode() === 200 ? (JSON.parse(r.getContentText()).users || [])[0] : null;
  if (!u) throw new Error('Your sign-in has expired — reload the app and try again.');
  const d = UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT +
    '/databases/(default)/documents/users/' + encodeURIComponent(u.localId), {
    headers: { Authorization: 'Bearer ' + idToken }, muteHttpExceptions: true
  });
  const f = d.getResponseCode() === 200 ? (JSON.parse(d.getContentText()).fields || {}) : {};
  const val = k => (f[k] && f[k].stringValue) || '';
  const owner = String(u.email || '').toLowerCase() === OWNER_EMAIL && u.emailVerified;
  if (!owner && (val('status') !== 'Approved' || ['Crew', 'Admin'].indexOf(val('role')) < 0)) {
    throw new Error('Your account is not allowed to send email.');
  }
  return { name: val('name') || u.displayName || u.email, company: val('company'), email: u.email };
}

const isEmail_ = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
const esc_ = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Only fetch photos from this project's Firebase Storage
const PHOTO_HOST = 'https://firebasestorage.googleapis.com/v0/b/';
const isPhotoUrl_ = u => { u = String(u || ''); return u.indexOf(PHOTO_HOST) === 0 && u.slice(PHOTO_HOST.length).split('/')[0].indexOf(FIREBASE_PROJECT) === 0; };

/** Hands a plan image from this project's Storage to the app, so it can draw the numbered dots for the email
 *  (the browser itself isn't allowed to read Storage images unless the bucket has a CORS setting). */
function plan_(p) {
  sender_(p.idToken);
  if (!isPhotoUrl_(p.url)) throw new Error('Not a PCG Punch plan.');
  const r = UrlFetchApp.fetch(p.url, { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('Plan image could not be read (' + r.getResponseCode() + ').');
  const b = r.getBlob();
  if (b.getBytes().length > 20 * 1024 * 1024) throw new Error('Plan image is too large.');
  return { type: b.getContentType() || 'image/jpeg', data: Utilities.base64Encode(b.getBytes()) };
}

/** Sends one email as "<name> (<company>) via PCG Punch", replies to the sender, sender gets a copy. Returns the alias used. */
function deliver_(me, to, subject, html, inline) {
  const opts = { name: me.name + (me.company ? ' (' + me.company + ')' : '') + ' via ' + DISPLAY_NAME, htmlBody: html, inlineImages: inline };
  if (isEmail_(me.email)) opts.replyTo = me.email;
  if (CC_SENDER && isEmail_(me.email) && to.map(t => t.toLowerCase()).indexOf(me.email.toLowerCase()) < 0) opts.cc = me.email;
  let alias = '';
  if (FROM_ALIAS) { try { if (GmailApp.getAliases().some(a => a.toLowerCase() === FROM_ALIAS.toLowerCase())) alias = FROM_ALIAS; } catch (e) {} }
  if (alias) GmailApp.sendEmail(to.join(','), subject, 'This message needs an email app that shows HTML.', Object.assign({ from: alias }, opts));
  else MailApp.sendEmail(Object.assign({ to: to.join(','), subject: subject }, opts));
  return alias;
}

/** Owner room sign-off: emails the signed record (with the signature) to the signer, copy to the witness. */
function signoff_(p) {
  const me = sender_(p.idToken), r = p.record || {};
  const to = String(p.to || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
  if (!to.length || to.some(t => !isEmail_(t))) throw new Error('No valid email address for the signer.');
  if (to.length > 5) throw new Error('Too many addresses.');
  const inline = {};
  const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(String(r.sig || ''));
  if (m) inline.sig = Utilities.newBlob(Utilities.base64Decode(m[2]), 'image/' + m[1], 'signature.' + m[1]);
  const td = 'style="border:1px solid #ddd;padding:5px 7px;font-size:13px;vertical-align:top"';
  const color = { 'Accepted': '#188038', 'Accepted with exceptions': '#b06000', 'Rejected': '#d93025' }[r.result] || '#202124';
  let html = '<div style="font-family:Arial,sans-serif;color:#202124;max-width:700px">' +
    '<h2 style="margin:0 0 4px">Room ' + esc_(r.room) + (r.roomName ? ' · ' + esc_(r.roomName) : '') + ' — sign-off</h2>' +
    '<div style="color:#5f6368">' + esc_(r.projectName) + ' · ' + esc_(r.floorLabel) + '</div>' +
    '<p style="font-size:18px;font-weight:bold;color:' + color + ';margin:14px 0 6px">' + esc_(r.result) + '</p>' +
    '<p style="border-left:3px solid #1a73e8;padding:6px 10px;background:#f1f5fe">' + esc_(r.statement) + '</p>';
  const items = (r.items || []).slice(0, 300), exc = (r.exceptions || []).slice(0, 100);
  if (exc.length) html += '<h3 style="margin:14px 0 4px">Exceptions</h3><ul>' + exc.map(e => '<li>' + esc_(e) + '</li>').join('') + '</ul>';
  if (items.length) html += '<h3 style="margin:14px 0 4px">Punch items in the room at signing</h3><table style="border-collapse:collapse;width:100%">' +
    '<tr><th ' + td + '>#</th><th ' + td + '>Description</th><th ' + td + '>Trade</th><th ' + td + '>Status</th></tr>' +
    items.map(i => '<tr><td ' + td + '><b>' + esc_(i.number) + '</b></td><td ' + td + '>' + esc_(i.description) + '</td><td ' + td + '>' + esc_(i.trade) + '</td><td ' + td + '>' + esc_(i.status) + '</td></tr>').join('') + '</table>';
  if (r.note) html += '<h3 style="margin:14px 0 4px">Comments</h3><p>' + esc_(r.note) + '</p>';
  html += '<h3 style="margin:16px 0 4px">Signature</h3>' + (inline.sig ? '<img src="cid:sig" style="max-width:360px;border-bottom:1px solid #999">' : '') +
    '<p style="margin:6px 0">' + esc_(r.signerName) + (r.signerTitle ? ', ' + esc_(r.signerTitle) : '') + (r.signerCompany ? ' — ' + esc_(r.signerCompany) : '') + '<br>' +
    'Signed ' + esc_(r.when) + ' on ' + esc_(me.name) + "'s device, witnessed by " + esc_(me.name) + (me.company ? ' (' + esc_(me.company) + ')' : '') + '</p>' +
    '<p style="color:#5f6368;font-size:12px">Record ' + esc_(r.id) + ' · PCG Punch. This email is your copy of the electronic sign-off. If anything here is wrong, reply to this email.</p></div>';
  const subject = ('Room ' + r.room + ' sign-off – ' + r.result + ' – ' + r.projectName).slice(0, 200);
  deliver_(me, to, subject, html, inline);
  return { sent: 1, mailer: 'v0.7.0' };
}

function send_(p) {
  const me = sender_(p.idToken);
  const to = String(p.to || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
  if (!to.length) throw new Error('Enter at least one email address.');
  const bad = to.filter(t => !isEmail_(t));
  if (bad.length) throw new Error('Not an email address: ' + bad.join(', '));
  if (to.length > 20) throw new Error('Send to 20 people or fewer at a time.');
  const items = (p.items || []).slice(0, 1000);
  if (!items.length) throw new Error('No items to send.');
  if (MailApp.getRemainingDailyQuota() < to.length) throw new Error('Daily email limit reached — try again tomorrow.');

  const inline = {};
  (p.plans || []).slice(0, 10).forEach(pl => {
    if (pl && pl.data) inline['plan' + pl.floor] = Utilities.newBlob(Utilities.base64Decode(pl.data), 'image/jpeg', 'plan-' + pl.floor + '.jpg');
  });

  const td = 'style="border:1px solid #ccc;padding:6px;vertical-align:top;font-size:13px"';
  const th = 'style="border:1px solid #ccc;padding:6px;background:#f1f3f4;text-align:left;font-size:13px"';
  let html = '<div style="font-family:Arial,sans-serif;color:#202124">' +
    '<h2 style="margin:0 0 4px">' + esc_(p.projectName) + ' – Punch List</h2>' +
    '<div style="color:#5f6368;margin-bottom:12px">' + items.length + ' item(s) · sent ' +
    Utilities.formatDate(new Date(), 'America/New_York', 'MMM d, yyyy') + ' by ' + esc_(me.name) + '</div>';
  if (p.note) html += '<p style="white-space:pre-wrap">' + esc_(p.note) + '</p>';

  let photos = 0, omitted = 0, failed = 0;
  const floors = [];
  items.forEach(i => { if (floors.indexOf(i.floorLabel) < 0) floors.push(i.floorLabel); });
  floors.forEach(fl => {
    const fi = items.filter(i => i.floorLabel === fl);
    html += '<h3 style="margin:20px 0 6px">' + esc_(fl) + '</h3>';
    const key = 'plan' + fi[0].floor;
    if (inline[key]) html += '<img src="cid:' + key + '" style="width:100%;max-width:900px;border:1px solid #ccc"><br>';
    html += '<table style="border-collapse:collapse;width:100%;max-width:900px;margin-top:6px"><tr>' +
      ['#', 'Room', 'Trade', 'Description', 'Assigned', 'Priority', 'Due', 'Status', 'Photos'].map(h => '<th ' + th + '>' + h + '</th>').join('') + '</tr>';
    fi.forEach(i => {
      let ph = '';
      (i.photos || []).forEach(u => {
        if (!p.includePhotos) return;
        if (photos >= MAX_PHOTOS) { omitted++; return; }
        if (!isPhotoUrl_(u)) { failed++; return; }
        let ok = false;
        try {
          const r = UrlFetchApp.fetch(u, { muteHttpExceptions: true });
          if (r.getResponseCode() === 200) {
            const k = 'ph' + photos++;
            inline[k] = r.getBlob().setContentType('image/jpeg').setName(k + '.jpg');
            ph += '<a href="' + esc_(u) + '"><img src="cid:' + k + '" style="width:110px;margin:2px;border:1px solid #ccc"></a>';
            ok = true;
          } else console.warn('Photo fetch ' + r.getResponseCode() + ': ' + u);
        } catch (e) { console.warn('Photo fetch failed: ' + e); }
        if (!ok) { failed++; ph += '<a href="' + esc_(u) + '">View photo</a><br>'; }
      });
      if (!p.includePhotos && (i.photos || []).length) ph = i.photos.length + ' photo(s)';
      html += '<tr>' + ['<b>' + esc_(i.number == null ? '…' : i.number) + '</b>', esc_(i.room), esc_(i.trade),
        esc_(i.description) + (i.notes ? '<br><i style="color:#5f6368">' + esc_(i.notes) + '</i>' : ''),
        esc_(i.assignedTo), esc_(i.priority), esc_(i.dueDate), esc_(i.status), ph].map(c => '<td ' + td + '>' + c + '</td>').join('') + '</tr>';
    });
    html += '</table>';
  });
  if (omitted) html += '<p style="color:#b06000">' + omitted + ' more photo(s) not included — ask for the PDF report for all photos.</p>';
  html += '<p style="color:#5f6368;font-size:12px;margin-top:16px">' + COMPANY + '</p></div>';

  const alias = deliver_(me, to, String(p.subject || (p.projectName + ' – Punch List')).slice(0, 200), html, inline);
  return { sent: items.length, photos: photos, omitted: omitted, failed: failed, mailer: 'v0.7.0',
    from: alias || Session.getEffectiveUser().getEmail(), aliasMissing: !!FROM_ALIAS && !alias };
}
