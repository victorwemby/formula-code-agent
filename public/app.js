const state = {
  mode: "chat",
  image: null,
  busy: false,
  sessionId: null,
  currentFormula: "",
  quote: null,
};

const els = {
  conversation: document.querySelector("#conversation"),
  welcome: document.querySelector("#welcomePanel"),
  messages: document.querySelector("#messages"),
  imagePanel: document.querySelector("#imagePanel"),
  latexPanel: document.querySelector("#latexPanel"),
  latexInput: document.querySelector("#latexInput"),
  imageInput: document.querySelector("#imageInput"),
  uploadZone: document.querySelector("#uploadZone"),
  imagePreview: document.querySelector("#imagePreview"),
  previewImage: document.querySelector("#previewImage"),
  imageName: document.querySelector("#imageName"),
  imageMeta: document.querySelector("#imageMeta"),
  removeImage: document.querySelector("#removeImage"),
  promptRow: document.querySelector("#promptRow"),
  promptInput: document.querySelector("#promptInput"),
  sendButton: document.querySelector("#sendButton"),
  clearButton: document.querySelector("#clearButton"),
  newChatButton: document.querySelector("#newChatButton"),
  providerName: document.querySelector("#providerName"),
  providerMode: document.querySelector("#providerMode"),
  modelBadge: document.querySelector("#modelBadge"),
  toast: document.querySelector("#toast"),
  conversationContext: document.querySelector("#conversationContext"),
  currentFormula: document.querySelector("#currentFormula"),
  changeFormulaButton: document.querySelector("#changeFormulaButton"),
  quoteContext: document.querySelector("#quoteContext"),
  quotePreview: document.querySelector("#quotePreview"),
  clearQuoteButton: document.querySelector("#clearQuoteButton"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  closeSettingsButton: document.querySelector("#closeSettingsButton"),
  cancelSettingsButton: document.querySelector("#cancelSettingsButton"),
  settingsForm: document.querySelector("#settingsForm"),
  providerSelect: document.querySelector("#providerSelect"),
  modelNameInput: document.querySelector("#modelNameInput"),
  baseUrlInput: document.querySelector("#baseUrlInput"),
  visionModelInput: document.querySelector("#visionModelInput"),
  codeModelInput: document.querySelector("#codeModelInput"),
  settingsStatus: document.querySelector("#settingsStatus"),
};

document.querySelectorAll(".input-tab").forEach((tab) => {
  tab.addEventListener("click", () => setMode(tab.dataset.mode));
});

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".input-tab").forEach((tab) => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  els.imagePanel.hidden = mode !== "image";
  els.latexPanel.hidden = mode !== "latex";
  els.promptRow.hidden = mode === "image";
  if (mode === "chat") els.promptInput.focus();
  if (mode === "latex") els.latexInput.focus();
}

function hasActiveFormula() {
  return Boolean(state.sessionId && state.currentFormula);
}

function updateConversationContext() {
  const active = hasActiveFormula();
  els.conversationContext.hidden = !active;
  els.currentFormula.textContent = state.currentFormula;
  if (active) {
    els.imagePanel.hidden = state.mode !== "image";
    els.latexPanel.hidden = state.mode !== "latex";
    els.promptRow.hidden = state.mode === "image";
  } else {
    setMode(state.mode);
  }
}

function updateQuoteContext() {
  els.quoteContext.hidden = !state.quote;
  els.quotePreview.textContent = state.quote?.text || "";
}

function quoteMessage(text) {
  const value = String(text || "").trim();
  if (!value) return;
  state.quote = { text: value };
  updateQuoteContext();
  els.promptInput.focus();
}

function clearQuote() {
  state.quote = null;
  updateQuoteContext();
}

function quoteButton(text) {
  const encoded = encodeURIComponent(String(text || "").trim());
  return `<button class="quote-button" type="button" data-quote="${encoded}">引用</button>`;
}

function persistConversation() {
  if (hasActiveFormula()) {
    sessionStorage.setItem("formula-code-agent-session", JSON.stringify({
      sessionId: state.sessionId,
      currentFormula: state.currentFormula,
      targetLibrary: "auto",
    }));
  } else {
    sessionStorage.removeItem("formula-code-agent-session");
  }
}

