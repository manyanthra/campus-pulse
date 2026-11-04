// One-time: connects the app to your Outlook mailbox (device-code sign-in, no password stored).
require('dotenv').config();
const fs = require('fs'), path = require('path');
const C = process.env.OUTLOOK_CLIENT_ID, T = process.env.OUTLOOK_TENANT || 'common';
const base = `https://login.microsoftonline.com/${T}/oauth2/v2.0`;
const post = (u, o) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o) }).then(r => r.json());
(async () => {
  if (!C) return console.error('Set OUTLOOK_CLIENT_ID in .env first.');
  const dc = await post(base + '/devicecode', { client_id: C, scope: 'offline_access Mail.Send' });
  if (dc.error) return console.error(dc.error_description || dc);
  console.log('\n' + dc.message + '\n');
  for (;;) {
    await new Promise(r => setTimeout(r, (dc.interval || 5) * 1000));
    const t = await post(base + '/token', { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: C, device_code: dc.device_code });
    if (t.access_token) { fs.writeFileSync(path.join(__dirname, 'outlook-token.json'), JSON.stringify({ refresh_token: t.refresh_token })); return console.log('Outlook connected. Emails will now be sent from your mailbox.'); }
    if (t.error && !['authorization_pending', 'slow_down'].includes(t.error)) return console.error(t.error_description || t);
  }
})();
