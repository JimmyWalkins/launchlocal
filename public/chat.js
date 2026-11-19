const chatEl = document.getElementById("chat");
const formEl = document.getElementById("chat-form");
const inputEl = document.getElementById("chat-input");
const sendEl = document.getElementById("send");
const bannerEl = document.getElementById("banner");

const leadId = new URLSearchParams(location.search).get("leadId") || undefined;
const sessionIdKey = "launchlocal-session";

function getSessionId() {
  let id = localStorage.getItem(sessionIdKey);
  if (!id) {
    id = `w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(sessionIdKey, id);
  }
  return id;
}

function addBubble(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.innerHTML = String(text).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
  return div;
}

fetch("/api/status")
  .then((r) => r.json())
  .then((s) => {
    const k = s.knowledge;
    bannerEl.textContent = leadId
      ? `Connected to lead context ${leadId.slice(0, 8)} · knowledge: ${k.chunks} chunks (${k.mode})`
      : `Assistant ready · knowledge: ${k.chunks} chunks (${k.mode})`;
  })
  .catch(() => { bannerEl.textContent = "Assistant starting…"; });

addBubble(
  "assistant",
  `Hi! I'm Jamie from Launch Local 661. I can answer questions about our websites, SEO and ad services${leadId ? ", and I already know a bit about your business" : ""}. Want pricing, a free audit, or to book a call?`,
);

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;

  inputEl.value = "";
  sendEl.disabled = true;
  addBubble("user", text);
  const pending = addBubble("assistant", "…");

  try {
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: getSessionId(), leadId, message: text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    pending.innerHTML = String(data.reply).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  } catch (err) {
    pending.innerHTML = err instanceof Error ? err.message : "Something went wrong.";
    pending.classList.add("error");
  } finally {
    sendEl.disabled = false;
    inputEl.focus();
  }
});
