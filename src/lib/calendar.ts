import { env } from "./config.ts";

export function calendarProvider(): "cal.com" | "calendly" | null {
  const url = env("BOOKING_URL");
  if (!url) return null;
  if (url.includes("cal.com")) return "cal.com";
  if (url.includes("calendly.com")) return "calendly";
  return "cal.com";
}

export function bookingLink(contact?: { name?: string; email?: string }): { provider: string; url: string } | null {
  const base = env("BOOKING_URL");
  if (!base) return null;
  const provider = calendarProvider() ?? "cal.com";
  try {
    const url = new URL(base);
    if (contact?.name) url.searchParams.set("name", contact.name);
    if (contact?.email) url.searchParams.set("email", contact.email);
    return { provider, url: url.toString() };
  } catch {
    return { provider, url: base };
  }
}
