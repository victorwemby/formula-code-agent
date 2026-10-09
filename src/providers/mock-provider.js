class MockProvider {
  constructor() {
    this.name = "Mock Formula Model";
    this.mode = "mock";
  }

  async recognizeFormula(image) {
    return {
      latex: String.raw`\int_{0}^{\infty} e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}`,
      confidence: 0.88,
      warnings: [
        `当前未接入视觉模型，“${image.name}”使用演示公式完成流程。接入模型后将返回真实识别结果。`,
      ],
    };
  }

  async chat({ prompt, quote = "", task }) {
    const labels = { explain: "公式解释", derive: "推导说明", compare: "实现方式比较", replace: "变量替换说明", debug: "问题分析", chat: "自由讨论" };
    const quoted = quote ? `\n\n引用材料：${quote}\n已根据引用材料回答。` : "";
    return { answer: `${labels[task] || "自由讨论"}：${prompt}${quoted}\n\n当前 Mock Provider 提供演示回答；接入开源模型后会结合公式和完整会话上下文生成详细结果。` };
  }

  async generatePython({ latex, targetLibrary, prompt, quotedMaterial = "" }) {
    if (quotedMaterial && /(?:注释|说明|注解)/.test(prompt)) {
      const codeMatch = quotedMaterial.match(/代码：\s*([\s\S]*?)(?:\n(?:加入|添加|补充|增加).*)?$/);
      const quotedCode = codeMatch?.[1]?.trim();
      if (quotedCode) {
        return {
          code: `# 中文注释：以下代码基于引用内容，保留原有计算逻辑。\n${quotedCode}`,
          explanation: "已在引用代码中加入中文注释，并保留原有计算逻辑。",
          dependencies: quotedCode.match(/import\s+sympy|from\s+sympy/) ? ["sympy"] : [],
        };
      }
    }
    const promptHint = prompt ? `根据要求：${prompt}` : "";

    const normalized = latex.replace(/\s+/g, "");
    const isQuadratic = normalized.includes("\\sqrt{b^2-4ac}") && normalized.includes("2a");
    const isGaussianIntegral = normalized.includes("\\int_{0}^{\\infty}") && normalized.includes("e^{-x^2}");

    if (isQuadratic) {
      if (targetLibrary === "NumPy") {
        return {
          code: `import numpy as np\n\ndef quadratic_roots(a: float, b: float, c: float):\n    \"\"\"Solve ax^2 + bx + c = 0.\"\"\"\n    if a == 0:\n        raise ValueError("a 不能为 0")\n    discriminant = b**2 - 4*a*c\n    root = np.sqrt(discriminant + 0j)\n    return ((-b + root) / (2*a), (-b - root) / (2*a))\n\nprint(quadratic_roots(1, -3, 2))`,
          explanation: `${promptHint} 已根据二次方程求根公式生成 NumPy 版本，支持实根和复根。`,
          dependencies: ["numpy"],
        };
      }

      if (targetLibrary === "纯 Python") {
        return {
          code: `import cmath\n\ndef quadratic_roots(a: float, b: float, c: float):\n    \"\"\"Solve ax^2 + bx + c = 0.\"\"\"\n    if a == 0:\n        raise ValueError("a 不能为 0")\n    discriminant = b**2 - 4*a*c\n    root = cmath.sqrt(discriminant)\n    return ((-b + root) / (2*a), (-b - root) / (2*a))\n\nprint(quadratic_roots(1, -3, 2))`,
          explanation: `${promptHint} 已根据二次方程求根公式生成标准库 Python 版本。`,
          dependencies: [],
        };
      }

      return {
        code: `import sympy as sp\n\na, b, c = sp.symbols("a b c", nonzero=True)\ndiscriminant = b**2 - 4*a*c\nx1 = (-b + sp.sqrt(discriminant)) / (2*a)\nx2 = (-b - sp.sqrt(discriminant)) / (2*a)\n\nprint("x1 =", x1)\nprint("x2 =", x2)`,
        explanation: `${promptHint} 已将二次方程求根公式展开为两个符号根。`,
        dependencies: ["sympy"],
      };
    }

    if (targetLibrary === "NumPy") {
      const safeLatex = JSON.stringify(latex);
      const warning = isGaussianIntegral ? "" : "当前 Mock Provider 无法将任意公式自动改写为数值函数，以下代码保留公式并提供通用入口。";
      return {
        code: isGaussianIntegral
          ? `import numpy as np\nfrom scipy.integrate import quad\n\ndef integrand(x: float) -> float:\n    return np.exp(-(x ** 2))\n\nresult, error = quad(integrand, 0, np.inf)\nprint(f"result = {result:.10f}, estimated error = {error:.2e}")`
          : `import numpy as np\n\nlatex_source = ${safeLatex}\n# 请根据公式定义 integrand，再使用 NumPy 进行数值计算。\nprint("Input formula:", latex_source)`,
        explanation: `${promptHint} ${isGaussianIntegral ? "已生成高斯积分的 NumPy/SciPy 数值计算版本。" : warning}`,
        dependencies: isGaussianIntegral ? ["numpy", "scipy"] : ["numpy"],
      };
    }

    if (targetLibrary === "纯 Python") {
      const safeLatex = JSON.stringify(latex);
      if (isGaussianIntegral) {
        return {
          code: `import math\n\n# 高斯积分的解析结果\nresult = math.sqrt(math.pi) / 2\nprint(result)`,
          explanation: `${promptHint} 已生成高斯积分的标准库 Python 版本。`,
          dependencies: [],
        };
      }
      return {
        code: `# 原始 LaTeX: ${safeLatex}\n# 当前 Mock Provider 未对该公式生成数值实现。\nprint("请接入代码模型或选择 SymPy 进行符号转换。")`,
        explanation: `${promptHint} 当前公式建议使用 SymPy，或接入真实代码模型生成标准库实现。`,
        dependencies: [],
      };
    }

    const safeLatex = JSON.stringify(latex);
    return {
      code: `import sympy as sp\n\nlatex_source = ${safeLatex}\nx = sp.symbols("x")\nprint("LaTeX source:", latex_source)\nprint("Symbolic variable:", x)`,
      explanation: `${promptHint} Mock Provider 会保留 LaTeX 源码并创建可运行的 SymPy 会话；接入真实代码模型后会按具体公式生成符号表达式。`,
      dependencies: ["sympy"],
    };
  }
}

module.exports = { MockProvider };
