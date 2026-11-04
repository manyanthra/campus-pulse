const BLOCKS = ['A Block','B Block','C Block','D Block','E Block','F Block','Boys Hostel','Girls Hostel'];
const CATS = ['Plumbing','Electrical','Carpentry','Cleaning','Network / IT','Other'];
const ROOMS = Array.from({ length: 30 }, (_, i) => String(101 + i));      // 30 rooms per block
const COLORS = ['#a8556b','#6b5a9a','#4f7a5c','#d6a23c','#e08a7e','#7aa6c2'];
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const opts = a => a.map(x => `<option>${x}</option>`).join('');
let token = localStorage.getItem('cp_token'), me = null, tickets = [], workers = [], A = null, view = 'complaints', socket;

async function api(url, o = {}) {
  const headers = { ...(o.headers || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (o.body && !(o.body instanceof FormData)) { headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(o.body); }
  const r = await fetch('/api' + url, { ...o, headers });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.msg || 'Something went wrong'); e.status = r.status; throw e; }
  return d;
}
function toast(m, err) {
  const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = m;
  $('#toasts').append(t); setTimeout(() => t.remove(), 4500);
}
const logo = '<svg viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#f2b5b0"/><path d="M5 17h6l3-8 4 15 3-7h6" fill="none" stroke="#3d2f3a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.9 17.9A10.4 10.4 0 0 1 12 19C5.6 19 2 12 2 12a18 18 0 0 1 4.1-5.1M9.9 5.2A9.7 9.7 0 0 1 12 5c6.4 0 10 7 10 7a18 18 0 0 1-2.2 3.2M1 1l22 22"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

/* password eye: one listener for every password box */
document.addEventListener('click', e => {
  const b = e.target.closest('.eye'); if (!b) return;
  const i = b.previousElementSibling, show = i.type === 'password';
  i.type = show ? 'text' : 'password'; b.innerHTML = show ? EYE_OFF : EYE;
  b.setAttribute('aria-pressed', show); b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
});
const pw = (name, label, ac = 'current-password') => `<label class="f">${label}<span class="pw"><input name="${name}" type="password" required autocomplete="${ac}" minlength="${ac === 'new-password' ? 8 : 1}"><button type="button" class="eye" aria-label="Show password" aria-pressed="false">${EYE}</button></span></label>`;

/* 6-digit code boxes: auto-advance, backspace, paste */
const OTP = `<div class="otp" id="otp">${[0,1,2,3,4,5].map(i => `<input inputmode="numeric" maxlength="1" autocomplete="${i ? 'off' : 'one-time-code'}" aria-label="Digit ${i + 1}">`).join('')}</div>`;
function wireOtp(onFull) {
  const bs = [...document.querySelectorAll('#otp input')];
  bs.forEach((b, i) => {
    b.oninput = () => { b.value = b.value.replace(/\D/g, '').slice(-1); if (b.value && bs[i + 1]) bs[i + 1].focus(); if (bs.every(x => x.value)) onFull?.(); };
    b.onkeydown = e => { if (e.key === 'Backspace' && !b.value && bs[i - 1]) { bs[i - 1].focus(); bs[i - 1].value = ''; } };
    b.onpaste = e => {
      e.preventDefault();
      const d = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
      d.split('').forEach((c, j) => bs[j].value = c); bs[Math.min(d.length, 5)].focus(); if (d.length === 6) onFull?.();
    };
  });
  bs[0].focus();
  return { get: () => bs.map(b => b.value).join(''), clear: () => { bs.forEach(b => b.value = ''); bs[0].focus(); } };
}
function cooldown(btn, send, secs = 30) {
  let s = secs;
  const tick = () => { btn.disabled = s > 0; btn.textContent = s > 0 ? `Resend code in ${s}s` : 'Resend code'; if (s-- > 0) setTimeout(tick, 1000); };
  tick();
  btn.onclick = async () => { try { await send(); toast('New code sent'); s = secs; tick(); } catch (e) { toast(e.message, true); } };
}

