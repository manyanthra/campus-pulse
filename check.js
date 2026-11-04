// Run:  npm run check   - shows which database the app uses and whether the demo logins exist
require('dotenv').config();
const mongoose = require('mongoose'), bcrypt = require('bcryptjs');
const { User, Ticket } = require('./models');
(async () => {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/campuspulse');
  console.log('Connected to database:', mongoose.connection.name, 'on', mongoose.connection.host);
  console.log('Users:', await User.countDocuments(), ' Tickets:', await Ticket.countDocuments());
  for (const [e, p] of [['student01@kct.ac.in', 'Demo@123'], ['admin@kct.ac.in', 'Admin@123'], ['plumber1@kct.ac.in', 'Worker@123']]) {
    const u = await User.findOne({ email: e });
    console.log(' ', e, '->', !u ? 'NOT FOUND (run: npm run seed)' : (await bcrypt.compare(p, u.password)) ? 'OK, password works' : 'exists but password differs (run: npm run seed)');
  }
  process.exit(0);
})().catch(e => { console.log('Cannot connect:', e.message); process.exit(1); });
