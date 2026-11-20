# launchlocal

ai generated marketing platform

A full local-marketing toolkit for small businesses (starting in Bakersfield, CA):

1. **Lead generator** — finds local businesses that need websites / ads / SEO. Uses the Google Places API when `GOOGLE_PLACES_API_KEY` is set; otherwise serves built-in demo leads so you can run the whole flow without keys. Every lead gets a 0–100 *marketing-need score* (no website, low rating, few reviews ⇒ hotter opportunity).
2. **Automated auditor + scorer** — crawls a business's website and checks HTTPS, load speed, title, meta description, H1, mobile viewport, robots.txt, sitemap.xml, favicon, JSON-LD schema, image alt-text and content depth. Produces an audit score, plain-English recommendations, and re-scores the lead.
3. **Website builder** — generates a fast one-page site per business from a **template library**: *Classic hero*, *Spotlight* (image-forward), *Trust bar* (reviews/stats-forward), and *Minimal* (clean pro). Templates auto-match the business category (plumber → Trust bar, restaurant → Spotlight, dentist → Minimal, …) or you can pick one explicitly with `POST /api/site {leadId, template}` — every template is mobile-ready, ships LocalBusiness JSON-LD, trust badges, and call CTAs. Copy is written by Mistral when `MISTRAL_API_KEY` is set, with strong built-in templates as fallback. Saved to `public/sites/` and served at `/sites/<slug>.html`.
4. **SEO optimizer** — produces a ready-to-paste pack: meta title + description, 8 local-intent keywords, 4 weekly Google Business Profile post ideas, and prioritized fixes (AI when available, heuristic fallback otherwise).
5. **Auto email/SMS responder** — drafts personalized first-touch outreach using the audit findings. Sends via SMTP (`nodemailer`) or Twilio when configured; otherwise returns the drafts as a preview.
6. **ML sales agent (Jamie)** — an agent loop with tool calling on Mistral `mistral-small-latest`:
   - **RAG knowledge base** (`mistral-embed` vector retrieval; keyword fallback): your offer/pricing, FAQs, every audit result, and all past conversations are indexed and searchable by the agent. Set your real offer at `POST /api/kb`.
   - **Tools the agent can call**: `search_knowledge`, `get_lead_info`, `book_meeting` (Cal.com/Calendly link), `send_email` (SMTP), `send_sms` (Twilio), `set_crm_status` (new/contacted/qualified/proposal/won/lost), `create_checkout` (Stripe payment links).
   - **Channels**: the website chat widget lives at `/chat` (embed it anywhere: `<iframe src="https://YOURHOST/chat?leadId=...">`); inbound email replies go to `POST /api/agent/email`; inbound SMS (Twilio webhook compatible, answers in TwiML) go to `POST /api/agent/sms`. Every turn is journaled into RAG and the lead's CRM timeline.
   - Works with **zero keys** in rule-based fallback mode (booking/pricing/checkout intents still work); add `MISTRAL_API_KEY` to enable the real LLM agent loop.
