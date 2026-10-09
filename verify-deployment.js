const { spawnSync } = require("node:child_process");

const candidates = [
  process.env.PYTHON_EXECUTABLE,
  process.platform === "win32" ? ".python-env\\Scripts\\python.exe" : ".python-env/bin/python",
  process.platform === "win32" ? `${process.env.USERPROFILE}\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe` : null,
].filter(Boolean);

function checkPython() {
  let python = candidates[0];
  let result;
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["-c", "import sympy, numpy, scipy; assert hasattr(sympy, 'symbols'); assert hasattr(numpy, 'sqrt'); import scipy.integrate; print('python dependencies ok')"], {
      encoding: "utf8", windowsHide: true,
    });
    if (probe.status === 0) { python = candidate; result = probe; break; }
    python = candidate;
    result = probe;
  }
  
  /* keep the selected interpreter and its diagnostic */
  const output = (result.stdout || result.stderr || "").trim();
  return {
    executable: python,
    passed: result.status === 0,
    output,
  };
}

async function checkOllama() {
  const baseUrl = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(4000) });
    const payload = await response.json();
    const models = (payload.models || []).map((model) => model.name);
    return { baseUrl, passed: response.ok, models };
  } catch (error) {
    return { baseUrl, passed: false, models: [], error: error.message };
  }
}

async function main() {
  const pythonCheck = checkPython();
  const ollamaCheck = await checkOllama();
  const result = { python: pythonCheck, ollama: ollamaCheck };
  console.log(JSON.stringify(result, null, 2));
  if (!pythonCheck.passed || !ollamaCheck.passed) process.exitCode = 1;
}

main();

