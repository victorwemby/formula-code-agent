(() => {
  if (window.top !== window || document.querySelector("#formula-code-agent-trigger")) return;

  const trigger = document.createElement("button");
  trigger.id = "formula-code-agent-trigger";
  trigger.type = "button";
  trigger.textContent = "ƒ  转为 Python";
  trigger.setAttribute("aria-label", "将选中的 LaTeX 转为 Python");
  document.documentElement.appendChild(trigger);

  let selectedLatex = "";
  let hideTimer;

  function getEditableSelection() {
    const active = document.activeElement;
    if (!active || !["TEXTAREA", "INPUT"].includes(active.tagName)) return "";
    if (typeof active.selectionStart !== "number" || typeof active.selectionEnd !== "number") return "";
    return active.value.slice(active.selectionStart, active.selectionEnd).trim();
  }

  function getSelectionText() {
    return getEditableSelection() || String(window.getSelection()?.toString() || "").trim();
  }

  function looksLikeFormula(text) {
    if (!text || text.length < 2 || text.length > 12000) return false;
    return /\\[a-zA-Z]+|[\^_=]|\$[^$]+\$|\\\(|\\\)|\\\[|\\\]/.test(text);
  }

  function hideTrigger(delay = 0) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      trigger.classList.remove("formula-code-agent-visible");
    }, delay);
  }

  function positionTrigger(event) {
    const text = getSelectionText();
    if (!looksLikeFormula(text)) {
      selectedLatex = "";
      hideTrigger();
      return;
    }

    selectedLatex = text;
    const maxLeft = window.innerWidth - 150;
    const maxTop = window.innerHeight - 48;
    trigger.style.left = `${Math.max(10, Math.min(event.clientX + 10, maxLeft))}px`;
    trigger.style.top = `${Math.max(10, Math.min(event.clientY + 12, maxTop))}px`;
    trigger.classList.add("formula-code-agent-visible");
  }

  document.addEventListener("mouseup", (event) => {
    if (event.target === trigger) return;
    setTimeout(() => positionTrigger(event), 0);
  });

  document.addEventListener("keyup", (event) => {
    if (!event.shiftKey) return;
    const rect = document.activeElement?.getBoundingClientRect?.();
    positionTrigger({
      clientX: rect ? Math.min(rect.right, window.innerWidth - 160) : window.innerWidth / 2,
      clientY: rect ? Math.min(rect.bottom, window.innerHeight - 50) : window.innerHeight / 2,
    });
  });

  document.addEventListener("mousedown", (event) => {
    if (event.target !== trigger) hideTrigger(80);
  });

  trigger.addEventListener("mousedown", (event) => event.preventDefault());
  trigger.addEventListener("click", async () => {
    if (!selectedLatex) return;
    trigger.classList.add("formula-code-agent-opening");
    try {
      await chrome.runtime.sendMessage({
        type: "OPEN_FORMULA_PANEL",
        latex: selectedLatex,
        sourceUrl: location.href,
      });
    } finally {
      trigger.classList.remove("formula-code-agent-opening");
      hideTrigger(350);
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "GET_FORMULA_SELECTION") {
      sendResponse({ latex: getSelectionText(), sourceUrl: location.href });
    }
  });
})();

