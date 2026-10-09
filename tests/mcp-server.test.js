const test = require("node:test");
const assert = require("node:assert/strict");
const { FormulaAgent } = require("../src/agent/formula-agent");
const { MockProvider } = require("../src/providers/mock-provider");
const { ConversationStore } = require("../src/agent/conversation-store");
const { TOOLS, dispatchMessage } = require("../mcp-server");

function testRuntime() {
  return {
    agent: new FormulaAgent({ provider: new MockProvider() }),
    conversations: new ConversationStore(),
  };
}

test("MCP initialize 和 tools/list 会返回已注册的数学公式工具", async () => {
  const runtime = testRuntime();
  const initialized = await dispatchMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05" },
  }, runtime);
  assert.equal(initialized.result.serverInfo.name, "formula-code-agent");

  const listed = await dispatchMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, runtime);
  assert.deepEqual(listed.result.tools, TOOLS);
  assert.equal(listed.result.tools[0].name, "formula_agent");
});

test("MCP formula_agent 可以复用现有 Agent 完成自由对话", async () => {
  const runtime = testRuntime();
  const response = await dispatchMessage({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "formula_agent", arguments: { inputType: "chat", prompt: "你好" } },
  }, runtime);
  assert.equal(response.result.isError, undefined);
  const payload = JSON.parse(response.result.content[0].text);
  assert.equal(payload.kind, "chat");
  assert.ok(payload.session.id);
});

test("MCP 通知不会产生响应", async () => {
  const response = await dispatchMessage({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  }, testRuntime());
  assert.equal(response, null);
});
