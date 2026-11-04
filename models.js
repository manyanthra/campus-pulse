const mongoose = require('mongoose');
const { Schema } = mongoose;

const User = mongoose.model('User', new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['student', 'admin', 'worker'], default: 'student' },
  trade: { type: String, default: '' },          // workers only
  phone: { type: String, default: '' },          // workers: SMS alerts
  otp: { hash: String, exp: Date, tries: Number, purpose: String, sentAt: Date }   // 6-digit email codes
}, { timestamps: true }));

const Ticket = mongoose.model('Ticket', new Schema({
  ticketId: { type: String, unique: true },
  title: String, description: String,
  category: String, priority: { type: String, default: 'Medium' },
  block: String, room: String,
  photo: String, resolvedPhoto: String,
  status: { type: String, enum: ['Submitted', 'Assigned', 'In Progress', 'Closed'], default: 'Submitted' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
  closedAt: Date,
  history: [{ status: String, note: String, by: String, at: { type: Date, default: Date.now } }]
}, { timestamps: true }));

// Atomic ticket numbers (CP-0001, CP-0002 ...). If the counter ever falls behind tickets that
// already exist (old data, a reset counter), it jumps past the highest existing number.
const Counter = mongoose.model('Counter', new Schema({ _id: String, n: { type: Number, default: 0 } }));
async function nextTicketId() {
  for (let i = 0; i < 5; i++) {
    const n = (await Counter.findByIdAndUpdate('ticket', { $inc: { n: 1 } }, { new: true, upsert: true })).n;
    const id = 'CP-' + String(n).padStart(4, '0');
    if (!(await Ticket.exists({ ticketId: id }))) return id;
    const last = await Ticket.findOne().sort({ ticketId: -1 }).collation({ locale: 'en', numericOrdering: true }).select('ticketId');
    await Counter.updateOne({ _id: 'ticket' }, { $max: { n: last ? parseInt(last.ticketId.slice(3)) : 0 } });
  }
  throw new Error('Could not create a ticket number, please try again');
}

module.exports = { User, Ticket, Counter, nextTicketId };
