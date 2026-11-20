import { env } from "./config.ts";

export interface CheckoutResult {
  ok: boolean;
  url?: string;
  detail: string;
}

export function paymentsConfigured(): boolean {
  return Boolean(env("STRIPE_SECRET_KEY") || env("STRIPE_PAYMENT_LINK"));
}

export async function createCheckout(args: { productName: string; amountCents: number; leadId?: string; customerEmail?: string }): Promise<CheckoutResult> {
  const paymentLink = env("STRIPE_PAYMENT_LINK");
  const secretKey = env("STRIPE_SECRET_KEY");
  const baseUrl = env("BASE_URL") || "http://localhost:3000";

  if (!secretKey && paymentLink) {
    return { ok: true, url: paymentLink, detail: `using static STRIPE_PAYMENT_LINK for ${args.productName}` };
  }
  if (!secretKey) {
    return { ok: false, detail: "Stripe is not configured — set STRIPE_SECRET_KEY (or STRIPE_PAYMENT_LINK) in .env to issue real checkout links." };
  }

  const params = new URLSearchParams({
    mode: "payment",
    success_url: `${baseUrl}/?checkout=success`,
    cancel_url: `${baseUrl}/?checkout=cancel`,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(Math.max(args.amountCents, 50)),
    "line_items[0][price_data][product_data][name]": args.productName.slice(0, 120),
  });
  if (args.leadId) params.set("client_reference_id", args.leadId);
  if (args.customerEmail) params.set("customer_email", args.customerEmail);

  try {
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
      signal: AbortSignal.timeout(15000),
    });
    const data = (await res.json()) as { url?: string; error?: { message?: string } };
    if (!res.ok || !data.url) {
      return { ok: false, detail: `Stripe API error ${res.status}: ${data.error?.message ?? "no url returned"}` };
    }
    return { ok: true, url: data.url, detail: `checkout session created for ${args.productName}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : "stripe request failed" };
  }
}
