function compactLatex(latex = "") {
  return String(latex).replace(/\s+/g, "");
}

function hasComplexContour(source) {
  return /\\oint|\\Gamma|\\mathbb\{C\}|\\operatorname\{Res\}|\\mathrm\{Res\}/.test(source);
}

function hasInfiniteOperation(source) {
  return /\\infty|\\lim|\\sum|\\prod/.test(source);
}

function hasSymbolicParameters(source) {
  return /\\(?:alpha|beta|gamma|delta|lambda|mu|sigma|theta|zeta)|\b[a-zA-Z]\b/.test(source);
}

function hasExplicitNumericRequest(prompt = "") {
  return /(?:数值|近似|小数|计算结果|求值|代入|取\s*[A-Za-z]|令\s*[A-Za-z]|numeric|evaluate)/i.test(prompt);
}

function hasFiniteDefiniteIntegral(source = "") {
  // Covers LaTeX forms such as \\int_{0}^{\\pi} and \\int_{-1}^{1}.
  return /\\int_\{[^}]+\}\^\{[^}]+\}/.test(source) && !/\\infty/.test(source);
}

function decideComputationStrategy({ latex = "", prompt = "", targetLibrary = "auto" } = {}) {
  const source = compactLatex(latex);
  const reasons = [];
  const contour = hasComplexContour(source);
  const infinite = hasInfiniteOperation(source);
  const symbolic = hasSymbolicParameters(source);
  const numericRequested = hasExplicitNumericRequest(prompt);
  const finiteIntegral = hasFiniteDefiniteIntegral(source);
  const hasFreeParameter = /(?:\\alpha|\\beta|\\gamma|\\delta|\\lambda|\\mu|\\sigma|\\theta|\\zeta|\\operatorname\{[A-Za-z]+\}|\b(?:a|b|c|s)\b)/.test(source);

  if (contour) reasons.push("公式包含复变围道、留数或复数域结构，不能使用普通实数数值积分器直接计算");
  if (infinite) reasons.push("公式包含无穷极限、无穷求和或无穷积分，直接执行可能耗时或无法收敛");
  if (symbolic) reasons.push("公式包含未指定数值的符号变量或参数");

  // An explicit library remains supported for API clients, while the web UI
  // sends `auto` so the agent owns this decision.
  const automatic = !["SymPy", "NumPy", "纯 Python"].includes(targetLibrary);

  if (contour || (infinite && symbolic)) {
    return {
      mode: "symbolic",
      executionPolicy: "skip-complex-symbolic",
      requestedLibrary: targetLibrary,
      recommendedLibrary: automatic ? "SymPy" : targetLibrary,
      reasons,
      instruction: "生成完整、可导入的 SymPy 符号表示或函数定义；保留所有变量、积分路径和条件。不得把含自由符号的表达式传给 scipy.integrate.quad，也不得编造参数值。代码应打印符号表达式，但不要强制求出数值。",
    };
  }

  if (automatic && finiteIntegral && !hasFreeParameter) {
    return {
      mode: "numeric",
      executionPolicy: "execute",
      requestedLibrary: targetLibrary,
      recommendedLibrary: "NumPy",
      reasons: ["检测到有限区间且没有自由参数的定积分，优先使用数值积分，避免耗时的符号求积"],
      instruction: "使用 NumPy 和 scipy.integrate.quad 进行数值积分；严格保留原公式的积分上下限和被积函数。",
    };
  }

  if (numericRequested && !symbolic) {
    return {
      mode: "numeric",
      executionPolicy: "execute",
      requestedLibrary: targetLibrary,
      recommendedLibrary: automatic ? "NumPy" : targetLibrary,
      reasons: ["公式和用户要求适合进行确定的数值计算"],
      instruction: "生成可直接执行的数值代码；数值积分器的被积函数必须返回 float 或 complex 数值。",
    };
  }

  const recommendedLibrary = automatic
    ? (symbolic || infinite ? "SymPy" : "纯 Python")
    : targetLibrary;

  return {
    mode: recommendedLibrary === "SymPy" ? "symbolic" : "hybrid",
    executionPolicy: "execute",
    requestedLibrary: targetLibrary,
    recommendedLibrary,
    reasons: reasons.length ? reasons : ["未检测到需要阻止执行的复杂符号结构"],
    instruction: recommendedLibrary === "SymPy"
      ? "优先构造符号表达式；只有在结果可安全、快速求值时才执行化简或求值。"
      : "生成符合目标库的可执行实现；若仍含自由参数，应定义函数并使用明确示例以外的安全输出。",
  };
}

module.exports = { decideComputationStrategy };
