import type { Request, Response } from "express";
import { Router } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getLead, saveStore, updateLead } from "../lib/store.ts";
import { enrollLead } from "../lib/sequences.ts";

export const webhooks = Router();

interface StripeSession {
  client_reference_id?: string;
  amount_total?: number;
  currency?: string;
  customer_details?: { email?: string };
}

interface StripeEvent {
  id?: string;
  type?: string;
  data?: { object?: StripeSession };
}

type SigParts = Record<string, string[]>;

function parseSignatureHeader(header: string): SigParts {
  const parts: SigParts = {};
  for (const segment of header.split(",")) {
    const eq = segment.indexOf("=");
    if (eq <= 0) continue;
    const key = segment.slice(0, eq).trim();
    const value = segment.slice(eq + 1).trim();
    if (!key || !value) continue;
    (parts[key] ??= []).push(value);
  }
  return parts;
}

export function verifyStripeSignature(rawBody: Buffer, header: string, secret: string, toleranceSec = 300): boolean {
  const parts = parseSignatureHeader(header);
  const t = parts.t?.[0];
  const signatures = parts.v1 ?? [];
  if (!t || signatures.length === 0) return false;
  const ts = Number(t);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody.toString("utf8")}`).digest("hex");
  return signatures.some((sig) => {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

function rawBody(req: Request): Buffer | undefined {
  return (req as Request & { rawBody?: Buffer }).rawBody;
}

webhooks.post("/stripe", (req: Request, res: Response) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    res.status(503).json({ error: "STRIPE_WEBHOOK_SECRET is not set; refusing to process unsigned webhooks." });
    return;
  }
  const raw = rawBody(req);
  const header = req.header("stripe-signature") ?? "";
  if (!raw || !verifyStripeSignature(raw, header, secret)) {
    res.status(400).json({ error: "Invalid or missing Stripe-Signature header." });
    return;
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(raw.toString("utf8")) as StripeEvent;
  } catch {
    res.status(400).json({ error: "Invalid JSON payload." });
    return;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data?.object ?? {};
    const leadId = session.client_reference_id;
    const lead = leadId ? getLead(leadId) : undefined;
    if (lead) {
      const amount = typeof session.amount_total === "number" ? `$${(session.amount_total / 100).toFixed(2)}` : "unknown amount";
      updateLead(lead.id, {
        status: "won",
        timeline: [
          ...(lead.timeline ?? []),
          { ts: new Date().toISOString(), event: "payment_received", detail: `Stripe checkout.session.completed: ${amount}${session.customer_details?.email ? ` (${session.customer_details.email})` : ""}` },
        ],
      });
      saveStore();
      enrollLead(lead.id, "onboarding");
    }
  }

  res.json({ received: true, type: event.type ?? "unknown" });
});