/* ---------------- sign in (no sign-up: college database) ---------------- */
function showAuth() {
  document.body.dataset.role = 'guest';
  $('#app').innerHTML = `
  <div class="auth">
    <section class="hero">
      <div class="brand">${logo} CampusPulse</div>
      <div>
        <h1>Fixed faster.<br>Reported in a minute.</h1>
        <p class="lead">Tell us what is broken in your block or hostel room. We assign the right technician and email you at every step.</p>
        <div class="blocks">${BLOCKS.map(b => `<span>${b.replace(' Block', '')}</span>`).join('')}</div>
      </div>
      <p class="muted">Sign in with your @kct.ac.in college email ID</p>
      <svg class="pulse" viewBox="0 0 200 200" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"><path d="M10 110h50l22-62 34 110 24-58h50"/></svg>
    </section>
    <section class="panel"><div class="card" id="ac"></div></section>
  </div>`;
  viewLogin();
}
function viewLogin() {
  $('#ac').innerHTML = `<h2>Welcome back</h2><p class="muted">Use your KCT college email. We will send a 6-digit code to confirm it is you.</p><br>
    <form id="fIn">
      <label class="f">College email<input name="email" type="email" required autocomplete="username" pattern=".+@kct\\.ac\\.in" placeholder="you@kct.ac.in" title="Use your @kct.ac.in email"></label>
      ${pw('password', 'Password')}
      <button class="btn full">Continue</button>
    </form>
    <p class="rt"><button class="lnk" id="fg" type="button">Forgot password?</button></p>
    <div class="demo"><b>Demo:</b> student01@kct.ac.in … student30@kct.ac.in / <b>Demo@123</b><br>admin@kct.ac.in / Admin@123 · plumber1@kct.ac.in / Worker@123</div>`;
  $('#fg').onclick = viewForgot;
  $('#fIn').onsubmit = async e => {
    e.preventDefault(); const b = e.target.querySelector('.btn'); b.disabled = true;
    try { viewOtp(await api('/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) })); }
    catch (err) { toast(err.message, true); b.disabled = false; }
  };
}
function viewOtp(d) {
  $('#ac').innerHTML = `<h2>Check your email</h2><p class="muted">We sent a 6-digit code to <b>${esc(d.masked)}</b>. It works for 10 minutes.</p><br>
    <form id="fOtp">${OTP}<button class="btn full" style="margin-top:20px">Verify and sign in</button></form>
    <p class="rt"><button class="lnk" id="rs" type="button"></button> · <button class="lnk" id="bk" type="button">Back</button></p>`;
  const otp = wireOtp(() => $('#fOtp').requestSubmit());
  cooldown($('#rs'), () => api('/login/resend', { method: 'POST', body: { pending: d.pending } }));
  $('#bk').onclick = viewLogin;
  $('#fOtp').onsubmit = async e => {
    e.preventDefault();
    if (otp.get().length < 6) return toast('Enter all 6 digits', true);
    try {
      const r = await api('/login/verify', { method: 'POST', body: { pending: d.pending, code: otp.get() } });
      token = r.token; localStorage.setItem('cp_token', token); me = r.user; boot();
    } catch (err) { toast(err.message, true); otp.clear(); if (err.status === 401) viewLogin(); }
  };
}
function viewForgot() {
  $('#ac').innerHTML = `<h2>Forgot password?</h2><p class="muted">Enter your college email and we will send a 6-digit code.</p><br>
    <form id="fFg"><label class="f">College email<input name="email" type="email" required pattern=".+@kct\\.ac\\.in" placeholder="you@kct.ac.in" title="Use your @kct.ac.in email"></label>
    <button class="btn full">Send code</button></form><p class="rt"><button class="lnk" id="bk" type="button">Back to sign in</button></p>`;
  $('#bk').onclick = viewLogin;
  $('#fFg').onsubmit = async e => {
    e.preventDefault(); const email = new FormData(e.target).get('email'), b = e.target.querySelector('.btn'); b.disabled = true;
    try { const d = await api('/forgot', { method: 'POST', body: { email } }); toast(d.msg); viewReset(email); }
    catch (err) { toast(err.message, true); b.disabled = false; }
  };
}
function viewReset(email) {
  $('#ac').innerHTML = `<h2>Set a new password</h2><p class="muted">Enter the code from your email, then choose a new password (8+ characters).</p><br>
    <form id="fRs">${OTP}<br>${pw('password', 'New password', 'new-password')}${pw('confirm', 'Confirm new password', 'new-password')}<button class="btn full">Change password</button></form>
    <p class="rt"><button class="lnk" id="rs" type="button"></button> · <button class="lnk" id="bk" type="button">Back</button></p>`;
  const otp = wireOtp();
  cooldown($('#rs'), () => api('/forgot', { method: 'POST', body: { email } }));
  $('#bk').onclick = viewLogin;
  $('#fRs').onsubmit = async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    if (otp.get().length < 6) return toast('Enter all 6 digits', true);
    if (f.password !== f.confirm) return toast('The two passwords do not match', true);
    try { const d = await api('/reset', { method: 'POST', body: { email, code: otp.get(), password: f.password } }); toast(d.msg); viewLogin(); }
    catch (err) { toast(err.message, true); }
  };
}

/* ---------------- app shell ---------------- */
async function boot() {
  try { me = me || await api('/me'); } catch { return showAuth(); }
  document.body.dataset.role = me.role;
  if (!socket) { socket = io({ auth: { token } }); socket.on('ticket', e => { toast(e.msg); refresh(); }); }
  $('#app').innerHTML = `
    <header class="top"><div class="brand">${logo} CampusPulse</div>
      <div class="who"><span class="muted">${esc(me.name)}</span><span class="chip ${me.role}">${me.role === 'worker' ? esc(me.trade) : me.role}</span><button class="btn ghost sm" id="out">Sign out</button></div></header>
    <main id="main"></main>`;
  $('#out').onclick = () => { localStorage.removeItem('cp_token'); token = me = null; socket?.disconnect(); socket = null; showAuth(); };
  const m = $('#main');
  m.addEventListener('click', onAction);
  m.addEventListener('submit', onSubmit);
  m.addEventListener('change', e => {
    if (e.target.id === 'photo') {
      const f = e.target.files[0];
      $('#prevBox').innerHTML = f ? `<img class="preview" alt="Selected photo" src="${URL.createObjectURL(f)}">` : '';
      $('#dropTxt').textContent = f ? f.name : 'Tap to add a photo of the problem';
    }
    if (e.target.matches('.flt')) renderTickets();
  });
  await refresh();
}
async function refresh() {
  try {
    tickets = await api('/tickets');
    if (me.role === 'admin') [workers, A] = await Promise.all([api('/workers'), api('/analytics')]);
    render();
  } catch (e) { if (e.status === 401) { localStorage.removeItem('cp_token'); token = me = null; showAuth(); } }
}

/* ---------------- complaint views ---------------- */
const pill = s => `<span class="pill st-${s.replace(' ', '-')}">${s}</span>`;
const timeline = t => `<ul class="tl">${t.history.map(h => `<li><b>${h.status}</b> · ${esc(h.note)} <span class="muted">— ${esc(h.by)}, ${new Date(h.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span></li>`).join('')}</ul>`;
const imgs = t => `<div class="imgs"><figure><a href="${t.photo}" target="_blank"><img src="${t.photo}" alt="Problem photo"></a><figcaption>Problem</figcaption></figure>${t.resolvedPhoto ? `<figure><a href="${t.resolvedPhoto}" target="_blank"><img src="${t.resolvedPhoto}" alt="Fixed photo"></a><figcaption>After fix</figcaption></figure>` : ''}</div>`;
const head = t => `<div class="tk-h"><span class="id">${t.ticketId}</span>${pill(t.status)}</div><h3>${esc(t.title)}</h3>
  <p class="muted">${t.category} · ${t.block}, Room ${t.room} · <span class="pri-${t.priority}"><b>${t.priority}</b> priority</span></p>`;

function render() {
  const m = $('#main');
  if (me.role === 'student') {
    m.innerHTML = `<div class="grid2"><form class="card" id="newTk"><h2>Report a problem</h2><p class="muted">Add a photo so the technician knows what to bring.</p><br>
      <label class="f">Issue type<select name="category">${opts(CATS)}</select></label>
      <div class="row"><label class="f" style="flex:1">Block / Hostel<select name="block">${opts(BLOCKS)}</select></label>
      <label class="f" style="flex:1">Room<select name="room">${opts(ROOMS)}</select></label></div>
      <label class="f">Priority<select name="priority"><option>Low</option><option selected>Medium</option><option>High</option></select></label>
      <label class="f">Short title<input name="title" required maxlength="80" placeholder="e.g. Bathroom tap is leaking"></label>
      <label class="f">What is wrong?<textarea name="description" required maxlength="1000"></textarea></label>
      <div id="prevBox"></div>
      <label class="drop"><span id="dropTxt">Tap to add a photo of the problem</span><input type="file" id="photo" name="photo" accept="image/*" required></label>
      <button class="btn full">Send complaint</button></form>
      <section><h2>My complaints</h2><br><div class="list" id="tkList"></div></section></div>`;
  } else if (me.role === 'admin') {
    m.innerHTML = `<nav class="navtabs"><button data-view="complaints" class="${view === 'complaints' ? 'on' : ''}">Complaints</button><button data-view="analytics" class="${view === 'analytics' ? 'on' : ''}">Analytics</button></nav>` +
      (view === 'analytics' ? analyticsView() : `<div class="stats">
        <div class="stat s2"><b>${A.kpi.unassigned}</b>Waiting for assignment</div><div class="stat s4"><b>${A.kpi.open - A.kpi.unassigned}</b>Being fixed</div>
        <div class="stat s3"><b>${A.kpi.closed}</b>Closed</div><div class="stat s5"><b>${A.kpi.overdue}</b>Overdue</div></div>
        <h2>All complaints</h2><div class="filters"><select class="flt" id="fS" aria-label="Filter by status"><option value="">All statuses</option>${opts(['Submitted','Assigned','In Progress','Closed'])}</select>
        <select class="flt" id="fB" aria-label="Filter by block"><option value="">All blocks</option>${opts(BLOCKS)}</select></div><div class="list" id="tkList"></div>`);
  } else {
    m.innerHTML = `<h2>${me.trade === 'Other' ? 'All jobs' : esc(me.trade) + ' jobs'}</h2><p class="muted">Take a job, start the work, then close it with a photo of the finished repair.</p><br><div class="list" id="tkList"></div>`;
  }
  renderTickets();
}

function renderTickets() {
  const box = $('#tkList'); if (!box) return;
  let list = tickets;
  if (me.role === 'admin') { const s = $('#fS')?.value, b = $('#fB')?.value; list = list.filter(t => (!s || t.status === s) && (!b || t.block === b)); }
  box.innerHTML = list.length ? list.map(t => {
    let act = '';
    const mine = t.assignedTo?._id === me.id;
    if (me.role === 'admin' && t.status !== 'Closed') {
      const ws = workers.filter(w => t.category === 'Other' || w.trade === t.category || w.trade === 'Other');
      act = `<div class="row"><select data-w="${t._id}" style="width:auto;margin:0" aria-label="Choose technician">${ws.map(w => `<option value="${w._id}" ${t.assignedTo?._id === w._id ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select>
        <button class="btn lav sm" data-act="assign" data-id="${t._id}">${t.assignedTo ? 'Reassign' : 'Assign'}</button><button class="btn sage sm" data-act="close" data-id="${t._id}">Close</button></div>`;
    }
    if (me.role === 'worker' && t.status === 'Submitted') act = `<div class="row"><button class="btn sm" data-act="claim" data-id="${t._id}">Take this job</button></div>`;
    if (me.role === 'worker' && t.status !== 'Closed' && mine) {
      act = `<div class="row">${t.status === 'Assigned' ? `<button class="btn sm" data-act="start" data-id="${t._id}">Start work</button>` : ''}
        <input type="file" accept="image/*" id="p-${t._id}" style="width:auto;margin:0" aria-label="Photo of finished work"><button class="btn sage sm" data-act="done" data-id="${t._id}">Close with photo</button></div>`;
    }
    return `<article class="card tk">${head(t)}<p>${esc(t.description)}</p>
      ${me.role !== 'student' ? `<p class="muted">By ${esc(t.createdBy?.name || '')} (${esc(t.createdBy?.email || '')})${t.assignedTo ? ' · Technician: ' + esc(t.assignedTo.name) : ''}</p>` : (t.assignedTo ? `<p class="muted">Technician: ${esc(t.assignedTo.name)}</p>` : '')}
      ${imgs(t)}${act}<details><summary class="muted">Progress history</summary>${timeline(t)}</details></article>`;
  }).join('') : '<div class="empty">Nothing here yet.</div>';
}

/* ---------------- analytics dashboard ---------------- */
function lineChart(trend) {
  const W = 640, H = 230, P = { l: 34, r: 12, t: 14, b: 30 };
  const mx = Math.max(3, ...trend.flatMap(d => [d.created, d.closed]));
  const x = i => P.l + i * (W - P.l - P.r) / (trend.length - 1), y = v => P.t + (H - P.t - P.b) * (1 - v / mx);
  const pts = k => trend.map((d, i) => `${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(' ');
  const grid = [0, .5, 1].map(f => { const v = Math.round(mx * f); return `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="#f0d9d0"/><text x="${P.l - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#7b6670">${v}</text>`; }).join('');
  const xl = trend.map((d, i) => i % 2 === 0 ? `<text x="${x(i)}" y="${H - 9}" text-anchor="middle" font-size="11" fill="#7b6670">${d.label}</text>` : '').join('');
  const dots = k => trend.map((d, i) => `<circle cx="${x(i)}" cy="${y(d[k])}" r="3.5" fill="${k === 'created' ? '#a8556b' : '#4f7a5c'}"><title>${d.label}: ${d[k]} ${k}</title></circle>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Complaints created and closed per day, last 14 days">${grid}${xl}
    <polyline points="${pts('created')}" fill="none" stroke="#a8556b" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
    <polyline points="${pts('closed')}" fill="none" stroke="#4f7a5c" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>${dots('created')}${dots('closed')}</svg>`;
}
function donut(obj, title) {
  const ent = Object.entries(obj), tot = ent.reduce((s, [, v]) => s + v, 0), R = 44, C = 2 * Math.PI * R; let off = 0;
  const segs = ent.map(([, v], i) => { const len = tot ? v / tot * C : 0; const s = `<circle r="${R}" cx="60" cy="60" fill="none" stroke="${COLORS[i % COLORS.length]}" stroke-width="22" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)"/>`; off += len; return s; }).join('');
  return `<div class="card"><h3>${title}</h3><div class="donut"><svg viewBox="0 0 120 120" role="img" aria-label="${title}"><circle r="${R}" cx="60" cy="60" fill="none" stroke="#f6e3dc" stroke-width="22"/>${segs}<text x="60" y="66" text-anchor="middle" font-size="22" font-weight="800" fill="#3d2f3a">${tot}</text></svg>
    <ul>${ent.map(([k, v], i) => `<li><i style="background:${COLORS[i % COLORS.length]}"></i>${esc(k)} <b>${v}</b></li>`).join('')}</ul></div></div>`;
}
const barBox = (title, o, unit = '') => { const mx = Math.max(1, ...Object.values(o)); return `<div class="card"><h3>${title}</h3>${Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="bar"><span>${esc(k)}</span><i style="width:${v / mx * 100}%"></i><b>${v}${unit}</b></div>`).join('') || '<p class="muted">No data yet</p>'}</div>`; };

function analyticsView() {
  const k = A.kpi, kp = (v, l, c) => `<div class="stat ${c}"><b>${v}</b>${l}</div>`;
  const topCat = Object.entries(A.category).sort((a, b) => b[1] - a[1])[0], topBlock = Object.entries(A.block).sort((a, b) => b[1] - a[1])[0];
  return `<h2>Analytics</h2><p class="muted">Overdue means still open after 24 h (High), 48 h (Medium) or 72 h (Low).</p>
    <div class="stats">${kp(k.total, 'Total complaints', 's4')}${kp(k.open, 'Open now', 's2')}${kp(k.closureRate + '%', 'Closure rate', 's3')}${kp(k.avgHours + ' h', 'Avg time to close', 's1')}${kp(k.overdue, 'Overdue', 's5')}${kp(k.today, 'New today', 's4')}</div>
    ${topCat ? `<p class="insight"><b>Insight:</b> ${esc(topCat[0])} is the most reported issue (${topCat[1]}), and ${esc(topBlock[0])} raises the most complaints (${topBlock[1]}).${A.spots[0] ? ` ${esc(A.spots[0].place)} has had ${A.spots[0].n} complaints, worth a closer look.` : ''}</p>` : ''}
    <div class="card"><h3>Complaints per day, last 14 days</h3><div class="legend"><span><i style="background:#a8556b"></i>Registered</span><span><i style="background:#4f7a5c"></i>Closed</span></div>${lineChart(A.trend)}</div>
    <div class="bars">${donut(A.status, 'By status')}${donut(A.priority, 'By priority')}${barBox('By category', A.category)}${barBox('By block / hostel', A.block)}${barBox('Average hours to close, by category', A.catHours, ' h')}
    <div class="card"><h3>Repeat-complaint hotspots</h3>${A.spots.length ? A.spots.map(s => `<div class="bar" style="grid-template-columns:1fr 30px"><span>${esc(s.place)}</span><b>${s.n}</b></div>`).join('') : '<p class="muted">No repeats yet</p>'}</div></div>
    <div class="card"><h3>Technician performance</h3><div class="tbl"><table><thead><tr><th>Technician</th><th>Trade</th><th>Open jobs</th><th>Closed</th><th>Avg hours</th></tr></thead>
    <tbody>${A.workers.map(w => `<tr><td>${esc(w.name)}</td><td>${esc(w.trade)}</td><td>${w.open}</td><td>${w.closed}</td><td>${w.avgHours}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No assigned jobs yet</td></tr>'}</tbody></table></div></div>`;
}

/* ---------------- actions ---------------- */
async function onSubmit(e) {
  if (e.target.id !== 'newTk') return;
  e.preventDefault();
  const btn = e.target.querySelector('.btn'); btn.disabled = true;
  try {
    const t = await api('/tickets', { method: 'POST', body: new FormData(e.target) });
    toast(`Complaint registered. Ticket ${t.ticketId} sent to your email.`); await refresh();
  } catch (err) { toast(err.message, true); btn.disabled = false; }
}
async function onAction(e) {
  const v = e.target.closest('[data-view]');
  if (v) { view = v.dataset.view; return render(); }
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = b.dataset.id; b.disabled = true;
  try {
    const a = b.dataset.act, patch = (p, body) => api(`/tickets/${id}/${p}`, { method: 'PATCH', body });
    if (a === 'assign') await patch('assign', { workerId: $(`[data-w="${id}"]`).value });
    if (a === 'close') await patch('status', { status: 'Closed' });
    if (a === 'claim') await patch('claim');
    if (a === 'start') await patch('status', { status: 'In Progress' });
    if (a === 'done') {
      const f = $(`#p-${id}`).files[0]; if (!f) throw new Error('Choose a photo of the finished work first');
      const fd = new FormData(); fd.append('status', 'Closed'); fd.append('photo', f); await patch('status', fd);
    }
    toast('Updated'); await refresh();
  } catch (err) { toast(err.message, true); b.disabled = false; }
}

token ? boot() : showAuth();
