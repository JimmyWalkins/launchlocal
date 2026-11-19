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
7. **Scheduled follow-up sequences** — enroll a lead in a drip sequence (default `standard`: day 1 email recap → day 3 SMS nudge → day 7 final email). A ticker runs at boot and every 60s, sends due steps via the same SMTP/Twilio senders, journals every step to the lead's outreach log + CRM timeline, and auto-stops sequences for leads marked won/lost. Enroll with `POST /api/sequences/enroll {leadId, seqName?}`; inspect with `GET /api/sequences`; force a run with `POST /api/sequences/tick`. Sends degrade gracefully to journaled no-ops without keys.
8. **Stripe payment webhooks** — `POST /webhooks/stripe` verifies the `Stripe-Signature` HMAC (timing-safe, 5-minute tolerance) against `STRIPE_WEBHOOK_SECRET` over the raw request body, then marks the matching lead (via `client_reference_id`) **won** with a `payment_received` timeline event. Point a Stripe CLI forward or your Stripe dashboard webhook at `https://YOURHOST/webhooks/stripe` in production.

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
| POST | `/webhooks/stripe` | Stripe event (raw body + `Stripe-Signature`) | signature-verified; `checkout.session.completed` marks lead won |
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
src/lib/sequences.ts    scheduled follow-up drips (day 1/3/7) + ticker
src/routes/webhooks.ts  Stripe inbound webhook (signature verify -> lead 'won')
src/lib/store.ts        SQLite persistence via node:sqlite (data/launchlocal.db; migrates legacy data/store.json)
public/                 dashboard (/) and chat (/chat)
```

Generated sites land in `public/sites/`; leads, conversations, KB, and sequence enrollments persist in `data/launchlocal.db` (SQLite, zero extra dependencies — a legacy `data/store.json` is migrated automatically on first boot). Both are gitignored.

Note: the Stripe webhook can only be verified end-to-end once the server is reachable from Stripe (e.g. `stripe listen --forward-to localhost:3000/webhooks/stripe` for dev, and put the app behind a public URL like `https://YOURHOST/webhooks/stripe` in production). Without `STRIPE_WEBHOOK_SECRET` set, the endpoint returns 503 and never processes unsigned events.
