const state = {
  mode: "latex",
  image: null,
  busy: false,
  serverUrl: "http://127.0.0.1:4173",
};

const els = {
  statusDot: document.querySelector("#statusDot"),
  statusText: document.querySelector("#statusText"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  serverUrlInput: document.querySelector("#serverUrlInput"),
  saveSettingsButton: document.querySelector("#saveSettingsButton"),
  readSelectionButton: document.querySelector("#readSelectionButton"),
  latexPanel: document.querySelector("#latexPanel"),
  latexInput: document.querySelector("#latexInput"),
  sourceInfo: document.querySelector("#sourceInfo"),
  imagePanel: document.querySelector("#imagePanel"),
  imageInput: document.querySelector("#imageInput"),
  uploadButton: document.querySelector("#uploadButton"),
  imagePreview: document.querySelector("#imagePreview"),
  previewImage: document.querySelector("#previewImage"),
  imageName: document.querySelector("#imageName"),
  imageMeta: document.querySelector("#imageMeta"),
  removeImageButton: document.querySelector("#removeImageButton"),
  promptInput: document.querySelector("#promptInput"),
  librarySelect: document.querySelector("#librarySelect"),
  convertButton: document.querySelector("#convertButton"),
  resultSection: document.querySelector("#resultSection"),
  emptyState: document.querySelector("#emptyState"),
  confidenceBadge: document.querySelector("#confidenceBadge"),
  recognizedLatex: document.querySelector("#recognizedLatex"),
  pythonCode: document.querySelector("#pythonCode"),
  explanation: document.querySelector("#explanation"),
  dependencies: document.querySelector("#dependencies"),
  warnings: document.querySelector("#warnings"),
  trace: document.querySelector("#trace"),
  copyButton: document.querySelector("#copyButton"),
  toast: document.querySelector("#toast"),
};

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => setMode(tab.dataset.mode));
});

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".tab").forEach((tab) => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  els.latexPanel.hidden = mode !== "latex";
  els.imagePanel.hidden = mode !== "image";
}

function normalizeServerUrl(value) {
  return String(value || "http://127.0.0.1:4173").trim().replace(/\/+$/, "");
}

async function checkHealth() {
  els.statusDot.className = "";
  els.statusText.textContent = "连接 Agent...";
  try {
    const response = await fetch(`${state.serverUrl}/api/health`);
    if (!response.ok) throw new Error("offline");
    const health = await response.json();
    els.statusDot.className = "online";
    els.statusText.textContent = `${health.provider} · ${health.mode}`;
    return true;
  } catch {
    els.statusDot.className = "offline";
    els.statusText.textContent = "后端未启动";
    return false;
  }
}

async function loadSettings() {
  const stored = await chrome.storage.local.get("serverUrl");
  state.serverUrl = normalizeServerUrl(stored.serverUrl);
  els.serverUrlInput.value = state.serverUrl;
  await checkHealth();
}

async function consumePendingFormula() {
  const stored = await chrome.storage.session.get("pendingFormula");
  const pending = stored.pendingFormula;
  if (!pending?.latex) return;
  applySelection(pending.latex, pending.sourceUrl);
  await chrome.storage.session.remove("pendingFormula");
}

function applySelection(latex, sourceUrl = "") {
  setMode("latex");
  els.latexInput.value = String(latex || "").trim();
  if (sourceUrl) {
    els.sourceInfo.textContent = `来自：${sourceUrl}`;
    els.sourceInfo.hidden = false;
  }
}

async function readCurrentSelection() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("没有可读取的页面");
    const result = await chrome.tabs.sendMessage(tab.id, { type: "GET_FORMULA_SELECTION" });
    if (!result?.latex) throw new Error("请先在页面中选中 LaTeX");
    applySelection(result.latex, result.sourceUrl);
    showToast("已读取当前选区");
  } catch (error) {
    showToast(error.message || "无法读取当前页面", true);
  }
}

