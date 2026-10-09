const { MockProvider } = require("./mock-provider");
const { OpenSourceProvider } = require("./open-source-provider");

function createProvider(config = {}) {
  const provider = String(config.provider || process.env.AI_PROVIDER || "mock").toLowerCase();
  if (provider === "open-source") return new OpenSourceProvider(config);
  return new MockProvider();
}

module.exports = { createProvider };