function restoreConversation() {
  try {
    const saved = JSON.parse(sessionStorage.getItem("formula-code-agent-session") || "null");
    if (!saved?.sessionId || !saved?.currentFormula) return;
    state.sessionId = saved.sessionId;
    state.currentFormula = saved.currentFormula;
    els.promptInput.value = "输入任何数学或代码问题";
    updateConversationContext();
  } catch {
    sessionStorage.removeItem("formula-code-agent-session");
  }
}

els.uploadZone.addEventListener("click", () => els.imageInput.click());
els.imageInput.addEventListener("change", () => acceptImage(els.imageInput.files[0]));
els.removeImage.addEventListener("click", removeImage);

["dragenter", "dragover"].forEach((type) => {
  els.uploadZone.addEventListener(type, (event) => {
    event.preventDefault();
    els.uploadZone.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach((type) => {
  els.uploadZone.addEventListener(type, (event) => {
    event.preventDefault();
    els.uploadZone.classList.remove("dragging");
  });
});

els.uploadZone.addEventListener("drop", (event) => acceptImage(event.dataTransfer.files[0]));

function acceptImage(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) return showToast("请选择图片文件", true);
  if (file.size > 8 * 1024 * 1024) return showToast("图片不能超过 8 MB", true);

  const reader = new FileReader();
  reader.onload = () => {
    state.image = { name: file.name, mimeType: file.type, size: file.size, dataUrl: reader.result };
    els.previewImage.src = reader.result;
    els.imageName.textContent = file.name;
    els.imageMeta.textContent = `${formatSize(file.size)} · 已准备识别`;
    els.uploadZone.hidden = true;
    els.imagePreview.hidden = false;
  };
  reader.readAsDataURL(file);
}

function removeImage() {
  state.image = null;
  els.imageInput.value = "";
  els.previewImage.removeAttribute("src");
  els.imagePreview.hidden = true;
  els.uploadZone.hidden = false;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes > 1024 * 1024 ? 0 : 1)} KB`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function highlightPython(code) {
  const tokens = /(#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:import|from|as|def|return|if|else|for|in|class|True|False|None)\b|\b(?:print|split|simplify|parse_latex|quad)\b(?=\s*\())/g;
  let html = "";
  let cursor = 0;

  for (const match of code.matchAll(tokens)) {
    html += escapeHtml(code.slice(cursor, match.index));
    const token = match[0];
    let className = "code-keyword";
    if (token.startsWith("#")) className = "code-comment";
    else if (token.startsWith('"') || token.startsWith("'")) className = "code-string";
    else if (/^(print|split|simplify|parse_latex|quad)$/.test(token)) className = "code-function";
    html += `<span class="${className}">${escapeHtml(token)}</span>`;
    cursor = match.index + token.length;
  }

  return html + escapeHtml(code.slice(cursor));
}

function addUserMessage(payload) {
  els.welcome.hidden = true;
  const attachment = payload.inputType === "chat"
    ? ""
    : payload.followUp
    ? ""
    : payload.inputType === "image"
    ? `<div class="attachment-chip"><img src="${payload.image.dataUrl}" alt="公式图片缩略图"><span>${escapeHtml(payload.image.name)}</span></div>`
    : "";

  const messageText = payload.inputType === "latex"
    ? `${payload.latex}${payload.prompt ? `\n${payload.prompt}` : ""}`
    : payload.prompt;
  const quote = payload.quote?.text
    ? `<blockquote class="quoted-message">${escapeHtml(payload.quote.text)}</blockquote>`
    : "";
  // A message can itself contain a quote. Preserve that quoted source when
  // the whole message is quoted again, otherwise the model only receives the
  // follow-up question and loses the formula/code it refers to.
  const quoteableText = payload.quote?.text
    ? `${payload.quote.text}\n${messageText}`
    : messageText;
  els.messages.insertAdjacentHTML("beforeend", `
    <article class="message user">
      <div class="message-avatar">我</div>
      <div class="message-content">
        <p class="message-meta">你 · 刚刚 ${quoteButton(quoteableText)}</p>
        <div class="message-bubble">${quote}${attachment}${escapeHtml(messageText)}</div>
      </div>
    </article>`);
}

function addTyping() {
  els.messages.insertAdjacentHTML("beforeend", `
    <article class="message" id="typingMessage">
      <div class="message-avatar">ƒ</div>
      <div class="message-content">
        <p class="message-meta">Formula Agent · 正在处理</p>
        <div class="message-bubble typing"><span>正在识别与生成</span><span class="typing-dots"><i></i><i></i><i></i></span></div>
      </div>
    </article>`);
  scrollBottom();
}

function addAgentResult(result) {
  document.querySelector("#typingMessage")?.remove();
  if (result.kind === "chat") {
    els.messages.insertAdjacentHTML("beforeend", `
      <article class="message">
        <div class="message-avatar">ƒ</div>
        <div class="message-content">
          <p class="message-meta">Formula Agent · ${Math.max(result.durationMs, 1)}ms · ${escapeHtml(result.provider.name)} ${quoteButton(result.answer)}</p>
          <div class="message-bubble chat-answer">${escapeHtml(result.answer).replaceAll("\n", "<br>")}</div>
        </div>
      </article>`);
    scrollBottom();
    return;
  }
  const warnings = (result.warnings || []).map((item) => `<div class="warning">${escapeHtml(item)}</div>`).join("");
  const dependencies = result.dependencies?.length
    ? `<div class="dependencies">${result.dependencies.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>`
    : `<div class="dependencies"><span>仅标准库</span></div>`;
  const execution = result.execution || {};
  const executionStatus = execution.skippedForSafety
    ? "为保护本机，已跳过实际执行"
    : execution.attempted
    ? (execution.passed ? "已实际执行通过" : "执行失败")
    : "未实际执行";
  const executionOutput = execution.stdout
    ? `<pre class="execution-output">${escapeHtml(execution.stdout)}</pre>`
    : "";
  const mathematicalVerification = result.mathematicalVerification || {};
  const strategy = result.computationStrategy;
  const strategyPanel = strategy
    ? `<div class="execution passed"><strong>Agent 计算决策：${escapeHtml(strategy.mode === "symbolic" ? "符号计算" : strategy.mode === "numeric" ? "数值计算" : "混合计算")}</strong>${(strategy.reasons || []).map((reason) => `<span>${escapeHtml(reason)}</span>`).join("")}</div>`
    : "";
  const verificationStatus = mathematicalVerification.status === "verified"
    ? "数学结果已核对"
    : mathematicalVerification.status === "structural"
    ? "数学结构已检查，结果待人工确认"
    : "数学结果未核对";
  const verificationPanel = mathematicalVerification.details?.length
    ? `<div class="execution ${mathematicalVerification.status === "verified" ? "passed" : ""}"><strong>${verificationStatus}</strong>${mathematicalVerification.details.map((detail) => `<span>${escapeHtml(detail)}</span>`).join("")}</div>`
    : "";
  const correctionLog = (result.correctionLog || []);
  const correctionPanel = correctionLog.length > 1
    ? `<details class="correction-log" open>
        <summary>模型纠错过程（${correctionLog.filter((item) => item.type === "revision-request").length} 次）</summary>
        <ol>${correctionLog.map((item) => `<li class="${item.passed === false ? "failed" : item.passed === true ? "passed" : "requested"}"><strong>${escapeHtml(item.label)}</strong>${(item.details || []).map((detail) => `<p>${escapeHtml(detail)}</p>`).join("")}</li>`).join("")}</ol>
      </details>`
    : "";
  const trace = result.trace.map((item, index) => `${index ? "<i></i>" : ""}<span>${escapeHtml(item.step)}</span>`).join("");
  const encodedCode = encodeURIComponent(result.code);

  els.messages.insertAdjacentHTML("beforeend", `
    <article class="message">
      <div class="message-avatar">ƒ</div>
      <div class="message-content">
        <p class="message-meta">Formula Agent · ${Math.max(result.durationMs, 1)}ms · ${escapeHtml(result.provider.name)} ${quoteButton(`公式：${result.recognizedLatex}\n说明：${result.explanation}\n代码：\n${result.code}`)}</p>
        <div class="agent-card">
          <div class="agent-head">
            <div><h3>转换完成</h3><p>已生成可编辑的 Python 代码</p></div>
            <span class="confidence">识别置信度 ${Math.round(result.confidence * 100)}%</span>
          </div>
          <div class="recognized"><p class="section-label">识别出的 LaTeX</p><p class="latex-value">${escapeHtml(result.recognizedLatex)}</p></div>
          <div class="code-shell">
            <div class="code-top"><span>PYTHON</span><div class="code-actions"><button data-copy="${encodedCode}">复制代码</button><button data-download="${encodedCode}">下载 .py</button></div></div>
            <pre><code>${highlightPython(result.code)}</code></pre>
          </div>
          <div class="result-notes">
            <p>${escapeHtml(result.explanation)}</p>
            ${dependencies}${warnings}
            ${correctionPanel}
            ${strategyPanel}
            <div class="execution ${execution.passed ? "passed" : ""}"><strong>${executionStatus}</strong>${execution.safetyReason ? `<span>${escapeHtml(execution.safetyReason)}</span>` : ""}${executionOutput}</div>
            ${verificationPanel}
            <div class="trace">${trace}</div>
          </div>
        </div>
      </div>
    </article>`);

  bindResultActions();
  scrollBottom();
}

function addError(message) {
  document.querySelector("#typingMessage")?.remove();
  els.messages.insertAdjacentHTML("beforeend", `
    <article class="message">
      <div class="message-avatar">!</div>
      <div class="message-content"><p class="message-meta">Formula Agent · 未完成</p><div class="message-bubble">${escapeHtml(message)}</div></div>
    </article>`);
  scrollBottom();
}

function bindResultActions() {
  document.querySelectorAll("[data-copy]:not([data-bound])").forEach((button) => {
    button.dataset.bound = "true";
    button.addEventListener("click", async () => {
      await navigator.clipboard.writeText(decodeURIComponent(button.dataset.copy));
      showToast("代码已复制");
    });
  });

  document.querySelectorAll("[data-download]:not([data-bound])").forEach((button) => {
    button.dataset.bound = "true";
    button.addEventListener("click", () => {
      const blob = new Blob([decodeURIComponent(button.dataset.download)], { type: "text/x-python" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "formula.py";
      link.click();
      URL.revokeObjectURL(link.href);
    });
  });

  document.querySelectorAll("[data-quote]:not([data-bound])").forEach((button) => {
    button.dataset.bound = "true";
    button.addEventListener("click", () => quoteMessage(decodeURIComponent(button.dataset.quote)));
  });
}

async function sendRequest() {
  if (state.busy) return;
  const prompt = els.promptInput.value.trim();
  const payload = {
    inputType: state.mode,
    prompt,
    targetLibrary: "auto",
    sessionId: state.sessionId,
    quote: state.quote,
  };

  const followUp = hasActiveFormula() && state.mode === "chat";
  if (followUp) {
    if (!prompt) return showToast("请输入你的问题", true);
    payload.inputType = "chat";
    payload.followUp = true;
  } else if (state.mode === "chat") {
    if (!prompt) return showToast("请输入问题或要转换的 LaTeX 码", true);
    payload.inputType = "chat";
  } else if (state.mode === "latex") {
    const latex = els.latexInput.value.trim();
    if (!latex) return showToast("请输入 LaTeX 源码", true);
    payload.inputType = "latex";
    payload.latex = latex;
  } else if (state.mode === "image") {
    if (!state.image) return showToast("请先上传公式图片", true);
    payload.image = state.image;
  }

  state.busy = true;
  els.sendButton.disabled = true;
  addUserMessage(payload);
  addTyping();

  try {
    const response = await fetch("/api/convert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "转换请求失败");
    state.sessionId = result.session?.id || state.sessionId;
    state.currentFormula = result.session?.formula || result.recognizedLatex || state.currentFormula;
    persistConversation();
    updateConversationContext();
    clearQuote();
    if (hasActiveFormula()) els.promptInput.value = "输入任何数学或代码问题";
    addAgentResult(result);
  } catch (error) {
    addError(error.message);
  } finally {
    state.busy = false;
    els.sendButton.disabled = false;
  }
}

function clearConversation() {
  els.messages.innerHTML = "";
  els.welcome.hidden = false;
  removeImage();
  els.promptInput.value = "";
  els.latexInput.value = "";
  state.sessionId = null;
  state.currentFormula = "";
  clearQuote();
  persistConversation();
  updateConversationContext();
  setMode("chat");
  els.conversation.scrollTop = 0;
}

function startNewFormula() {
  state.sessionId = null;
  state.currentFormula = "";
  persistConversation();
  updateConversationContext();
  els.promptInput.value = "请帮我把这个数学公式转换为 Python 代码";
  els.latexInput.value = "";
  setMode("chat");
  showToast("可输入新的公式，之前的聊天记录仍保留");
}

function scrollBottom() {
  requestAnimationFrame(() => {
    els.conversation.scrollTop = els.conversation.scrollHeight;
  });
}

let toastTimer;
function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.toggle("error", isError);
  els.toast.classList.add("show");
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2200);
}

async function loadHealth() {
  try {
    const response = await fetch("/api/health");
    const health = await response.json();
    els.providerName.textContent = health.mode === "mock" ? "演示提供方" : "模型提供方";
    els.providerMode.textContent = health.provider;
    els.modelBadge.textContent = health.mode === "mock" ? "MOCK MODE" : "MODEL ONLINE";
    if (health.config) fillSettings(health.config);
  } catch {
    els.providerName.textContent = "服务离线";
    els.providerMode.textContent = "无法连接 Agent";
  }
}

function fillSettings(config = {}) {
  els.providerSelect.value = config.provider || "mock";
  els.modelNameInput.value = config.name || "";
  els.baseUrlInput.value = config.baseUrl || "http://127.0.0.1:11434";
  els.visionModelInput.value = config.visionModel || "qwen2.5vl:7b";
  els.codeModelInput.value = config.codeModel || "qwen2.5-coder:7b";
}

function setSettingsStatus(message, error = false) {
  els.settingsStatus.textContent = message;
  els.settingsStatus.classList.toggle("error", error);
}

async function saveModelSettings(event) {
  event.preventDefault();
  setSettingsStatus("正在检查模型连接...");
  const config = {
    provider: els.providerSelect.value,
    name: els.modelNameInput.value.trim(),
    baseUrl: els.baseUrlInput.value.trim(),
    visionModel: els.visionModelInput.value.trim(),
    codeModel: els.codeModelInput.value.trim(),
  };
  try {
    const response = await fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "模型连接失败");
    localStorage.setItem("formula-code-agent-provider", JSON.stringify(config));
    state.sessionId = null;
    state.currentFormula = "";
    persistConversation();
    updateConversationContext();
    setSettingsStatus("连接成功，模型配置已生效");
    els.providerName.textContent = result.mode === "mock" ? "演示提供方" : "模型提供方";
    els.providerMode.textContent = result.provider;
    els.modelBadge.textContent = result.mode === "mock" ? "MOCK MODE" : "MODEL ONLINE";
    setTimeout(() => els.settingsDialog.close(), 500);
  } catch (error) {
    setSettingsStatus(error.message, true);
  }
}

els.sendButton.addEventListener("click", sendRequest);
els.clearButton.addEventListener("click", clearConversation);
els.newChatButton.addEventListener("click", clearConversation);
els.changeFormulaButton.addEventListener("click", startNewFormula);
els.clearQuoteButton.addEventListener("click", clearQuote);
els.settingsButton.addEventListener("click", () => els.settingsDialog.showModal());
els.closeSettingsButton.addEventListener("click", () => els.settingsDialog.close());
els.cancelSettingsButton.addEventListener("click", () => els.settingsDialog.close());
els.settingsForm.addEventListener("submit", saveModelSettings);
document.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key === "Enter") sendRequest();
});

loadHealth();
restoreConversation();
