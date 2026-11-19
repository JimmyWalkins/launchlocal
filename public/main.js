const chatEl = document.getElementById("chat");
const formEl = document.getElementById("chat-form");
const inputEl = document.getElementById("chat-input");
const sendEl = document.getElementById("send");
const modelEl = document.getElementById("model");
modelEl.textContent = "mistral-small-latest";

const messages = [{ role: "user", content: "Hello! Who are you?" }];

function addBubble(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
  return div;
}

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;

  inputEl.value = "";
  sendEl.disabled = true;
  addBubble("user", text);
  const pending = addBubble("assistant", "…");

  messages.push({ role: "user", content: text });
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    messages.push({ role: "assistant", content: data.reply });
    pending.textContent = data.reply;
  } catch (err) {
    pending.classList.remove("assistant");
    pending.classList.add("error");
    pending.textContent = err instanceof Error ? err.message : "Something went wrong.";
  } finally {
    sendEl.disabled = false;
    inputEl.focus();
  }
});
