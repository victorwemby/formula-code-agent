const crypto = require("node:crypto");

class ConversationStore {
  constructor() {
    this.sessions = new Map();
  }

  create() {
    const session = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      formula: null,
      targetLibrary: null,
      provider: null,
      codeVersions: [],
      variableConstraints: [],
      messages: [],
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(sessionId) {
    return sessionId ? this.sessions.get(String(sessionId)) : null;
  }

  getOrCreate(sessionId) {
    return this.get(sessionId) || this.create();
  }

  toContext(session) {
    return {
      formula: session.formula,
      targetLibrary: session.targetLibrary,
      provider: session.provider,
      previousCode: session.codeVersions.at(-1)?.code || "",
      variableConstraints: session.variableConstraints,
      history: session.messages.slice(-8).map(({ role, content }) => ({ role, content })),
    };
  }

  record(session, { input, result }) {
    if (result.recognizedLatex) session.formula = result.recognizedLatex;
    if (input.targetLibrary) session.targetLibrary = input.targetLibrary;
    session.provider = result.provider;
    session.messages.push({ role: "user", content: input.prompt, createdAt: Date.now() });
    session.messages.push({ role: "agent", content: result.answer || result.explanation, createdAt: Date.now() });
    if (result.kind !== "chat") {
      session.codeVersions.push({ code: result.code, createdAt: Date.now(), targetLibrary: input.targetLibrary });
    }
    const constraints = extractVariableConstraints(input.prompt);
    for (const constraint of constraints) {
      if (!session.variableConstraints.includes(constraint)) session.variableConstraints.push(constraint);
    }
    session.updatedAt = Date.now();
  }
}

function extractVariableConstraints(prompt = "") {
  const text = String(prompt).trim();
  const constraints = [];
  const replacement = text.match(/(?:把|将)?\s*([A-Za-z][A-Za-z0-9_]*)\s*(?:替换为|改为|换成)\s*([A-Za-z][A-Za-z0-9_]*)/);
  if (replacement) constraints.push(`${replacement[1]} 替换为 ${replacement[2]}`);
  for (const match of text.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?)/g)) {
    constraints.push(`${match[1]} = ${match[2]}`);
  }
  return constraints;
}

module.exports = { ConversationStore, extractVariableConstraints };