els.uploadButton.addEventListener("click", () => els.imageInput.click());
els.imageInput.addEventListener("change", () => acceptImage(els.imageInput.files[0]));
els.removeImageButton.addEventListener("click", removeImage);

function acceptImage(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) return showToast("请选择图片文件", true);
  if (file.size > 8 * 1024 * 1024) return showToast("图片不能超过 8 MB", true);
  const reader = new FileReader();
  reader.onload = () => {
    state.image = { name: file.name, mimeType: file.type, dataUrl: reader.result };
    els.previewImage.src = reader.result;
    els.imageName.textContent = file.name;
    els.imageMeta.textContent = `${Math.ceil(file.size / 1024)} KB`;
    els.uploadButton.hidden = true;
    els.imagePreview.hidden = false;
  };
  reader.readAsDataURL(file);
}

function removeImage() {
  state.image = null;
  els.imageInput.value = "";
  els.previewImage.removeAttribute("src");
  els.uploadButton.hidden = false;
  els.imagePreview.hidden = true;
}

async function convertFormula() {
  if (state.busy) return;
  const payload = {
    inputType: state.mode,
    prompt: els.promptInput.value.trim(),
    targetLibrary: els.librarySelect.value,
  };

  if (state.mode === "latex") {
    payload.latex = els.latexInput.value.trim();
    if (!payload.latex) return showToast("请输入或选中 LaTeX", true);
  } else {
    if (!state.image) return showToast("请先上传公式图片", true);
    payload.image = state.image;
  }

  state.busy = true;
  els.convertButton.disabled = true;
  els.convertButton.querySelector("span").textContent = "Agent 正在转换...";

  try {
    const response = await fetch(`${state.serverUrl}/api/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "转换失败");
    renderResult(result);
  } catch (error) {
    showToast(error.message || "无法连接 Agent 后端", true);
  } finally {
    state.busy = false;
    els.convertButton.disabled = false;
    els.convertButton.querySelector("span").textContent = "转换为 Python";
  }
}

function renderResult(result) {
  els.emptyState.hidden = true;
  els.resultSection.hidden = false;
  els.confidenceBadge.textContent = `${Math.round((result.confidence || 0) * 100)}%`;
  els.recognizedLatex.textContent = result.recognizedLatex || "";
  els.pythonCode.textContent = result.code || "";
  els.explanation.textContent = result.explanation || "";
  els.dependencies.innerHTML = "";
  (result.dependencies || []).forEach((dependency) => {
    const tag = document.createElement("span");
    tag.textContent = dependency;
    els.dependencies.appendChild(tag);
  });
  els.warnings.innerHTML = "";
  (result.warnings || []).forEach((warning) => {
    const item = document.createElement("div");
    item.className = "warning";
    item.textContent = warning;
    els.warnings.appendChild(item);
  });
  els.trace.innerHTML = "";
  (result.trace || []).forEach((step) => {
    const item = document.createElement("span");
    item.textContent = step.step;
    els.trace.appendChild(item);
  });
  els.resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

let toastTimer;
function showToast(message, error = false) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.toggle("error", error);
  els.toast.classList.add("show");
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2200);
}

els.copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(els.pythonCode.textContent);
  showToast("Python 代码已复制");
});

els.convertButton.addEventListener("click", convertFormula);
els.readSelectionButton.addEventListener("click", readCurrentSelection);
els.settingsButton.addEventListener("click", () => els.settingsDialog.showModal());
els.saveSettingsButton.addEventListener("click", async (event) => {
  event.preventDefault();
  state.serverUrl = normalizeServerUrl(els.serverUrlInput.value);
  await chrome.storage.local.set({ serverUrl: state.serverUrl });
  els.settingsDialog.close();
  await checkHealth();
  showToast("设置已保存");
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.pendingFormula?.newValue) {
    const pending = changes.pendingFormula.newValue;
    applySelection(pending.latex, pending.sourceUrl);
    chrome.storage.session.remove("pendingFormula");
  }
});

document.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key === "Enter") convertFormula();
});

Promise.all([loadSettings(), consumePendingFormula()]);

