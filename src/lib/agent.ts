import { Mistral } from "@mistralai/mistralai";
import { config } from "./config.ts";
import { aiAvailable, aiText } from "./ai.ts";
import { bookingLink } from "./calendar.ts";
import { createCheckout } from "./payments.ts";
import { sendEmail, sendSms } from "./notify.ts";
import { searchKnowledge } from "./kb.ts";
import {
  CRM_STATUSES,
  getConversation,
  getKb,
  saveConversation,
  saveStore,
  updateLead,
  type Conversation,
  type CrmStatus,
  type Lead,
} from "./store.ts";

export interface AgentTurn {
  sessionId: string;
  message: string;
  leadId?: string;
  contact?: { email?: string; phone?: string };
  channel: "web" | "email" | "sms";
  history: { role: "user" | "assistant"; content: string }[];
}

export interface AgentResult {
  reply: string;
  engine: "mistral-tools" | "rules";
  toolsUsed: string[];
  leadId?: string;
}

const TOOL_DEFS = [
  {
    type: "function" as const,
    function: {
      name: "search_knowledge",
      description: "Search the business knowledge base: offer/pricing, FAQs, website audit results, and past conversation history. Use this FIRST when answering product or pricing questions.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "what to look up" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_lead_info",
      description: "Get the latest info on the current lead: business details, marketing-need score, audit findings, site preview link, CRM status, outreach history. Call before personalizing an offer.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "book_meeting",
      description: "Get the booking link for scheduling a kickoff call (Cal.com or Calendly, pre-filled with the contact). Give this link to the lead.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "send_email",
      description: "Send an email to the lead (e.g. to deliver a quote, audit, or recap). Use sparingly; leads may also be on chat.",
      parameters: {
        type: "object",
        properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } },
        required: ["to", "subject", "body"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "send_sms",
      description: "Send an SMS text to the lead. Keep under 300 chars, include STOP to opt out.",
      parameters: {
        type: "object",
        properties: { to: { type: "string" }, body: { type: "string" } },
        required: ["to", "body"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_crm_status",
      description: "Update the lead's CRM stage after meaningful progress.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: CRM_STATUSES },
          note: { type: "string", description: "short note about why" },
        },
        required: ["status"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_checkout",
      description: "Create a Stripe payment link when the lead agrees to buy. Only call this after an explicit yes.",
      parameters: {
        type: "object",
        properties: {
          product: { type: "string", enum: ["one_page_site", "five_page_site", "seo_monthly", "audit_report"] },
        },
        required: [],
      },
    },
  },
];

const PRODUCTS: Record<string, { name: string; amountCents: number }> = {
  one_page_site: { name: "Launch Pad one-page website", amountCents: 49700 },
  five_page_site: { name: "Full five-page website", amountCents: 149700 },
  seo_monthly: { name: "SEO Care — first month", amountCents: 29900 },
  audit_report: { name: "In-depth audit + action plan", amountCents: 9700 },
};

interface ToolState {
  lead?: Lead;
  contact?: { email?: string; phone?: string; name?: string };
  sessionId: string;
  toolsUsed: string[];
}

function leadSummary(lead: Lead): string {
  const audit = lead.audit;
  const auditLine = audit
    ? `Website audit last run: score ${audit.score}/100, ${audit.reachable ? "reachable" : "UNREACHABLE"}. Top fixes: ${audit.recommendations.slice(0, 3).join("; ") || "none"}.`
    : "No audit run yet.";
  const outreach = lead.outreach?.length ? `Outreach history: ${lead.outreach.map((o) => `${o.channel}->${o.to || "?"}${o.ok ? "" : " (failed)"}`).join(", ")}` : "No outreach yet.";
  return [
    `Lead: ${lead.name} (${lead.category}) in ${lead.city}`,
    lead.website ? `Website: ${lead.website} (free preview built at ${lead.siteUrl ?? "not yet"})` : "Website: none — biggest opportunity",
    lead.rating !== undefined ? `Google rating: ${lead.rating} from ${lead.reviews ?? 0} reviews` : "",
    `Marketing-need score: ${lead.score}/100. CRM status: ${lead.status}`,
    auditLine,
    `Contact: ${lead.phone ?? "no phone"}`,
    outreach,
  ]
    .filter(Boolean)
    .join("\n");
}

async function executeTool(name: string, args: any, state: ToolState): Promise<string> {
  state.toolsUsed.push(name);
  const lead = state.lead;

  switch (name) {
    case "search_knowledge": {
      const hits = await searchKnowledge(String(args.query ?? ""), { leadId: lead?.id, sessionId: state.sessionId }, 4);
      if (!hits.length) return "No matching knowledge found.";
      return hits.map((h) => `[${h.scope}] ${h.text}`).join("\n---\n");
    }
    case "get_lead_info": {
      if (!lead) return "No lead is associated with this conversation yet. Ask the customer to identify their business, or have them start the widget from a lead page.";
      return leadSummary(lead);
    }
    case "book_meeting": {
      const link = bookingLink({ name: lead?.name ?? state.contact?.name, email: state.contact?.email });
      if (!link) return "Booking link not configured — ask them to reply with 2-3 times and follow up manually. Also set BOOKING_URL in .env to enable self-serve booking.";
      if (lead) {
        updateLead(lead.id, {
          timeline: [
            ...(lead.timeline ?? []),
            { ts: new Date().toISOString(), event: "booking_link_shared", detail: link.url },
          ],
        });
        saveStore();
      }
      return `Booking link (${link.provider}): ${link.url}`;
    }
    case "send_email": {
      const to = String(args.to || state.contact?.email || lead?.outreach?.filter((o) => o.channel === "email").at(-1)?.to || "");
      if (!to) return "No email address known for this contact — ask them for their email first.";
      const outcome = await sendEmail(to, String(args.subject || "Launch Local 661"), String(args.body));
      if (lead) {
        updateLead(lead.id, {
          outreach: [...(lead.outreach ?? []), { channel: "email", to, sentAt: new Date().toISOString(), provider: outcome.provider, ok: outcome.ok, body: String(args.body) }],
        });
        saveStore();
      }
      return outcome.ok ? `Email sent to ${to}.` : `Email not sent: ${outcome.detail}`;
    }
    case "send_sms": {
      const to = String(args.to || state.contact?.phone || lead?.phone || "");
      if (!to) return "No mobile number known for this contact — ask first.";
      const outcome = await sendSms(to, String(args.body));
      if (lead) {
        updateLead(lead.id, {
          outreach: [...(lead.outreach ?? []), { channel: "sms", to, sentAt: new Date().toISOString(), provider: outcome.provider, ok: outcome.ok, body: String(args.body) }],
        });
        saveStore();
      }
      return outcome.ok ? `SMS sent to ${to}.` : `SMS not sent: ${outcome.detail}`;
    }
    case "set_crm_status": {
      if (!lead) return "No lead associated — cannot update CRM.";
      const status = String(args.status) as CrmStatus;
      if (!CRM_STATUSES.includes(status)) return `Invalid status. Choose one of: ${CRM_STATUSES.join(", ")}.`;
      updateLead(lead.id, {
        status,
        timeline: [
          ...(lead.timeline ?? []),
          { ts: new Date().toISOString(), event: "status_change", detail: `${lead.status} -> ${status}${args.note ? `: ${args.note}` : ""}` },
        ],
      });
      saveStore();
      return `CRM status for ${lead.name} set to ${status}.`;
    }
    case "create_checkout": {
      const product = String(args.product || "one_page_site");
      const p = PRODUCTS[product] ?? PRODUCTS.one_page_site;
      const result = await createCheckout({
        productName: p.name,
        amountCents: p.amountCents,
        leadId: lead?.id,
        customerEmail: state.contact?.email,
      });
      if (lead) {
        updateLead(lead.id, {
          timeline: [
            ...(lead.timeline ?? []),
            { ts: new Date().toISOString(), event: "checkout_shared", detail: result.ok ? `${p.name}: ${result.url}` : result.detail },
          ],
        });
        saveStore();
      }
      return result.ok ? `Payment link for ${p.name} ($${(p.amountCents / 100).toFixed(0)}): ${result.url}` : result.detail;
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

const SYSTEM_PROMPT = [
  "You are Jamie, the AI sales agent for Launch Local 661, a local marketing agency in Bakersfield, CA.",
  "You talk to owners of small local businesses who need websites, local SEO, or Google/Facebook ads.",
  "Always feel human, warm and brief. Use the search_knowledge tool to ground answers about services/pricing, and get_lead_info before pitching.",
  "Flow: understand their problem -> search knowledge -> personalize with their audit data -> propose one clear next step (book a call, or a specific offer price) -> get consent before creating any checkout.",
  "When the customer agrees to a next step, grant it: share the booking link, or create the checkout link, then confirm.",
  "Never invent prices — use only what search_knowledge or the offer says. Keep replies under 120 words unless they ask for detail.",
].join(" ");

export async function runAgent(turn: AgentTurn): Promise<AgentResult> {
  const store = await import("./store.ts");
  const conv: Conversation = getConversation(turn.sessionId);
  if (turn.leadId) conv.leadId = turn.leadId;
  if (turn.contact?.email) conv.contact = { ...conv.contact, email: turn.contact.email };
  if (turn.contact?.phone) conv.contact = { ...conv.contact, phone: turn.contact.phone };

  const lead = turn.leadId ? store.getLead(turn.leadId) : undefined;
  const state: ToolState = { lead, contact: { ...turn.contact, name: lead?.name }, sessionId: turn.sessionId, toolsUsed: [] };

  saveConversation(turn.sessionId, "user", turn.message);

  if (!aiAvailable()) {
    const reply = await rulesFallback(turn, state);
    saveConversation(turn.sessionId, "assistant", reply);
    saveStore();
    return { reply, engine: "rules", toolsUsed: state.toolsUsed, leadId: conv.leadId };
  }

  const client = new Mistral({ apiKey: config.mistralKey! });
  const prior = turn.history.slice(-8);
  const messages: any[] = [
    { role: "system", content: SYSTEM_PROMPT + (lead ? `\n\nCurrent lead context id: ${lead.id}` : "") },
    ...prior.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: turn.message },
  ];

  try {
    for (let i = 0; i < 6; i++) {
      const res: any = await client.chat.complete({
        model: "mistral-small-latest",
        messages,
        tools: TOOL_DEFS as any,
        toolChoice: "auto",
      });
      const message = res.choices?.[0]?.message;
      if (!message) break;
      messages.push({ role: "assistant", content: message.content ?? "", ...(message.toolCalls?.length ? { toolCalls: message.toolCalls } : {}) });
      const calls: any[] = message.toolCalls ?? [];
      if (!calls.length) {
        const reply = (message.content ?? "").toString().trim() || "Let me know what you'd like to know — pricing, timing, or your audit.";
        saveConversation(turn.sessionId, "assistant", reply);
        saveStore();
        return { reply, engine: "mistral-tools", toolsUsed: [...new Set(state.toolsUsed)], leadId: conv.leadId };
      }
      for (const call of calls) {
        const fnName = call.function?.name ?? "";
        let parsedArgs: any = {};
        try {
          parsedArgs = typeof call.function?.arguments === "string" ? JSON.parse(call.function.arguments) : call.function?.arguments ?? {};
        } catch {
          parsedArgs = {};
        }
        const toolResult = await executeTool(fnName, parsedArgs, state);
        messages.push({ role: "tool", name: fnName, content: toolResult });
      }
    }
    return { reply: "Sorry — I lost track there. Could you say that again?", engine: "mistral-tools", toolsUsed: state.toolsUsed, leadId: conv.leadId };
  } catch (err) {
    const fallback = await rulesFallback(turn, state);
    return { reply: fallback, engine: "rules", toolsUsed: state.toolsUsed, leadId: conv.leadId };
  }
}

async function rulesFallback(turn: AgentTurn, state: ToolState): Promise<string> {
  const text = turn.message.toLowerCase();
  const kb = getKb();
  const hits = (await searchKnowledge(turn.message, { leadId: state.lead?.id, sessionId: turn.sessionId }, 2)) ?? [];

  if (/\b(book|meeting|call|schedule|appointment|demo)\b/.test(text)) {
    const link = bookingLink({ email: turn.contact?.email });
    if (link) {
      state.toolsUsed.push("book_meeting");
      return `Great — grab a time here: ${link.url} (a kickoff call takes ~20 minutes). Anything specific you'd like covered?`;
    }
    return `Happy to set up a call — but booking isn't configured yet (BOOKING_URL missing in .env). Meanwhile, what's your website situation?`;
  }
  if (/\b(price|pricing|cost|how much|quote)\b/.test(text)) {
    const pricing = kb.faqs.filter((f) => /cost|much|price/i.test(f.q + f.a)).map((f) => f.a).join(" ");
    return `Here's the pricing picture: ${pricing || "a one-page Launch Pad site is $497 flat, and SEO Care is $299/month."}`;
  }
  if (/\b(pay|invoice|checkout|buy|sign up|get started|start now|purchase|stripe)\b/.test(text)) {
    const result = await createCheckout({ productName: PRODUCTS.one_page_site.name, amountCents: PRODUCTS.one_page_site.amountCents, leadId: state.lead?.id, customerEmail: turn.contact?.email });
    state.toolsUsed.push("create_checkout");
    return result.ok ? `You can pay securely here: ${result.url}` : `${result.detail} In the meantime, want me to walk you through what's included in Launch Pad?`;
  }
  if (hits.length) {
    return `${hits[0].text}`;
  }
  if (/\b(web site|website|site)\b/.test(text) && state.lead && !state.lead.website) {
    return `I checked — ${state.lead.name} doesn't have a website live, which makes it hard to rank or run ads. We can fix that fast: our Launch Pad one-page site is $497 flat and live within a week. Want the link to get started?`;
  }
  const generic = await aiText("You are a friendly local marketing sales rep. One short paragraph.", turn.message);
  if (generic) return generic;
  return `Thanks for reaching out! Quick options: reply "pricing" for our rates, "book" for a call link, or tell me about your business and I'll share free recommendations.`;
}

