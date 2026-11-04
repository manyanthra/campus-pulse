require('dotenv').config();
const mongoose = require('mongoose'), bcrypt = require('bcryptjs');
const { User, Ticket, Counter } = require('./models');

// small deterministic random generator so the demo data looks the same every time
const rnd = (() => { let a = 20261104; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })();
const pick = a => a[Math.floor(rnd() * a.length)];
const between = (lo, hi) => lo + rnd() * (hi - lo);

(async () => {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/campuspulse');
  await Promise.all([User.deleteMany({}), Ticket.deleteMany({}), Counter.deleteMany({})]);
  const PHONE = process.env.WORKER_PHONE || '7904335564';      // every worker gets this number for now
  const hash = p => bcrypt.hashSync(p, 10);
  const mk = (name, email, pw, role, trade = '', phone = '') => ({ name, email, password: hash(pw), role, trade, phone });

  const names = ['Aarav','Ananya','Bharath','Charulatha','Dinesh','Divya','Eswar','Fathima','Gokul','Harini','Ishaan','Janani','Karthik','Lakshmi','Mohan','Nandhini','Om Prakash','Priya','Quincy','Rahul','Sneha','Tarun','Uma','Vignesh','Yazhini','Zaid','Meenakshi','Naveen','Oviya','Pranav'];
  const students = names.map((n, i) => mk(n, `student${String(i + 1).padStart(2, '0')}@kct.ac.in`, 'Demo@123', 'student'));
  students.push(
  mk('Manyanthra M S', 'manyanthra.24cs@kct.ac.in', 'Demo@123', 'student')
  );
  const staff = [
    mk('Campus Admin', 'admin@kct.ac.in', 'Admin@123', 'admin'),
    mk('Murugan (Plumber)', 'plumber1@kct.ac.in', 'Worker@123', 'worker', 'Plumbing', PHONE),
    mk('Selvam (Plumber)', 'plumber2@kct.ac.in', 'Worker@123', 'worker', 'Plumbing', PHONE),
    mk('Ravi (Electrician)', 'electrician1@kct.ac.in', 'Worker@123', 'worker', 'Electrical', PHONE),
    mk('Kumar (Electrician)', 'electrician2@kct.ac.in', 'Worker@123', 'worker', 'Electrical', PHONE),
    mk('Subbu (Carpenter)', 'carpenter1@kct.ac.in', 'Worker@123', 'worker', 'Carpentry', PHONE),
    mk('Valli (Housekeeping)', 'cleaner1@kct.ac.in', 'Worker@123', 'worker', 'Cleaning', PHONE),
    mk('Arun (Network Engineer)', 'network1@kct.ac.in', 'Worker@123', 'worker', 'Network / IT', PHONE),
    mk('Bala (General Maintenance)', 'general1@kct.ac.in', 'Worker@123', 'worker', 'Other', PHONE)
  ];
  const users = await User.insertMany([...students, ...staff]);
  const stu = users.filter(u => u.role === 'student'), wk = users.filter(u => u.role === 'worker');

  const TITLES = {
    'Plumbing': ['Tap leaking', 'Flush not working', 'Drain blocked', 'No water in bathroom'],
    'Electrical': ['Fan not working', 'Tube light flickering', 'Socket sparking', 'Switch board broken'],
    'Carpentry': ['Broken study table', 'Door lock loose', 'Cupboard hinge broken', 'Bed frame cracked'],
    'Cleaning': ['Corridor not cleaned', 'Dustbin overflowing', 'Washroom needs cleaning', 'Water stagnating outside'],
    'Network / IT': ['Wi-Fi not reachable', 'LAN port dead', 'Projector not connecting', 'Slow internet in room'],
    'Other': ['Window glass cracked', 'Pest problem', 'Paint peeling', 'Water cooler not working']
  };
  const CATS = ['Plumbing', 'Plumbing', 'Electrical', 'Electrical', 'Electrical', 'Carpentry', 'Cleaning', 'Cleaning', 'Network / IT', 'Network / IT', 'Other'];
  const BLOCKS = ['A Block', 'B Block', 'C Block', 'D Block', 'E Block', 'F Block', 'Boys Hostel', 'Boys Hostel', 'Girls Hostel', 'Girls Hostel'];
  const HOURS = { High: [3, 30], Medium: [6, 60], Low: [10, 80] };
  const now = Date.now(), docs = [];

  const make = (createdAt, fresh) => {
    const category = pick(CATS), priority = pick(['Low', 'Medium', 'Medium', 'High']), student = pick(stu);
    const worker = pick(wk.filter(w => w.trade === category || (category === 'Other' && w.trade === 'Other')));
    const t = {
      title: pick(TITLES[category]), description: 'Please check this as soon as possible.', category, priority,
      block: pick(BLOCKS), room: String(Math.floor(between(101, 131))), photo: '/img/sample.svg', createdBy: student._id,
      createdAt: new Date(createdAt), updatedAt: new Date(createdAt),
      history: [{ status: 'Submitted', note: 'Complaint registered', by: student.name, at: new Date(createdAt) }], status: 'Submitted'
    };
    if (fresh) return t;
    const r = rnd(), age = (now - createdAt) / 36e5;
    const step = (status, note, h) => t.history.push({ status, note, by: worker.name, at: new Date(createdAt + h * 36e5) });
    if (r < 0.66) {
      const took = between(...HOURS[priority]);
      if (took < age) { step('Assigned', 'Assigned by admin', took * 0.15); step('In Progress', 'Work started', took * 0.4); step('Closed', 'Issue resolved', took);
        Object.assign(t, { status: 'Closed', assignedTo: worker._id, resolvedPhoto: '/img/sample.svg', closedAt: new Date(createdAt + took * 36e5) }); return t; }
    }
    if (r < 0.82) { step('Assigned', 'Assigned by admin', Math.min(age * 0.3, 4)); step('In Progress', 'Work started', Math.min(age * 0.6, 8)); Object.assign(t, { status: 'In Progress', assignedTo: worker._id }); }
    else if (r < 0.93) { step('Assigned', 'Assigned by admin', Math.min(age * 0.3, 4)); Object.assign(t, { status: 'Assigned', assignedTo: worker._id }); }
    return t;
  };
  for (let i = 0; i < 70; i++) docs.push(make(now - between(4, 14 * 24) * 36e5));   // last 14 days
  for (let i = 0; i < 5; i++) docs.push(make(now - between(0.2, 3) * 36e5, true));  // brand-new, waiting for assignment
  docs.sort((a, b) => a.createdAt - b.createdAt).forEach((d, i) => d.ticketId = 'CP-' + String(i + 1).padStart(4, '0'));
  await Ticket.insertMany(docs);
  await Counter.create({ _id: 'ticket', n: docs.length });
  console.log(`Seeded: ${stu.length} students, 1 admin, ${wk.length} workers, ${docs.length} complaints`);
  process.exit(0);
})();
