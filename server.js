require('dotenv').config();
const express = require('express'), http = require('http'), path = require('path'), fs = require('fs'), crypto = require('crypto');
const mongoose = require('mongoose'), bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken');
const multer = require('multer'), helmet = require('helmet'), rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const { User, Ticket, nextTicketId } = require('./models');
const { mail, sms } = require('./mailer');

const { JWT_SECRET = 'dev-secret', BASE_URL = 'http://localhost:3000' } = process.env;
if (JWT_SECRET === 'dev-secret' || JWT_SECRET.startsWith('change-this')) console.warn('⚠  Set a long random JWT_SECRET in .env');

const KCT = /^[^\s@]+@kct\.ac\.in$/i;                       // college IDs only
const CATS = ['Plumbing', 'Electrical', 'Carpentry', 'Cleaning', 'Network / IT', 'Other'];
const BLOCKS = ['A Block', 'B Block', 'C Block', 'D Block', 'E Block', 'F Block', 'Boys Hostel', 'Girls Hostel'];
const PRIORITIES = ['Low', 'Medium', 'High'];
const SLA = { High: 24, Medium: 48, Low: 72 };               // hours before a complaint counts as overdue
const ROOM = /^(10[1-9]|11\d|12\d|130)$/;                    // rooms 101-130
const UP = path.join(__dirname, 'uploads'); fs.mkdirSync(UP, { recursive: true });

const app = express(), server = http.createServer(app), io = new Server(server);
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
app.use(express.json({ limit: '50kb' }));
const limit = (min, max, msg) => rateLimit({ windowMs: min * 60e3, max, message: { msg } });
app.use('/api/login', limit(15, 60, 'Too many attempts, try again in a few minutes'));
app.use('/api/forgot', limit(60, 10, 'Too many requests, try again later'));
app.use('/api/reset', limit(15, 30, 'Too many attempts, try again in a few minutes'));
app.use('/uploads', express.static(UP));
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- helpers ---------- */
const httpErr = (status, msg) => Object.assign(new Error(msg), { status });
const h = fn => (req, res, next) => fn(req, res, next).catch(next);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pub = u => ({ id: u._id, name: u.name, email: u.email, role: u.role, trade: u.trade });
const mask = e => e.replace(/^(.{2}).*(@.*)$/, '$1***$2');
const auth = (...roles) => async (req, res, next) => {
  try {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    const p = jwt.verify(t, JWT_SECRET);
    if (p.p) throw 0;                                        // half-signed-in tokens are not accepted here
    req.user = await User.findById(p.id);
    if (!req.user) throw 0;
    if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ msg: 'Not allowed for your role' });
    next();
  } catch { res.status(401).json({ msg: 'Please sign in again' }); }
};
const populate = q => q.populate('createdBy', 'name email').populate('assignedTo', 'name email trade');
const push = (ids, evt) => ids.filter(Boolean).forEach(i => io.to('user:' + i).emit('ticket', evt));
const pushAdmins = evt => io.to('role:admin').emit('ticket', evt);
const tpl = (title, body, link, label) => `<div style="font-family:Segoe UI,Arial;background:#fdf3ee;padding:28px">
 <div style="max-width:520px;margin:auto;background:#fff;border-radius:18px;padding:28px;border:1px solid #f0d9d0">
 <h2 style="margin:0 0 8px;color:#3d2f3a">CampusPulse</h2><h3 style="color:#a8556b;margin:0 0 14px">${title}</h3>
 <p style="color:#5b4a55;line-height:1.7">${body}</p>
 ${link ? `<p><a href="${link}" style="background:#f2b5b0;color:#3d2f3a;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">${label}</a></p>` : ''}
 <p style="color:#9a8a93;font-size:12px">KCT Campus Maintenance</p></div></div>`;
const idBadge = id => `<b style="background:#fdf3ee;border:1px solid #f0d9d0;border-radius:8px;padding:2px 10px;color:#a8556b">${esc(id)}</b>`;

