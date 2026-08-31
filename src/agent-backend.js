const { BACKEND_MODE } = require("./runtime-config");

function createAgentBackend(options = {}) {
  if (BACKEND_MODE === "api") {
    const { OpenAIResponsesBackend } = require("./openai-responses");
    return new OpenAIResponsesBackend(options);
  }
  const { CodexAppServer } = require("./codex-app-server");
  return new CodexAppServer(options);
}

module.exports = { createAgentBackend };
