const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { FormulaAgent } = require("./src/agent/formula-agent");
const { ConversationStore } = require("./src/agent/conversation-store");
const { createProvider } = require("./src/providers");

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_BODY_BYTES = 12 * 1024 * 1024;
let providerConfig = {
  provider: String(process.env.AI_PROVIDER || "mock").toLowerCase(),
  baseUrl: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
  visionModel: process.env.VISION_MODEL || "qwen2.5vl:7b",
  codeModel: process.env.CODE_MODEL || "qwen2.5-coder:7b",
};
let agent = new FormulaAgent({ provider: createProvider(providerConfig) });
const conversations = new ConversationStore();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("上传内容不能超过 12 MB"), { statusCode: 413 }));
        req.destroy();
        return;
      }
      raw += chunk;
    });

    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error("请求内容不是有效的 JSON"), { statusCode: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res) {
  const pathname = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(PUBLIC_DIR, requested);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: "禁止访问" });
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(res, 404, { error: "页面不存在" });
      return;
    }
    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      status: "ok",
      provider: agent.provider.name,
      mode: agent.provider.mode,
      config: {
        provider: providerConfig.provider,
        baseUrl: agent.provider.baseUrl || providerConfig.baseUrl,
        visionModel: agent.provider.visionModel || providerConfig.visionModel,
        codeModel: agent.provider.codeModel || providerConfig.codeModel,
        connected: true,
      },
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/config") {
    try {
      const input = await readJson(req);
      const provider = String(input.provider || "mock").toLowerCase();
      if (!["mock", "open-source"].includes(provider)) {
        throw Object.assign(new Error("不支持的 Provider"), { statusCode: 400 });
      }
      const nextConfig = {
        provider,
        baseUrl: String(input.baseUrl || "http://127.0.0.1:11434").replace(/\/$/, ""),
        visionModel: String(input.visionModel || "qwen2.5vl:7b"),
        codeModel: String(input.codeModel || "qwen2.5-coder:7b"),
        name: String(input.name || "").trim(),
      };
      const nextProvider = createProvider(nextConfig);
      if (provider === "open-source") {
        const response = await fetch(`${nextProvider.baseUrl}/api/tags`, { signal: AbortSignal.timeout(4000) });
        if (!response.ok) throw new Error(`无法连接 Ollama：HTTP ${response.status}`);
      }
      agent = new FormulaAgent({ provider: nextProvider });
      providerConfig = nextConfig;
      sendJson(res, 200, {
        status: "ok",
        provider: agent.provider.name,
        mode: agent.provider.mode,
        config: nextConfig,
      });
    } catch (error) {
      sendJson(res, error.statusCode || 502, { error: error.message || "模型配置失败" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/convert") {
    try {
      const input = await readJson(req);
      const session = conversations.getOrCreate(input.sessionId);
      const conversation = conversations.toContext(session);
      // The web UI is agent-driven: never let a stale client or an old
      // session pin the implementation library. API integrations can still
      // call FormulaAgent directly with an explicit library when needed.
      const effectiveInput = { ...input, targetLibrary: "auto", conversation };
      const result = await agent.run(effectiveInput);
      conversations.record(session, { input: effectiveInput, result });
      result.session = {
        id: session.id,
        formula: session.formula,
        messageCount: session.messages.length,
        codeVersion: session.codeVersions.length,
        targetLibrary: session.targetLibrary,
        provider: session.provider,
      };
      sendJson(res, 200, result);
    } catch (error) {
      const statusCode = error.statusCode || 500;
      sendJson(res, statusCode, {
        error: error.message || "转换失败，请稍后重试",
        requestId: error.requestId,
      });
    }
    return;
  }

  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }

  sendJson(res, 405, { error: "不支持的请求方法" });
});

server.listen(PORT, HOST, () => {
  console.log(`Formula Code Agent 已启动：http://${HOST}:${PORT}`);
  console.log(`当前模型提供方：${agent.provider.name} (${agent.provider.mode})`);
});
