export function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export const config = {
  mistralKey: env("MISTRAL_API_KEY"),
  placesKey: env("GOOGLE_PLACES_API_KEY"),
  twilio: {
    sid: env("TWILIO_ACCOUNT_SID"),
    token: env("TWILIO_AUTH_TOKEN"),
    from: env("TWILIO_FROM"),
  },
  smtp: {
    host: env("SMTP_HOST"),
    port: Number(env("SMTP_PORT") || 587),
    user: env("SMTP_USER"),
    pass: env("SMTP_PASS"),
    from: env("SMTP_FROM"),
  },
};

export function hasTwilio(): boolean {
  return Boolean(config.twilio.sid && config.twilio.token && config.twilio.from);
}

export function hasSmtp(): boolean {
  return Boolean(config.smtp.host && config.smtp.from);
}

export function hasPlaces(): boolean {
  return Boolean(config.placesKey);
}