7. **Scheduled follow-up sequences** — enroll a lead in a drip via `POST /api/sequences/enroll {leadId, seqName?}`; list state with `GET /api/sequences`. Three built-ins: `daily` (5 consecutive days — audit number, speed fact, map-pack rivals, review stat, fixed-price last call, alternating email/SMS), `standard` (day 1 email recap → day 3 SMS nudge → day 7 final email), and `onboarding` (post-sale: welcome day 0, assets day 2, first report + review ask day 9). A ticker runs at boot and every 60s, sends due steps via the same SMTP/Twilio senders, journals every step to the lead's outreach log + CRM timeline, and auto-skips sequences for leads marked won/lost (onboarding excepted — it *is* the won flow). Sends also respect a **send window** (`SEND_WINDOW_START`/`SEND_WINDOW_END`, default 8am–8pm server time): outside the window due steps stay pending and go out at the next in-window tick, so no 3am texts. Force a run with `POST /api/sequences/tick`. Sends degrade gracefully to journaled no-ops without keys.
8. **Stripe payment webhooks** — `POST /webhooks/stripe` verifies the `Stripe-Signature` HMAC (timing-safe, 5-minute tolerance) against `STRIPE_WEBHOOK_SECRET` over the raw request body, then marks the matching lead (via `client_reference_id`) **won** with a `payment_received` timeline event — and **auto-enrolls the new client in the `onboarding` sequence** (welcome + kickoff checklist day 0, assets nudge day 2, first report + review ask day 9). Point a Stripe CLI forward or your Stripe dashboard webhook at `https://YOURHOST/webhooks/stripe` in production.
9. **Client monthly reports** — `buildReport` turns audit score, SEO state, follow-up attempts, site-captured leads, and payments into a plain-English text report. `POST /api/report {leadId}` previews it; `POST /api/report {leadId, send:true}` emails it to the client (conversation email on file, or `CLIENT_ALERT_EMAIL`). Won leads get one automatically every 7 days via the ticker, stamped `lastReportAt` and journaled as `report_sent`.
10. **Google Business Profile packs** — `POST /api/gbp {leadId}` produces a 10-step optimization checklist, 4 weekly GBP post ideas, and photo ideas (AI when `MISTRAL_API_KEY` is set, industry-aware heuristic otherwise). Persisted on the lead as `gbp`.
11. **Review generation** — `POST /api/reviews/request {leadId, customerPhone, customerName?}` texts the happy customer a Google review link (uses `GOOGLE_REVIEW_URL` when set — get your client's Place ID review link from their GBP dashboard; falls back to a search link). Journaled to outreach + timeline; sell it as a $99/mo "review boost".
12. **Site lead intake** — every generated template now includes a **lead-capture form** (name/phone/email/message) that posts to `POST /api/intake`. The lead is captured on the client's CRM timeline as `site_lead_in`, and `CLIENT_ALERT_EMAIL` gets an instant notification email when set. This closes the loop: the $497 site actually captures customers for your client.
13. **Ads waste audit** — `POST /api/ads-audit {monthlySpend, tracksConversions?, hasNegativeKeywords?, ...}` scores an existing Google/Facebook ads account and itemizes waste with dollar estimates ("~$125/mo on irrelevant searches") — a foot-in-the-door pitch for SEO Care that ends with a ready-made sell line. AI-enhanced with a sharp heuristic fallback.

## Run locally

```bash
git clone https://github.com/JimmyWalkins/launchlocal.git
cd launchlocal
npm install
cp .env.example .env   # add any keys you have — the app runs with none
npm run dev            # or: npm start
```

Open **http://localhost:3000** for the dashboard.

Everything works without keys: leads demo mode runs, audits hit real websites, sites build from templates, SEO falls back to heuristics, and outreach previews drafts. Add keys to unlock live lead search (`GOOGLE_PLACES_API_KEY`), AI copy (`MISTRAL_API_KEY`), SMS (`TWILIO_*`), and email (`SMTP_*`).

## API

All endpoints live under `/api`:

| Method | Route | Body | Effect |
|---|---|---|---|
| GET | `/api/status` | — | feature + integration flags |
| POST | `/api/leads/search` | `{category, city, limit?}` | find & score leads (Google Places or demo) |
| GET | `/api/leads` | — | all stored leads, sorted by need |
| GET | `/api/templates` | — | website template catalog (id, name, business-type fit) |
| POST | `/api/audit` | `{leadId?, url?}` | run website audit, re-score, index into RAG |
| POST | `/api/kb` | `{offer?, brand?, faqs?}` | update knowledge base (RAG reindexed) |
| POST | `/api/agent` | `{sessionId?, leadId?, message, contact?}` | sales agent turn (web widget) |
| POST | `/api/agent/email` | `{leadId?, from?, text, to?}` | agent answers inbound email, sends via SMTP |
| POST | `/api/agent/sms` | `{leadId?, From?, Body/text}` (or Twilio form post) | agent answers inbound SMS, replies in TwiML |
| POST | `/api/sequences/enroll` | `{leadId, seqName?}` | enroll lead in a follow-up drip sequence |
| GET | `/api/sequences` | — | available sequences + all enrollments/step state |
| POST | `/api/sequences/tick` | — | run due sequence steps now (also auto-runs every 60s) |
| POST | `/webhooks/stripe` | Stripe event (raw body + `Stripe-Signature`) | signature-verified; `checkout.session.completed` marks lead won + enrolls onboarding |
| POST | `/api/report` | `{leadId, send?}` | client monthly report (preview, or email with `send:true`; auto weekly for won leads) |
| POST | `/api/gbp` | `{leadId}` | Google Business Profile optimization pack |
| POST | `/api/reviews/request` | `{leadId, customerPhone, customerName?}` | text a customer the client's Google review link |
| POST | `/api/intake` | `{leadId, name, phone?, email?, message?}` | lead-capture form endpoint used by generated client sites |
| POST | `/api/ads-audit` | `{monthlySpend, ...yes/no flags}` | Google/Facebook ads waste audit + pitch |
| GET | `/api/conversations` | — | journaled conversations |
| POST | `/api/seo` | `{leadId}` | generate SEO pack |
| POST | `/api/site` | `{leadId, template?}` | build & serve one-page site (template optional; auto-matches category) |
| POST | `/api/responder` | `{leadId, email?, sms?}` | draft (+send when recipients given) outreach |
| POST | `/api/chat` | `{messages:[{role,content}]}` | Mistral chat (key required) |

## Smoke test

```bash
npm run smoke
```

Runs the whole pipeline in-process: dashboard, chat page, demo lead search, audit validation, site generation + serving, SEO pack, outreach preview.

## Structure

```
src/server.ts           server + chat endpoint (Mistral, key server-side only)
src/routes/api.ts       all /api endpoints above
src/lib/leadgen.ts      Google Places search + demo leads + scoring
src/lib/audit.ts        13-point automated website audit
src/lib/score.ts        marketing-need scoring model
src/lib/builder.ts      website generator (Mistral copy or templates)
src/lib/templates.ts    site template library (classic / spotlight / trustbar / minimal)
src/lib/seo.ts          SEO pack generator (AI or heuristic)
src/lib/responder.ts    email/sms drafting + sending
src/lib/ai.ts           Mistral client wrapper
src/lib/agent.ts        sales agent loop with 7 tools (Mistral tool calling + rules fallback)
src/lib/kb.ts           RAG store: offer/FAQ/audit/conversation chunks + retrieval
src/lib/embed.ts        mistral-embed embeddings + keyword-overlap fallback
src/lib/calendar.ts     Cal.com / Calendly booking links
src/lib/payments.ts     Stripe checkout links (REST)
src/lib/notify.ts       shared email (SMTP) and SMS (Twilio) senders
src/lib/sequences.ts    scheduled drips (standard + post-sale onboarding) + ticker
src/lib/reports.ts      client monthly reports (build/render/send/weekly ticker)
src/lib/gbp.ts          Google Business Profile optimization packs
src/lib/reviews.ts      review-request texts (Google review links)
src/lib/ads.ts          Google/Facebook ads waste audit
src/routes/webhooks.ts  Stripe inbound webhook (signature verify -> lead 'won')
src/lib/store.ts        SQLite persistence via node:sqlite (data/launchlocal.db; migrates legacy data/store.json)
public/                 dashboard (/) and chat (/chat)
```

Generated sites land in `public/sites/`; leads, conversations, KB, and sequence enrollments persist in `data/launchlocal.db` (SQLite, zero extra dependencies — a legacy `data/store.json` is migrated automatically on first boot). Both are gitignored.

Note: the Stripe webhook can only be verified end-to-end once the server is reachable from Stripe (e.g. `stripe listen --forward-to localhost:3000/webhooks/stripe` for dev, and put the app behind a public URL like `https://YOURHOST/webhooks/stripe` in production). Without `STRIPE_WEBHOOK_SECRET` set, the endpoint returns 503 and never processes unsigned events.
