import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express, { type Request, type Response } from "express";
import { Mistral } from "@mistralai/mistralai";
import { api } from "./routes/api.ts";
import { webhooks } from "./routes/webhooks.ts";
import { config } from "./lib/config.ts";
import { reindexAll } from "./lib/kb.ts";
import { tickSequences } from "./lib/sequences.ts";
import { tickReports } from "./lib/reports.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const app = express();

const MODEL = "mistral-small-latest";
let chatClient: Mistral | null = config.mistralKey ? new Mistral({ apiKey: config.mistralKey }) : null;

app.use(
  express.json({
    verify: (req: Request, _res: Response, buf: Buffer) => {
      (req as Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "..", "public")));

await reindexAll();

app.use("/api", api);
app.use("/webhooks", webhooks);

if (fs.existsSync(path.join(__dirname, "..", "public", "chat.html"))) {
  app.get("/chat", (_req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, "..", "public", "chat.html"));
  });
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

app.post("/api/chat", async (req: Request, res: Response) => {
  if (!chatClient) {
    res.status(503).json({ error: "MISTRAL_API_KEY is not set. Copy .env.example to .env and add your key." });
    return;
  }
  const messages = req.body?.messages as ChatMessage[] | undefined;
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "Request body must include a non-empty 'messages' array." });
    return;
  }
  if (messages.some((m) => !m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string")) {
    res.status(400).json({ error: "Each message needs a 'role' of 'user' or 'assistant' and string 'content'." });
    return;
  }

  try {
    const response = await chatClient.chat.complete({
      model: MODEL,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });

    const raw = response.choices?.[0]?.message?.content ?? "";
    const reply =
      typeof raw === "string"
        ? raw
        : raw.map((chunk) => (chunk.type === "text" ? chunk.text : "")).join("");

    res.json({ reply });
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode;
    console.error("Mistral API error:", status ?? (err instanceof Error ? err.message : err));
    const httpStatus = status && status >= 400 && status < 600 ? status : 500;
    res.status(httpStatus).json({ error: "Failed to get a response from the Mistral API." });
  }
});

app.use((req: Request, res: Response) => {
  if (req.path.startsWith("/api/")) {
    res.status(404).json({ error: "Unknown API route" });
    return;
  }
  res.status(404).send("Not found");
});

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  void tickSequences();
  const schedulerTimer = setInterval(() => {
    void tickSequences();
    void tickReports();
  }, 60_000);
  schedulerTimer.unref();
  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, () => {
    console.log(`launchlocal listening on http://localhost:${PORT}`);
    console.log(`  dashboard:    http://localhost:${PORT}/`);
    console.log(`  chat app:     http://localhost:${PORT}/chat`);
    console.log(`  integrations: mistral=${Boolean(config.mistralKey)} places=${Boolean(config.placesKey)} twilio=${Boolean(config.twilio.sid)} smtp=${Boolean(config.smtp.host)} stripeWebhook=${Boolean(process.env.STRIPE_WEBHOOK_SECRET)}`);
  });
}
