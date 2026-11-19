import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { app } from "../src/server.ts";

function mockRes() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.finished = false;
  res.headers = {};
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.getHeader = (k) => res.headers[k.toLowerCase()];
  res.writeHead = (code, headers) => {
    res.statusCode = code;
    if (headers) for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    return res;
  };
  res.body = "";
  res.write = (chunk) => { res.body += String(chunk); };
  res.end = (chunk) => {
    if (chunk) res.write(chunk);
    res.emit("finish");
    return res;
  };
  return res;
}

function mockReq(method, url, body) {
  const payload = body ? Buffer.from(JSON.stringify(body)) : Buffer.from("");
  const req = Readable.from([payload]);
  req.method = method;
  req.url = url;
  req.headers = body
    ? { "content-type": "application/json", "content-length": payload.length.toString() }
    : {};
  req.socket = { remoteAddress: "127.0.0.1" };
  return req;
}

function dispatch(method, url, body) {
  return new Promise((resolve) => {
    const res = mockRes();
    res.on("finish", () => resolve(res));
    app.handle(mockReq(method, url, body), res);
  });
}

const page = await dispatch("GET", "/");
assert.equal(page.statusCode, 200, "index.html is served");
assert.ok(page.body.includes("chat-form"), "index.html contains the chat UI");

const bad = await dispatch("POST", "/api/chat", {});
assert.equal(bad.statusCode, 400, "empty body is rejected with 400");

const chat = await dispatch("POST", "/api/chat", { messages: [{ role: "user", content: "hi" }] });
assert.ok(chat.statusCode >= 400 && chat.statusCode < 600, "chat endpoint responds without crashing");
assert.ok(JSON.parse(chat.body).error, "chat endpoint returns a structured error");

console.log("SMOKE_OK");
console.log("page:", page.statusCode);
console.log("validation:", bad.statusCode);
console.log("chat (dummy key):", chat.statusCode, chat.body.slice(0, 120));
process.exit(0);
