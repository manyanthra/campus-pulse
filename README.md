# CampusPulse – KCT Campus Maintenance Platform
Node.js · Express · MongoDB (Mongoose) · Socket.IO · JWT + bcrypt · email codes · SMS alerts

## Run
```
npm install
# open .env and set MONGO_URI, JWT_SECRET (and email/SMS if you have them)
npm run seed
npm start          # http://localhost:3000
```
Nothing configured? Emails and SMS are printed in the terminal (6-digit codes included).

## Sign in (no sign-up: accounts come from the college database)
Only @kct.ac.in IDs work. Step 1 email + password, step 2 the 6-digit code sent to that email.
"Forgot password?" sends a 6-digit code, then you choose a new password. Every password box has a show/hide eye.
Demo data (after `npm run seed`):
- Admin `admin@kct.ac.in` / `Admin@123`
- Students `student01…student30@kct.ac.in` / `Demo@123`
- Workers `plumber1`, `plumber2`, `electrician1`, `electrician2`, `carpenter1`, `cleaner1`, `network1`, `general1` @kct.ac.in / `Worker@123`
The student IDs are not real mailboxes: set `DEMO_MAIL_TO` in `.env` to your own inbox and all codes/emails arrive there.

## Flow
1. Student registers a complaint (photo required) → ticket ID e.g. CP-0001 is created.
2. Student gets the email "Complaint registered successfully" with the ticket ID.
3. Workers of that trade get an SMS at +91 7904335564.
4. Admin assigns (or a worker taps "Take this job") → student email + worker SMS.
5. Worker finishes → closes with an after-photo → student gets "Complaint closed" email with complaint ID, issue title and resolution confirmation.

## Admin analytics
KPIs (total, open, closure rate, average time to close, overdue, new today), complaints per day (14 days), status and priority donuts, by category / block, average hours per category, repeat-complaint hotspots, technician performance.

## Email setup (pick one)
- **Gmail:** Google account → Security → turn on 2-Step Verification → App passwords → create one. In `.env`: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER=you@gmail.com`, `SMTP_PASS=<16 chars>`, `MAIL_FROM="CampusPulse <you@gmail.com>"`.
- **Brevo:** SMTP key + verified sender + (if enabled) authorise your IP. `SMTP_HOST=smtp-relay.brevo.com`.
- **Outlook (OAuth2):** register an Entra app (public client, Graph delegated `Mail.Send`), put the client ID in `OUTLOOK_CLIENT_ID`, run `npm run outlook-login`.

## SMS setup
`SMS_PROVIDER=fast2sms` + `FAST2SMS_KEY`, or `SMS_PROVIDER=twilio` + `TWILIO_SID/TOKEN/FROM` (trial: verify +917904335564 and enable India in Geo permissions).

## Security
bcrypt passwords, hashed 6-digit codes (10 min expiry, 5 tries, resend cooldown), JWT, Helmet, rate limiting, role middleware, upload type/size checks, HTML escaped in emails. Never commit `.env`.
Photos are stored in `/uploads` (use Cloudinary when deploying to Render/Heroku).