/* ---------- 6-digit email codes (sign-in + forgot password) ---------- */
const OTP_TTL = 10 * 60e3, MAX_TRIES = 5, RESEND_GAP = 30e3;
async function issueOtp(user, purpose, minGap = RESEND_GAP) {
  const gap = user.otp?.sentAt ? Date.now() - user.otp.sentAt : Infinity;
  if (gap < minGap) throw httpErr(429, `Please wait ${Math.ceil((minGap - gap) / 1000)} seconds before asking for another code`);
  const code = String(crypto.randomInt(100000, 1000000));
  user.otp = { hash: await bcrypt.hash(code, 8), exp: new Date(Date.now() + OTP_TTL), tries: 0, purpose, sentAt: new Date() };
  await user.save();
  console.log('\n========== CAMPUSPULSE OTP ==========');
console.log('USER:', user.email);
console.log('PURPOSE:', purpose);
console.log('OTP:', code);
console.log('=====================================\n');
  const login = purpose === 'login';
  await mail(user.email, login ? 'Your CampusPulse sign-in code' : 'Reset your CampusPulse password',
    tpl(login ? 'Your sign-in code' : 'Password reset code',
      `Hi ${esc(user.name)}, your 6-digit code is<br><br><span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#3d2f3a">${code}</span><br><br>It works for 10 minutes. Never share it with anyone.`));
}
async function checkOtp(user, code, purpose) {
  const o = user?.otp;
  if (!o?.hash || o.purpose !== purpose || !o.exp || o.exp < Date.now()) throw httpErr(400, 'This code has expired. Ask for a new one.');
  if (o.tries >= MAX_TRIES) throw httpErr(429, 'Too many wrong attempts. Ask for a new code.');
  if (!(await bcrypt.compare(String(code || ''), o.hash))) { user.set('otp.tries', (o.tries || 0) + 1); await user.save(); throw httpErr(400, 'Wrong code, please try again'); }
  user.otp = undefined; await user.save();
}

/* ---------- auth: college login (no sign-up) ---------- */
app.post('/api/login', h(async (req, res) => {
  const { email = '', password = '' } = req.body;
  if (!KCT.test(email)) throw httpErr(403, 'Only @kct.ac.in email IDs can sign in');
  const u = await User.findOne({ email: email.toLowerCase() });
  if (!u || !(await bcrypt.compare(password, u.password))) throw httpErr(401, 'Wrong email or password');
  await issueOtp(u, 'login', 8000);               // a fresh password sign-in may ask again after 8 s
  res.json({ step: 'otp', masked: mask(u.email), pending: jwt.sign({ id: u._id, p: 'otp' }, JWT_SECRET, { expiresIn: '10m' }) });
}));
const pending = tok => { try { const p = jwt.verify(tok, JWT_SECRET); if (p.p !== 'otp') throw 0; return p.id; } catch { throw httpErr(401, 'Sign-in timed out. Please start again.'); } };
app.post('/api/login/resend', h(async (req, res) => {
  const u = await User.findById(pending(req.body.pending));
  await issueOtp(u, 'login'); res.json({ msg: 'New code sent' });
}));
app.post('/api/login/verify', h(async (req, res) => {
  const u = await User.findById(pending(req.body.pending));
  await checkOtp(u, req.body.code, 'login');
  res.json({ token: jwt.sign({ id: u._id, role: u.role }, JWT_SECRET, { expiresIn: '7d' }), user: pub(u) });
}));
app.get('/api/me', auth(), (req, res) => res.json(pub(req.user)));

app.post('/api/forgot', h(async (req, res) => {
  const email = String(req.body.email || '').toLowerCase();
  if (!KCT.test(email)) throw httpErr(400, 'Enter your @kct.ac.in email ID');
  const u = await User.findOne({ email });
  if (u) await issueOtp(u, 'reset').catch(e => { if (e.status !== 429) throw e; });
  res.json({ msg: 'If this email is registered, a 6-digit code has been sent.' });   // same answer either way
}));
app.post('/api/reset', h(async (req, res) => {
  const { email = '', code, password = '' } = req.body;
  if (password.length < 8) throw httpErr(400, 'Password needs at least 8 characters');
  const u = await User.findOne({ email: email.toLowerCase() });
  await checkOtp(u, code, 'reset');
  u.password = await bcrypt.hash(password, 10); await u.save();
  res.json({ msg: 'Password changed. You can sign in now.' });
}));

