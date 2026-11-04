// Email (Outlook via Microsoft Graph OAuth2, or any SMTP) + SMS (Fast2SMS or Twilio).
// Anything not configured falls back to printing in the terminal, so the app never crashes.
const fs = require('fs'), path = require('path'), nodemailer = require('nodemailer');
const TOKEN_FILE = path.join(__dirname, 'outlook-token.json');
const TENANT = () => process.env.OUTLOOK_TENANT || 'common';
const SCOPE = 'offline_access Mail.Send';
const form = o => new URLSearchParams(o);
let cache = { at: null, exp: 0 };

const outlookReady = () => !!process.env.OUTLOOK_CLIENT_ID && fs.existsSync(TOKEN_FILE);

async function graphToken() {
  if (cache.at && Date.now() < cache.exp - 60000) return cache.at;
  const saved = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  const r = await fetch(`https://login.microsoftonline.com/${TENANT()}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ grant_type: 'refresh_token', client_id: process.env.OUTLOOK_CLIENT_ID, refresh_token: saved.refresh_token, scope: SCOPE })
  });
  const d = await r.json();
  if (!d.access_token) throw new Error(d.error_description || 'Outlook sign-in expired. Run: npm run outlook-login');
  if (d.refresh_token) fs.writeFileSync(TOKEN_FILE, JSON.stringify({ refresh_token: d.refresh_token }));
  cache = { at: d.access_token, exp: Date.now() + d.expires_in * 1000 };
  return cache.at;
}

const smtp = process.env.SMTP_HOST ? nodemailer.createTransport({
  host: process.env.SMTP_HOST, port: +process.env.SMTP_PORT || 587,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
}) : null;

async function mail(to, subject, html) {
  // DEMO_MAIL_TO: send every email to one real inbox (useful because seeded student IDs are fake)
  if (process.env.DEMO_MAIL_TO) { subject = `[for ${to}] ${subject}`; to = process.env.DEMO_MAIL_TO; }
  try {
    if (outlookReady()) {
      const r = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + await graphToken(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { subject, body: { contentType: 'HTML', content: html }, toRecipients: [{ emailAddress: { address: to } }] }, saveToSentItems: false })
      });
      if (!r.ok) throw new Error(`Outlook ${r.status}: ${await r.text()}`);
      return;
    }
    if (smtp) { await smtp.sendMail({ from: process.env.MAIL_FROM, to, subject, html }); return; }
    console.log(`\n📧 [DEV MAIL] To: ${to}\n   Subject: ${subject}\n   ${html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}\n`);
  } catch (e) { console.log('Mail failed:', e.message); }
}

async function sms(phones, text) {
  const nums = [...new Set([].concat(phones).filter(Boolean).map(p => String(p).replace(/\D/g, '').slice(-10)))];
  if (!nums.length) return;
  const P = process.env.SMS_PROVIDER || 'console';
  try {
    if (P === 'fast2sms') {
      const r = await fetch('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST', headers: { authorization: process.env.FAST2SMS_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({ route: 'q', message: text, language: 'english', flash: '0', numbers: nums.join(',') })
      });
      const d = await r.json();
      if (!d.return) throw new Error(JSON.stringify(d));
    } else if (P === 'twilio') {
      const { TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM } = process.env;
      for (const n of nums) {
        const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
          method: 'POST',
          headers: { Authorization: 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form({ To: '+91' + n, From: TWILIO_FROM, Body: text })
        });
        if (!r.ok) throw new Error(`Twilio ${r.status}: ${await r.text()}`);
      }
    } else console.log(`\n📱 [DEV SMS] To: ${nums.join(', ')}\n   ${text}\n`);
  } catch (e) { console.log('SMS failed:', e.message); }
}

module.exports = { mail, sms };
