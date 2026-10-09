function normalizeLatex(latex) {
  return String(latex).replace(/\s+/g, "").replace(/[{}]/g, "");
}

function isQuadraticFormula(latex) {
  const normalized = normalizeLatex(latex);
  return normalized.includes("\\pm")
    && normalized.includes("\\sqrt")
    && /b\^2-4a\*?c/.test(normalized)
    && normalized.includes("2a");
}

function quadraticCode(targetLibrary) {
  if (targetLibrary === "NumPy") {
    return {
      code: `import numpy as np

def quadratic_roots(a, b, c):
    if a == 0:
        raise ValueError("a 不能为 0")
    discriminant = b**2 - 4*a*c
    root = np.sqrt(discriminant + 0j)
    return (-b + root) / (2*a), (-b - root) / (2*a)`,
      explanation: "已按二次方程求根公式生成两个根。公式未提供具体系数，因此不会擅自代入示例数值；调用 quadratic_roots(a, b, c) 即可计算。",
      dependencies: ["numpy"],
    };
  }

  if (targetLibrary === "纯 Python") {
    return {
      code: `import cmath

def quadratic_roots(a, b, c):
    if a == 0:
        raise ValueError("a 不能为 0")
    discriminant = b**2 - 4*a*c
    root = cmath.sqrt(discriminant)
    return (-b + root) / (2*a), (-b - root) / (2*a)`,
      explanation: "已按二次方程求根公式生成两个根。公式未提供具体系数，因此不会擅自代入示例数值；调用 quadratic_roots(a, b, c) 即可计算。",
      dependencies: [],
    };
  }

  return {
    code: `import sympy as sp

a, b, c = sp.symbols("a b c", nonzero=True)
discriminant = b**2 - 4*a*c
x1 = (-b + sp.sqrt(discriminant)) / (2*a)
x2 = (-b - sp.sqrt(discriminant)) / (2*a)

print("x1 =", x1)
print("x2 =", x2)`,
    explanation: "已按二次方程求根公式生成两个符号根 x1、x2，并定义了 a、b、c。",
    dependencies: ["sympy"],
  };
}

function getFormulaTemplate(latex, targetLibrary) {
  return isQuadraticFormula(latex) ? quadraticCode(targetLibrary) : null;
}

module.exports = { getFormulaTemplate, isQuadraticFormula };