/* ---------- photo uploads ---------- */
const upload = multer({
  storage: multer.diskStorage({
    destination: UP,
    filename: (_, f, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + path.extname(f.originalname).toLowerCase())
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, f, cb) => /^image\/(jpeg|png|webp|gif)$/.test(f.mimetype) ? cb(null, true) : cb(httpErr(400, 'Only JPG, PNG, WEBP or GIF photos are allowed'))
});
const dropFile = req => req.file && fs.unlink(req.file.path, () => {});

/* ---------- tickets ---------- */
app.post('/api/tickets', auth('student'), upload.single('photo'), h(async (req, res) => {
  const { title = '', category, priority = 'Medium', block, room, description = '' } = req.body;
  const bad = !title.trim() || !description.trim() ? 'Fill all fields'
    : !CATS.includes(category) || !BLOCKS.includes(block) || !ROOM.test(String(room)) || !PRIORITIES.includes(priority) ? 'Choose a valid issue type, block and room'
    : title.length > 80 || description.length > 1000 ? 'Title or description is too long'
    : !req.file ? 'Photo proof is required' : '';
  if (bad) { dropFile(req); throw httpErr(400, bad); }

  const t = await Ticket.create({
    ticketId: await nextTicketId(), title: title.trim(), category, priority, block, room, description: description.trim(),
    photo: '/uploads/' + req.file.filename, createdBy: req.user._id,
    history: [{ status: 'Submitted', note: 'Complaint registered', by: req.user.name }]
  });
  // 1) student email: registered successfully + ticket ID
  await mail(req.user.email, `[${t.ticketId}] Complaint registered successfully`, tpl('Complaint registered successfully',
    `Your complaint has been saved.<br><br>Ticket ID: ${idBadge(t.ticketId)}<br>Issue: <b>${esc(t.title)}</b><br>Location: ${esc(t.block)}, Room ${esc(t.room)}<br><br>We'll email you when it is assigned and when it is closed.`, BASE_URL, 'Track my complaint'));
  // 2) worker SMS (+91 7904335564 for every worker for now; same numbers are merged into one SMS)
  const crew = await User.find({ role: 'worker', $or: [{ trade: t.category }, { trade: 'Other' }] });
  await sms(crew.map(w => w.phone), `CampusPulse: New ${t.category} complaint ${t.ticketId} at ${t.block} Rm ${t.room} (${t.priority}). Login to take it.`);
  // 3) admin email + live alerts
  (await User.find({ role: 'admin' })).forEach(a => mail(a.email, `[${t.ticketId}] New complaint: ${t.title}`, tpl('New complaint', `${esc(t.category)} issue at ${esc(t.block)}, Room ${esc(t.room)}. Priority: ${esc(t.priority)}.`, BASE_URL, 'Open dashboard')));
  crew.forEach(w => io.to('user:' + w._id).emit('ticket', { msg: `New ${t.category} complaint ${t.ticketId}` }));
  pushAdmins({ msg: `New complaint ${t.ticketId}: ${t.title}` });
  res.status(201).json(t);
}));

app.get('/api/tickets', auth(), h(async (req, res) => {
  const f = req.user.role === 'student' ? { createdBy: req.user._id }
    : req.user.role === 'worker' ? (req.user.trade === 'Other' ? {} : { $or: [{ assignedTo: req.user._id }, { category: req.user.trade }] }) : {};
  res.json(await populate(Ticket.find(f).sort({ createdAt: -1 })));
}));

app.get('/api/workers', auth('admin'), h(async (_, res) => res.json(await User.find({ role: 'worker' }).select('name trade email'))));

app.patch('/api/tickets/:id/assign', auth('admin'), h(async (req, res) => {
  const w = await User.findOne({ _id: req.body.workerId, role: 'worker' });
  const t = await Ticket.findById(req.params.id).populate('createdBy', 'name email');
  if (!w || !t) throw httpErr(404, 'Ticket or worker not found');
  if (t.status === 'Closed') throw httpErr(400, 'Ticket is already closed');
  t.assignedTo = w._id; t.status = 'Assigned';
  t.history.push({ status: 'Assigned', note: `Assigned to ${w.name} (${w.trade})`, by: req.user.name });
  await t.save();
  await mail(t.createdBy.email, `[${t.ticketId}] Complaint assigned`, tpl('Your complaint is assigned', `${idBadge(t.ticketId)}<br><b>${esc(w.name)}</b> (${esc(w.trade)}) will take care of <b>${esc(t.title)}</b>.`, BASE_URL, 'Track my complaint'));
  await mail(w.email, `[${t.ticketId}] New job assigned`, tpl('New job for you', `${esc(t.title)}<br>${esc(t.block)}, Room ${esc(t.room)}. Priority: ${esc(t.priority)}.`, BASE_URL, 'Open my jobs'));
  await sms(w.phone, `CampusPulse: Job ${t.ticketId} assigned to you - ${t.title}, ${t.block} Rm ${t.room}. Priority ${t.priority}.`);
  push([t.createdBy._id, w._id], { msg: `${t.ticketId} is now Assigned` }); pushAdmins({ msg: `${t.ticketId} assigned to ${w.name}` });
  res.json(t);
}));

app.patch('/api/tickets/:id/claim', auth('worker'), h(async (req, res) => {
  const t = await Ticket.findById(req.params.id).populate('createdBy', 'name email');
  if (!t) throw httpErr(404, 'Ticket not found');
  if (req.user.trade !== 'Other' && t.category !== req.user.trade) throw httpErr(403, 'This is not your trade');
  if (t.status !== 'Submitted') throw httpErr(400, 'Someone already took this job');
  t.assignedTo = req.user._id; t.status = 'Assigned';
  t.history.push({ status: 'Assigned', note: `Taken by ${req.user.name} (${req.user.trade})`, by: req.user.name });
  await t.save();
  await mail(t.createdBy.email, `[${t.ticketId}] Complaint assigned`, tpl('Your complaint is assigned', `${idBadge(t.ticketId)}<br><b>${esc(req.user.name)}</b> (${esc(req.user.trade)}) will take care of <b>${esc(t.title)}</b>.`, BASE_URL, 'Track my complaint'));
  push([t.createdBy._id], { msg: `${t.ticketId} is now Assigned` }); pushAdmins({ msg: `${t.ticketId} taken by ${req.user.name}` });
  res.json(t);
}));

app.patch('/api/tickets/:id/status', auth('admin', 'worker'), upload.single('photo'), h(async (req, res) => {
  const { status, note = '' } = req.body;
  try {
    if (!['In Progress', 'Closed'].includes(status)) throw httpErr(400, 'Invalid status');
    const t = await Ticket.findById(req.params.id).populate('createdBy', 'name email');
    if (!t) throw httpErr(404, 'Ticket not found');
    if (t.status === 'Closed') throw httpErr(400, 'Ticket is already closed');
    if (req.user.role === 'worker' && String(t.assignedTo) !== String(req.user._id)) throw httpErr(403, 'This job is not assigned to you');
    if (req.user.role === 'worker' && status === 'Closed' && !req.file) throw httpErr(400, 'Upload a photo of the finished work');
    t.status = status;
    if (req.file) t.resolvedPhoto = '/uploads/' + req.file.filename;
    if (status === 'Closed') t.closedAt = new Date();
    t.history.push({ status, note: note || (status === 'Closed' ? 'Issue resolved' : 'Work started'), by: req.user.name });
    await t.save();
    if (status === 'Closed') await mail(t.createdBy.email, `[${t.ticketId}] Complaint closed`, tpl('Your complaint is closed',
      `Complaint ID: ${idBadge(t.ticketId)}<br>Issue: <b>${esc(t.title)}</b><br><br><b>Resolution confirmed:</b> this issue was resolved and closed by ${esc(req.user.name)} on ${t.closedAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })}.<br>If the problem comes back, please register a new complaint.`, BASE_URL, 'View details'));
    push([t.createdBy._id, t.assignedTo], { msg: `${t.ticketId} is now ${status}` }); pushAdmins({ msg: `${t.ticketId} is now ${status}` });
    res.json(t);
  } catch (e) { dropFile(req); throw e; }
}));

/* ---------- analytics dashboard (admin) ---------- */
app.get('/api/analytics', auth('admin'), h(async (_, res) => {
  const all = await Ticket.find().populate('assignedTo', 'name trade');
  const now = Date.now(), closed = all.filter(t => t.closedAt), open = all.filter(t => t.status !== 'Closed');
  const hrs = t => (t.closedAt - t.createdAt) / 36e5;
  const avg = a => a.length ? +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(1) : 0;
  const count = (arr, f) => arr.reduce((m, t) => { const k = f(t); m[k] = (m[k] || 0) + 1; return m; }, {});
  const day = d => new Date(d).toLocaleDateString('en-CA');
  const made = count(all, t => day(t.createdAt)), done = count(closed, t => day(t.closedAt));
  const trend = [...Array(14)].map((_, i) => { const d = new Date(now - (13 - i) * 864e5); return { label: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), created: made[day(d)] || 0, closed: done[day(d)] || 0 }; });
  const byWorker = {};
  all.filter(t => t.assignedTo).forEach(t => {
    const w = t.assignedTo, r = byWorker[w._id] || (byWorker[w._id] = { name: w.name, trade: w.trade, open: 0, closed: 0, h: [] });
    if (t.status === 'Closed') { r.closed++; r.h.push(hrs(t)); } else r.open++;
  });
  const catHours = {};
  CATS.forEach(c => { const a = closed.filter(t => t.category === c).map(hrs); if (a.length) catHours[c] = avg(a); });
  res.json({
    kpi: {
      total: all.length, open: open.length, closed: closed.length, unassigned: all.filter(t => t.status === 'Submitted').length,
      closureRate: all.length ? Math.round(closed.length / all.length * 100) : 0, avgHours: avg(closed.map(hrs)),
      overdue: open.filter(t => (now - t.createdAt) / 36e5 > (SLA[t.priority] || 48)).length, today: made[day(now)] || 0
    },
    status: count(all, t => t.status), category: count(all, t => t.category), block: count(all, t => t.block), priority: count(all, t => t.priority),
    trend, catHours,
    workers: Object.values(byWorker).map(r => ({ name: r.name, trade: r.trade, open: r.open, closed: r.closed, avgHours: avg(r.h) })).sort((a, b) => b.closed - a.closed),
    spots: Object.entries(count(all, t => `${t.block} · Room ${t.room}`)).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([place, n]) => ({ place, n }))
  });
}));

/* ---------- realtime ---------- */
io.use((s, next) => { try { const p = jwt.verify(s.handshake.auth.token, JWT_SECRET); if (p.p) throw 0; s.user = p; next(); } catch { next(new Error('unauthorized')); } });
io.on('connection', s => { s.join('user:' + s.user.id); s.join('role:' + s.user.role); });

app.use((err, req, res, next) => {
  const big = err.code === 'LIMIT_FILE_SIZE';
  if (!err.status && !big) console.error(err);
  res.status(big ? 413 : err.status || 500).json({ msg: big ? 'Photo must be under 5 MB' : err.status ? err.message : 'Something went wrong on the server' });
});

mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/campuspulse')
  .then(() => server.listen(process.env.PORT || 3000, () => console.log(`CampusPulse running at ${BASE_URL}`)))
  .catch(e => { console.error('MongoDB connection failed:', e.message); process.exit(1); });
