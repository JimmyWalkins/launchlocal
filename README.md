# Mistral Chat App

A minimal web chat app built with the official [Mistral TypeScript SDK](https://github.com/mistralai/client-js) (`@mistralai/mistralai`). The browser talks to a small Express server, and the API key never leaves the server.

## Features

- Simple single-page chat interface (vanilla JS, no build step for the frontend)
- Model: `mistral-small-latest`
- `MISTRAL_API_KEY` is read on the server only
- Conversation history is kept client-side and sent with each request

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Add your Mistral API key**

   Get a key at <https://console.mistral.ai/api-keys/>, then:

   ```bash
   cp .env.example .env
   # edit .env and set MISTRAL_API_KEY=...
   ```

3. **Run the app**

   ```bash
   npm run dev   # dev server with auto-reload (tsx watch)
   # or
   npm start     # plain run
   ```

4. **Open <http://localhost:3000>** and start chatting.

   Set a different port with `PORT=8080` in `.env` or the shell.

## Project structure

```
src/server.ts       Express server + Mistral API call (POST /api/chat)
public/index.html   Chat UI (styles included)
public/main.js      Chat logic (client)
scripts/smoke.mjs   In-process smoke test (needs MISTRAL_API_KEY set)
```

## Smoke test

```bash
MISTRAL_API_KEY=... node scripts/smoke.mjs
```

Checks that the index page is served, malformed requests return `400`, and the chat endpoint calls the Mistral API and handles errors (e.g. `401` with an invalid key).

## API

`POST /api/chat` with JSON body:

```json
{ "messages": [ { "role": "user", "content": "Hello!" } ] }
```

Response: `{ "reply": "..." }` or `{ "error": "..." }` with an appropriate status code.
