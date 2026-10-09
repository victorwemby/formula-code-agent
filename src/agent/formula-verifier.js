const { runGeneratedPython } = require("./python-runner");

function normalizeLatex(latex = "") {
  return String(latex).replace(/\s+/g, "").replace(/[{}]/g, "");
}

function isQuadraticFormula(latex) {
  const source = normalizeLatex(latex);
  return source.includes("\\pm") && source.includes("\\sqrt") && /b\^2-4a\*?c/.test(source) && source.includes("2a");
}

function containsQuadraticStructure(code) {
  return /b\s*\*\*\s*2\s*-\s*4\s*\*\s*a\s*\*\s*c/.test(code)
    && /-b\s*[+\-]\s*(?:sp\.)?sqrt|root/.test(code);
}

async function verifyFormulaResult({ latex, code }) {
  if (!isQuadraticFormula(latex)) {
    return {
      status: "structural",
      passed: true,
      details: ["当前公式没有安全、确定的自动数值验证器；已完成语法、安全、依赖和结构检查，数学结果仍需人工核对。"],
    };
  }

  if (!containsQuadraticStructure(code)) {
    return { status: "failed", passed: false, details: ["二次方程代码缺少判别式或两个根的核心计算"] };
  }

  if (/def\s+quadratic_roots\s*\(/.test(code)) {
    const execution = await runGeneratedPython(`${code}\nprint('FORMULA_VERIFY_MARKER', quadratic_roots(1, -3, 2))`);
    const output = execution.stdout || "";
    const values = output.match(/FORMULA_VERIFY_MARKER\s*\(?([^\n]*)/);
    const hasOne = /(?:1(?:\.0+)?(?:\+0j)?)/.test(values?.[1] || "");
    const hasTwo = /(?:2(?:\.0+)?(?:\+0j)?)/.test(values?.[1] || "");
    if (execution.passed && hasOne && hasTwo) {
      return { status: "verified", passed: true, details: ["已用 a=1、b=-3、c=2 独立核对，两个根为 1 和 2。"] };
    }
    return { status: "failed", passed: false, details: ["二次方程数值核对失败：a=1、b=-3、c=2 应得到根 1 和 2。", ...(execution.errors || [])] };
  }

  if (/\bx1\s*=/.test(code) && /\bx2\s*=/.test(code) && /\bsp\./.test(code)) {
    const execution = await runGeneratedPython(`${code}\nprint('FORMULA_VERIFY_MARKER', sp.simplify(x1.subs({a: 1, b: -3, c: 2})), sp.simplify(x2.subs({a: 1, b: -3, c: 2})))`);
    const output = execution.stdout || "";
    if (execution.passed && /FORMULA_VERIFY_MARKER\s+(?:1\s+2|2\s+1)/.test(output)) {
      return { status: "verified", passed: true, details: ["已用 a=1、b=-3、c=2 独立核对，两个根为 1 和 2。"] };
    }
    return { status: "failed", passed: false, details: ["二次方程符号结果核对失败。", ...(execution.errors || [])] };
  }

  return {
    status: "structural",
    passed: true,
    details: ["已检查二次方程结构；该代码形式无法安全注入数值测试，数学结果需人工核对。"],
  };
}

module.exports = { verifyFormulaResult, isQuadraticFormula };
