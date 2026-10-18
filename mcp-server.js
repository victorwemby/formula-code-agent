const readline = require("node:readline");
const { FormulaAgent } = require("./src/agent/formula-agent");
const { ConversationStore } = require("./src/agent/conversation-store");
const { createProvider } = require("./src/providers");

const SERVER_NAME = "formula-code-agent";
const SERVER_VERSION = "0.1.0";
const DEFAULT_PROTOCOL_VERSION = "2024-11-05";
const SUPPORTED_PROTOCOL_VERSIONS = new Set([
  "2024-11-05",
  "2025-03-26",
  "2025-06-18",
]);

const TOOLS = [
  {
    name: "formula_agent",
    description:
      "数学公式对话式 Agent。可以接收 LaTeX、公式图片或自然语言，进行公式识别、自由讨论、代码生成、静态检查、受限执行、自动纠错和计算策略决策。使用 sessionId 可以延续同一会话。",
    inputSchema: {
      type: "object",
      properties: {
        inputType: {
          type: "string",
          enum: ["latex", "image", "chat"],
          description: "输入类型。不填时根据 latex、image 或 prompt 自动判断。",
        },
        latex: {
          type: "string",
          description: "要分析或转换的 LaTeX 源码。",
        },
        prompt: {
          type: "string",
          description: "自然语言要求，例如解释公式、转换为 Python 或修正代码。",
        },
        targetLibrary: {
          type: "string",
          enum: ["auto", "SymPy", "NumPy", "纯 Python"],
          description: "生成代码的目标库；默认由 Agent 根据公式自动决策。",
        },
        image: {
          type: "object",
          description: "公式图片。dataUrl 必须是 data:image/... 格式。",
          properties: {
            name: { type: "string" },
            mimeType: { type: "string" },
            dataUrl: { type: "string" },
          },
          required: ["dataUrl"],
          additionalProperties: false,
        },
        sessionId: {
          type: "string",
          description: "可选会话 ID。复用上一次返回的 session.id 可继续上下文。",
        },
        quote: {
          type: "object",
          description: "可选的历史消息或代码引用。",
          properties: { text: { type: "string" } },
          required: ["text"],
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
];

function createRuntime({ provider, env = process.env } = {}) {
  const config = {
    provider: String(env.AI_PROVIDER || "mock").toLowerCase(),
    baseUrl: env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
    visionModel: env.VISION_MODEL || "qwen2.5vl:7b",
    codeModel: env.CODE_MODEL || "qwen2.5-coder:7b",
  };

  return {
    agent: new FormulaAgent({ provider: provider || createProvider(config) }),
    conversations: new ConversationStore(),
  };
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message, data) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

function isNotification(message) {
  return !Object.prototype.hasOwnProperty.call(message, "id");
}

function inferInputType(args) {
  if (args.inputType) return args.inputType;
  if (args.image) return "image";
  if (args.latex) return "latex";
  return "chat";
}

function normalizeToolArguments(args = {}) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw Object.assign(new Error("formula_agent 的 arguments 必须是 JSON 对象"), { statusCode: 400 });
  }

  const inputType = inferInputType(args);
  if (!["latex", "image", "chat"].includes(inputType)) {
    throw Object.assign(new Error("inputType 必须是 latex、image 或 chat"), { statusCode: 400 });
  }

  if (inputType === "image") {
    const dataUrl = String(args.image?.dataUrl || "");
    if (dataUrl.length > 16 * 1024 * 1024) {
      throw Object.assign(new Error("公式图片数据不能超过 12 MB"), { statusCode: 413 });
    }
  }

  return {
    inputType,
    ...(args.latex === undefined ? {} : { latex: String(args.latex) }),
    ...(args.prompt === undefined ? {} : { prompt: String(args.prompt) }),
    ...(args.targetLibrary === undefined ? {} : { targetLibrary: String(args.targetLibrary) }),
    ...(args.image === undefined ? {} : { image: args.image }),
    ...(args.sessionId === undefined ? {} : { sessionId: String(args.sessionId) }),
    ...(args.quote === undefined ? {} : { quote: args.quote }),
  };
}

async function runFormulaTool(args, runtime) {
  const input = normalizeToolArguments(args);
  const session = runtime.conversations.getOrCreate(input.sessionId);
  const effectiveInput = {
    ...input,
    conversation: runtime.conversations.toContext(session),
  };
  const result = await runtime.agent.run(effectiveInput);
  runtime.conversations.record(session, { input: effectiveInput, result });
  result.session = {
    id: session.id,
    formula: session.formula,
    messageCount: session.messages.length,
    codeVersion: session.codeVersions.length,
    targetLibrary: session.targetLibrary,
    provider: session.provider,
  };
  return result;
}

function toolText(result) {
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
  };
}

async function dispatchMessage(message, runtime) {
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return rpcError(null, -32600, "无效的 JSON-RPC 请求");
  }

  const notification = isNotification(message);
  const id = message.id;
  const respond = (result) => (notification ? null : rpcResult(id, result));

  if (message.method === "notifications/initialized") return null;
  if (message.method === "ping") return respond({});

  if (message.method === "initialize") {
    const requested = message.params?.protocolVersion;
    const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.has(requested)
      ? requested
      : DEFAULT_PROTOCOL_VERSION;
    return respond({
      protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions: "调用 formula_agent 处理 LaTeX、公式图片或数学问题；复用返回的 session.id 可继续对话。",
    });
  }

  if (message.method === "tools/list") {
    return respond({ tools: TOOLS });
  }

  if (message.method === "tools/call") {
    const name = message.params?.name;
    if (name !== "formula_agent") {
      return notification ? null : rpcError(id, -32602, `未注册的工具：${name || "(空)"}`);
    }

    try {
      const result = await runFormulaTool(message.params?.arguments || {}, runtime);
      return respond(toolText(result));
    } catch (error) {
      const details = { error: error.message || "公式 Agent 调用失败", requestId: error.requestId };
      return respond({
        content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
        structuredContent: details,
        isError: true,
      });
    }
  }

  return notification ? null : rpcError(id, -32601, `不支持的方法：${message.method}`);
}

function startStdioServer(runtime = createRuntime()) {
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let queue = Promise.resolve();

  input.on("line", (line) => {
    if (!line.trim()) return;
    queue = queue.then(async () => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        process.stdout.write(`${JSON.stringify(rpcError(null, -32700, "消息不是有效的 JSON"))}\n`);
        return;
      }
      const response = await dispatchMessage(message, runtime);
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    }).catch((error) => {
      process.stdout.write(`${JSON.stringify(rpcError(null, -32603, error.message || "MCP Server 内部错误"))}\n`);
    });
  });

  return input;
}

if (require.main === module) startStdioServer();

module.exports = {
  TOOLS,
  createRuntime,
  dispatchMessage,
  normalizeToolArguments,
  runFormulaTool,
  startStdioServer,
};
