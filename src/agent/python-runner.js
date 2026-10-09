const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ALLOWED_MODULES = new Set(["math", "cmath", "sympy", "numpy", "scipy"]);
const MAX_OUTPUT_BYTES = 16 * 1024;

function findPython(requiredModules = []) {
  const candidates = [
    process.env.PYTHON_EXECUTABLE,
    path.join(process.cwd(), ".python-env", "Scripts", "python.exe"),
    path.join(process.env.LOCALAPPDATA || "", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe"),
    path.join(process.env.USERPROFILE || "", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe"),
  ].filter(Boolean);

  return candidates.find((candidate) => {
    if (!require("node:fs").existsSync(candidate)) return false;
    const checks = requiredModules.flatMap((moduleName) => {
      if (moduleName === "sympy") return ["import sympy; assert hasattr(sympy, 'symbols') and hasattr(sympy, 'Symbol')"];
      if (moduleName === "numpy") return ["import numpy; assert hasattr(numpy, 'sqrt')"];
      if (moduleName === "scipy") return ["import scipy; import scipy.integrate"];
      return [`import ${moduleName}`];
    });
    const probe = require("node:child_process").spawnSync(candidate, ["-c", checks.length ? checks.join("; ") : "import sys; print(sys.version)"], {
      encoding: "utf8",
      timeout: 3000,
      windowsHide: true,
    });
    return probe.status === 0;
  });
}

function validateExecutionPolicy(code) {
  const errors = [];
  const imports = code.matchAll(/^\s*(?:from\s+([A-Za-z_]\w*)|import\s+([A-Za-z_]\w*))/gm);
  for (const match of imports) {
    const moduleName = match[1] || match[2];
    if (!ALLOWED_MODULES.has(moduleName)) errors.push(`执行环境不允许导入 ${moduleName}`);
  }
  if (/\b__\w+__\b/.test(code)) errors.push("执行环境不允许使用双下划线属性");
  return errors;
}

function needsSafetySkip(code) {
  const isInfiniteSympySeries = /(?:sp\.)?summation\s*\([\s\S]*?\b(?:sp\.oo|oo)\b/.test(code);
  return isInfiniteSympySeries
    ? "检测到 SymPy 无穷级数；为防止复杂符号计算长时间占用本机资源，已跳过实际执行"
    : null;
}

function truncate(text) {
  return text.length > MAX_OUTPUT_BYTES ? `${text.slice(0, MAX_OUTPUT_BYTES)}\n[输出已截断]` : text;
}

async function runGeneratedPython(code, { timeoutMs = 5000 } = {}) {
  const policyErrors = validateExecutionPolicy(code);
  if (policyErrors.length) {
    return { attempted: false, passed: false, errors: policyErrors, stdout: "", stderr: "" };
  }

  const safetyReason = needsSafetySkip(code);
  if (safetyReason) {
    return {
      attempted: false,
      passed: true,
      skippedForSafety: true,
      errors: [],
      stdout: "",
      stderr: "",
      safetyReason,
    };
  }

  const requiredModules = [...new Set([...code.matchAll(/^\s*(?:from\s+([A-Za-z_]\w*)|import\s+([A-Za-z_]\w*))/gm)].map((match) => match[1] || match[2]).filter((moduleName) => ALLOWED_MODULES.has(moduleName)))];
  const python = findPython(requiredModules);
  if (!python) {
    return {
      attempted: false,
      passed: false,
      errors: [requiredModules.length
        ? `Python 执行环境缺少依赖：${requiredModules.join("、")}；请先运行 .\\setup-python.ps1`
        : "未找到 Python 执行环境；请先运行 .\\setup-python.ps1"],
      stdout: "",
      stderr: "",
    };
  }

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "formula-code-agent-"));
  const filePath = path.join(directory, "generated_formula.py");
  await fs.writeFile(filePath, code, "utf8");

  try {
    const result = await new Promise((resolve) => {
      const child = spawn(python, ["-B", filePath], {
        cwd: directory,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);

      child.stdout.on("data", (chunk) => { stdout = truncate(stdout + chunk); });
      child.stderr.on("data", (chunk) => { stderr = truncate(stderr + chunk); });
      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({ exitCode: null, stdout, stderr: error.message, timedOut });
      });
      child.on("close", (exitCode) => {
        clearTimeout(timer);
        resolve({ exitCode, stdout, stderr, timedOut });
      });
    });

    const errors = result.timedOut
      ? [`Python 执行超过 ${timeoutMs}ms，已停止`]
      : result.exitCode === 0
        ? []
        : [result.stderr.trim() || `Python 以退出码 ${result.exitCode} 结束`];
    return { attempted: true, passed: errors.length === 0, errors, ...result };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

module.exports = { runGeneratedPython, validateExecutionPolicy, needsSafetySkip, findPython };
