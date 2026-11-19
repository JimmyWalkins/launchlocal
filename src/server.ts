import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Request, type Response } from "express";
import { Mistral } from "@mistralai/mistralai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const app = express();

const apiKey = process.env.MISTRAL_API_KEY;
if (!apiKey) {
  console.error("MISTRAL_API_KEY is not set. Copy .env.example to .env and add your key.");
  process.exit(1);
}

const client = new Mistral({ apiKey });
const MODEL = "mistral-small-latest";

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

app.post("/api/chat", async (req: Request, res: Response) => {
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
    const response = await client.chat.complete({
      model: MODEL,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });

    const raw = response.choices?.[0]?.message?.content ?? "";
    const reply =
      typeof raw === "string"
        ? raw
        : raw.map((chunk) => (chunk.type === "text" ? chunk.text : "")).join("");

    res.json({ reply });
  } catch (err: any) {
    console.error("Mistral API error:", err?.statusCode ?? err?.message ?? err);
    const status = err?.statusCode >= 400 && err?.statusCode < 600 ? err.statusCode : 500;
    res.status(status).json({ error: "Failed to get a response from the Mistral API." });
  }
});

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, () => {
    console.log(`Chat app listening on http://localhost:${PORT} (model: ${MODEL})`);
  });
}
