const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { findPython } = require("./python-runner");

const BLOCKED_PATTERNS = [
  [/\beval\s*\(/, "禁止使用 eval()"],
  [/\bexec\s*\(/, "禁止使用 exec()"],
  [/\b(?:os|subprocess|socket)\b/, "禁止直接访问系统、进程或网络模块"],
  [/open\s*\(/, "禁止直接读写文件"],
];

function validateTargetLibrary(code, targetLibrary) {
  const errors = [];
  const hasSympy = /(?:from\s+sympy\b|import\s+sympy\b)/.test(code);
  const hasNumpy = /(?:from\s+numpy\b|import\s+numpy\b)/.test(code);
  const hasScipy = /(?:from\s+scipy\b|import\s+scipy\b)/.test(code);

  if (targetLibrary === "SymPy" && !hasSympy) {
    errors.push("目标库已选择 SymPy，但代码没有导入 SymPy");
  }
  if (targetLibrary === "NumPy" && !hasNumpy) {
    errors.push("目标库已选择 NumPy，但代码没有导入 NumPy");
  }
  if (targetLibrary === "NumPy" && hasSympy) {
    errors.push("目标库已选择 NumPy，但代码混用了 SymPy");
  }
  if (targetLibrary === "纯 Python" && (hasSympy || hasNumpy || hasScipy)) {
    errors.push("目标库已选择纯 Python，代码不能导入 SymPy、NumPy 或 SciPy");
  }

  // Catch the common model mistake of importing a module under an alias and
  // then referring to the original module name (for example `import sympy as
  // sp` followed by `sympy.oo`). This would otherwise pass syntax checks and
  // fail only during execution with NameError.
  if (/\bsympy\s*\./.test(code) && !/\bimport\s+sympy\b(?!\s+as\s+)/.test(code)) {
    errors.push("代码使用了 sympy.*，但没有以 sympy 原名导入；请统一使用 sp.* 或改为 import sympy");
  }
  if (/\bnp\s*\./.test(code) && !/\bimport\s+numpy\s+as\s+np\b/.test(code)) {
    errors.push("代码使用了 np.*，但没有执行 import numpy as np");
  }
  return errors;
}

function validatePythonSyntax(code) {
  const python = findPython();
  if (!python) return ["未找到 Python 执行环境，无法完成 Python 语法检查；请先运行 .\\setup-python.ps1"];
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "formula-syntax-"));
  const filePath = path.join(directory, "generated_formula.py");
  let result;
  try {
    fs.writeFileSync(filePath, code, "utf8");
    result = spawnSync(python, ["-I", "-m", "py_compile", filePath], { encoding: "utf8", timeout: 3000, windowsHide: true });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  if (result.error?.code === "ETIMEDOUT") return ["Python 语法检查超时"];
  if (result.error) return [`无法执行 Python 语法检查：${result.error.message}`];
  if (result.status !== 0) return [`Python 语法错误：${String(result.stderr || "无法解析代码").trim()}`];
  return [];
}

function validateFormulaConsistency(code, latex = "") {
  const source = String(latex || "").replace(/\s+/g, "");
  if (!source) return { errors: [], warnings: [] };
  const errors = [];
  const warnings = [];
  const quadratic = source.includes("\\sqrt{b^2-4ac}") && source.includes("2a");
  if (quadratic && !( /discriminant|b\s*\*\*\s*2\s*-\s*4\s*\*\s*a\s*\*\s*c/.test(code) && /x1|x2|quadratic_roots/.test(code))) {
    errors.push("代码未发现二次方程判别式和两个根的计算，可能与输入公式不一致");
  }
  if (source.includes("\\sum") && !/(sum|summation|for\s+\w+\s+in)/.test(code)) {
    warnings.push("输入包含求和公式，请确认代码实际执行了求和而非仅打印 LaTeX 源码");
  }
  if (source.includes("\\int") && !/(integral|quad|quad\s*\(|integrand|integrate)/i.test(code)) {
    warnings.push("输入包含积分公式，请确认代码实际执行了积分计算");
  }
  return { errors, warnings };
}

function validateGeneratedPython(code, dependencies = [], targetLibrary, latex = "") {
  const errors = [];
  const warnings = [];

  if (!String(code || "").trim()) errors.push("代码为空");
  errors.push(...validatePythonSyntax(code));

  for (const [pattern, message] of BLOCKED_PATTERNS) {
    if (pattern.test(code)) errors.push(message);
  }

  errors.push(...validateTargetLibrary(code, targetLibrary));
  const consistency = validateFormulaConsistency(code, latex);
  errors.push(...consistency.errors);
  warnings.push(...consistency.warnings);

  if (/from\s+sympy\b|import\s+sympy\b/.test(code)) {
    if (/summation\s*\([^\n]*\(\s*([A-Za-z_]\w*)\s*,/.test(code)) {
      const variable = code.match(/summation\s*\([^\n]*\(\s*([A-Za-z_]\w*)\s*,/)[1];
      const declaresVariable = new RegExp(`(?:symbols|Symbol)s?\\([^\\n]*["']${variable}["']`).test(code)
        || new RegExp(`\\b${variable}\\s*=\\s*sp\\.symbols`).test(code);
      if (!declaresVariable) errors.push(`SymPy 求和变量 ${variable} 未定义`);
    }
    if (/float\s*\(\s*["']inf["']\s*\)/.test(code)) {
      errors.push("SymPy 无穷上限应使用 sp.oo，而不是 float('inf')");
    }
  }

  if (!code.includes("print(") && !code.includes("return ")) {
    errors.push("代码没有可检查的输出：请使用 print() 输出结果或在函数中 return 结果");
  }
  if (dependencies.includes("sympy") && !/import\s+sympy|from\s+sympy/.test(code)) {
    warnings.push("结果声明依赖 SymPy，但代码中未发现 SymPy 导入");
  }

  return { errors, warnings, passed: errors.length === 0 };
}

module.exports = { validateGeneratedPython, validateTargetLibrary, validatePythonSyntax, validateFormulaConsistency };
