# Clinic platform

Appointments, check-in, billing and consultations for a multi-room clinic — three apps on one backend.

| App | URL | Who | Form factor |
| --- | --- | --- | --- |
| **Reception** | `/reception` | front desk | desktop |
| **Staff** (My Day → Consultation) | `/staff` | doctors / therapists / stylists | phone, tablet or desktop |
| **Client** | `/book`, `/my`, `/pay/:id`, `/checkin` | guests | phone |

## Run it

Needs Node 22.13+ (uses the built-in `node:sqlite`; no native modules).

```bash
npm install
npm run dev        # API on :3001, web on :5173 (proxying /api)
```

Open http://localhost:5173. The database is created and filled with a demo clinic on first start; `npm run seed` resets it.

Production: `npm run build && npm start` — one process on `:3001` serves the API and the built web app.

`npm test` runs the API flow tests against an in-memory database.

### Demo sign-ins (PIN `1234`)

| | Email |
| --- | --- |
| Reception | `rhea@clinic.test` |
| Dr. Carter (consults) | `carter@clinic.test` |
| Jessica K. (procedures) | `jessica@clinic.test` |
| Maya T. (styling) | `maya@clinic.test` |

Client app: use phone **(555) 017-4821** (Olivia Bennett). A one-time code is sent by "SMS" and, outside production, shown on screen.

## The 13 flows → screens

**Reception**
1. *Book* — `Calendar` (click an empty slot, or **+ New appointment**) → `New Appointment`. Provider/room conflicts, lunch and closing hours are enforced server-side. Online requests appear in the calendar rail and open `New Appointment` pre-filled.
2. *Check in* — `Check-in queue`: QR / name / phone search, one-tap check-in for returning guests, new-guest intake for walk-ins.
3. *Run the queue / waitlist* — live queue (updates over SSE), page the provider, send to room, start, no-show. Waitlist rail on the calendar: when a slot opens (cancel / reschedule / no-show) **auto-fill** offers it to the first matching guest by text; they accept via link (`/offer/:token`) or reception records their reply. Offers expire after 30 min and move to the next guest.
4. *Reschedule / cancel* — click any calendar card → `Edit Appointment`. A reason is mandatory, every change is logged (who/when/why), the guest is texted, the freed slot goes to the waitlist.
5. *Checkout* — `Billing` → invoice. Quotation arrives pre-built from the consultation with staff attribution; weekday promo, tax, pay in full or deposit + EMI, package credit, extra payments; commission is computed per line.
6. *Look up a client* — header search or `Clients` → profile with visit history, money spent, texts, upcoming visits.
7. *Configure a service* — `Services`: price, duration, room type, package size, commission %, who can perform it, items consumed → live margin.

**Staff** — `My Day` (who's waiting, next up, earned today) → `Consultation` (last visit, notes with voice dictation, recommended services + retail suggestions, **Save & generate quotation** finishes the visit and hands it to the front desk).

**Client** — `Book` → request sent → `My Appointments` (reschedule request, cancel outside the 24 h window, outstanding balance, rebook) → `Pay Invoice`.

## Layout

```
server/src
  db.js            SQLite schema + tiny query helpers
  lib/             availability, waitlist auto-fill, billing maths, auth, SSE, SMS log
  routes/          auth · catalog · schedule · waitlist · clients · billing · staff · analytics · public
  seed.js          demo clinic (8 weeks of history)
web/src
  reception/ staff/ client/   one folder per app
```

Money is stored in cents. Times are clinic-local `YYYY-MM-DDTHH:MM:SS` strings.

## Decisions worth knowing

- **Staff is its own lightweight app**, separate from reception's desktop app, as the flow doc describes. It shares the backend and sign-in; a reception user can open it read-only. If you'd rather fold it into reception, the routes under `/staff` and `routes/staff.js` are self-contained.
- **Provider vs. recommending doctor.** The performer is the appointment's provider; for treatments the consulting doctor is attached as `assistant` and earns `assistant_pct`. Invoices show both ("auto-filled").
- **Totals round to whole dollars** (`round_totals` setting) so the invoice, quotation and client app agree to the cent; set `round_totals` to `0` in the `settings` table for cent precision.
- **Auto-fill** only offers a slot to guests whose service fits both the room type and the gap.

## Before real use

Stubbed on purpose, each behind one function:

- SMS: `server/src/lib/notify.js#deliver` only writes to the `messages` table.
- Payments: the client Pay screen is a demo gateway (`routes/public.js`, `/pay`); no card data is collected. Plug a processor in there. Affirm/EMI is recorded, not originated.
- Client sign-in uses a one-time code; in non-production the code is returned in the API response so the demo works without SMS. Set `NODE_ENV=production` to stop that.
- Staff auth is email + PIN with signed 12 h tokens (`AUTH_SECRET` env, otherwise generated and stored). Add rate-limiting at the proxy and HTTPS in deployment.
- SQLite is fine for a single clinic; the data layer is plain SQL if you move to Postgres.

## Deploying on Vercel (demo)

`vercel.json` builds the web app and routes `/api/*` to `api/index.js`, which runs the whole Express API as one serverless function. Import the repo in Vercel and deploy; no environment variables are required.

This is a **demo deployment**, not production hosting:

- Serverless functions have no persistent disk. The SQLite database lives in `/tmp`, is seeded with demo data on a cold start, and **resets whenever the instance is recycled**. Parallel instances don't share data.
- Live queue updates fall back to polling every 8 s (a serverless function can't hold an SSE stream).
- Demo mode is on by default on Vercel: demo sign-in chips (PIN `1234`), the on-screen client one-time code, and a fixed demo token secret. Set `DEMO_MODE=0` plus `AUTH_SECRET` and `DEMO_PIN` to turn that off.
- For real use, host `server/` on a machine with a disk (or move the data layer to Postgres) and keep Vercel for the static web app.
