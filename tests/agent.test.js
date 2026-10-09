const test = require("node:test");
const assert = require("node:assert/strict");
const { FormulaAgent } = require("../src/agent/formula-agent");
const { MockProvider } = require("../src/providers/mock-provider");
const { validateGeneratedPython } = require("../src/agent/code-validator");
const { ConversationStore, extractVariableConstraints } = require("../src/agent/conversation-store");
const { needsSafetySkip } = require("../src/agent/python-runner");
const { decideComputationStrategy } = require("../src/agent/computation-strategy");

test("复杂复变公式会决策为符号计算并跳过强制数值执行", async () => {
  const latex = String.raw`\oint_{\Gamma}\frac{e^{z\zeta}}{(\zeta-\alpha)^2}\,d\zeta`;
  const strategy = decideComputationStrategy({ latex, prompt: "转换为 Python 代码", targetLibrary: "SymPy" });
  assert.equal(strategy.mode, "symbolic");
  assert.equal(strategy.executionPolicy, "skip-complex-symbolic");

  class SymbolicProvider {
    name = "Test Provider";
    mode = "test";
    async generatePython(input) {
      assert.equal(input.computationStrategy.executionPolicy, "skip-complex-symbolic");
      return {
        code: "import sympy as sp\nz, zeta, alpha = sp.symbols('z zeta alpha')\nexpr = sp.Integral(sp.exp(z*zeta)/(zeta-alpha)**2, zeta)\nprint(expr)",
        explanation: "保留为符号围道积分",
        dependencies: ["sympy"],
      };
    }
  }

  const result = await new FormulaAgent({ provider: new SymbolicProvider() }).run({
    inputType: "latex",
    latex,
    prompt: "转换为 Python 代码",
    targetLibrary: "SymPy",
  });
  assert.equal(result.status, "completed");
  assert.equal(result.execution.skippedForSafety, true);
  assert.match(result.execution.safetyReason, /Agent 决策为符号计算/);
  assert.ok(result.trace.some((item) => item.step.includes("计算策略：符号计算")));
});

test("会话保存公式、消息、代码版本和目标库", () => {
  const store = new ConversationStore();
  const session = store.create();
  store.record(session, {
    input: { prompt: "转换成 SymPy", targetLibrary: "SymPy" },
    result: { recognizedLatex: "x^2", code: "print(x**2)", explanation: "已生成代码", provider: { name: "Test", mode: "test" } },
  });
  const context = store.toContext(session);
  assert.equal(context.formula, "x^2");
  assert.equal(context.targetLibrary, "SymPy");
  assert.equal(context.previousCode, "print(x**2)");
  assert.equal(context.history.length, 2);
  assert.deepEqual(extractVariableConstraints("把 x 改为 t，并令 a=2"), ["x 替换为 t", "a = 2"]);
});

test("非代码问题走自由聊天回答而不生成 Python", async () => {
  class ChatProvider {
    name = "Test Provider";
    mode = "test";
    async chat() { return { answer: "拉格朗日乘子法用于带约束的极值问题。" }; }
    async generatePython() { throw new Error("不应生成代码"); }
  }
  const agent = new FormulaAgent({ provider: new ChatProvider() });
  const result = await agent.run({ inputType: "latex", latex: "x^2", prompt: "什么是拉格朗日乘子法" });
  assert.equal(result.kind, "chat");
  assert.match(result.answer, /带约束/);
});

test("首次自由对话无需提供 LaTeX 或图片", async () => {
  class ChatProvider {
    name = "Test Provider";
    mode = "test";
    async chat() { return { answer: "可以直接开始讨论。" }; }
  }
  const agent = new FormulaAgent({ provider: new ChatProvider() });
  const result = await agent.run({ inputType: "chat", prompt: "你好" });
  assert.equal(result.kind, "chat");
  assert.equal(result.recognizedLatex, "");
});

test("推导、比较和变量替换不会误进入代码生成流程", async () => {
  class TaskProvider {
    name = "Test Provider";
    mode = "test";
    async chat({ task }) { return { answer: `task=${task}` }; }
    async generatePython() { throw new Error("不应生成代码"); }
  }
  const agent = new FormulaAgent({ provider: new TaskProvider() });
  for (const [prompt, task] of [["请推导这个公式", "derive"], ["比较 SymPy 和 NumPy", "compare"], ["把 x 替换为 t", "replace"]]) {
    const result = await agent.run({ inputType: "latex", latex: "x^2", prompt });
    assert.equal(result.kind, "chat");
    assert.equal(result.task, task);
  }
});

test("当前公式的自由追问仍保持聊天输入，不会伪装成 LaTeX", async () => {
  class ChatProvider {
    name = "Test Provider";
    mode = "test";
    async chat({ prompt }) { return { answer: prompt }; }
  }
  const agent = new FormulaAgent({ provider: new ChatProvider() });
  const result = await agent.run({ inputType: "chat", prompt: "这个公式有什么意义", conversation: { formula: "x^2", history: [] } });
  assert.equal(result.kind, "chat");
  assert.equal(result.inputType, "chat");
});

test("引用历史消息会连同新问题传给聊天模型", async () => {
  class ChatProvider {
    name = "Test Provider";
    mode = "test";
    async chat({ prompt, quote }) { return { answer: `${quote} => ${prompt}` }; }
  }
  const agent = new FormulaAgent({ provider: new ChatProvider() });
  const result = await agent.run({
    inputType: "chat",
    prompt: "请继续解释",
    quote: { text: "支持向量机通过最大化间隔分类" },
  });
  assert.match(result.answer, /支持向量机/);
  assert.match(result.answer, /继续解释/);
});

test("Mock 聊天回答会明确使用引用材料", async () => {
  const provider = new MockProvider();
  const result = await provider.chat({
    prompt: "这个公式的原理是什么",
    quote: "公式：x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}",
    task: "explain",
  });
  assert.match(result.answer, /引用材料/);
  assert.match(result.answer, /\\frac/);
});

test("引用代码并要求加入注释时进入代码修改流程", async () => {
  const calls = [];
  class CodeProvider {
    name = "Test Provider";
    mode = "test";
    async generatePython(input) {
      calls.push(input);
      return { code: "# 中文注释\nprint(1)", explanation: "已添加注释", dependencies: [] };
    }
  }
  const agent = new FormulaAgent({ provider: new CodeProvider() });
  const result = await agent.run({
    inputType: "chat",
    prompt: "加入中文注释",
    targetLibrary: "纯 Python",
    quote: { text: "代码：\nprint(1)" },
  });
  assert.equal(result.inputType, "chat");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].quotedMaterial, "代码：\nprint(1)");
});

test("自由对话中的 LaTeX 转代码请求会提取公式", async () => {
  class CodeProvider {
    name = "Test Provider";
    mode = "test";
    async generatePython({ latex }) {
      assert.match(latex, /x\^2/);
      return { code: "import sympy as sp\nprint(sp.Symbol('x')**2)", dependencies: ["sympy"], explanation: "已转换" };
    }
  }
  const agent = new FormulaAgent({ provider: new CodeProvider() });
  const result = await agent.run({ inputType: "chat", prompt: "x^2 转为 Python 代码", targetLibrary: "SymPy" });
  assert.equal(result.kind, undefined);
  assert.match(result.recognizedLatex, /x\^2/);
});

test("LaTeX 输入会生成结构化的 SymPy 结果", async () => {
  const agent = new FormulaAgent({ provider: new MockProvider() });
  const result = await agent.run({
    inputType: "latex",
    latex: String.raw`\frac{x^2 + 1}{2}`,
    prompt: "转换成 Python",
    targetLibrary: "SymPy",
  });

  assert.equal(result.status, "completed");
  assert.equal(result.confidence, 1);
  assert.match(result.code, /latex_source/);
  assert.equal(result.provider.mode, "mock");
  assert.ok(result.trace.length >= 4);
});

test("缺失 LaTeX 时返回可读的校验错误", async () => {
  const agent = new FormulaAgent({ provider: new MockProvider() });
  await assert.rejects(
    () => agent.run({ inputType: "latex", latex: "" }),
    (error) => error.statusCode === 400 && /LaTeX/.test(error.message)
  );
});

test("图片输入通过识别和生成两个阶段", async () => {
  const agent = new FormulaAgent({ provider: new MockProvider() });
  const result = await agent.run({
    inputType: "image",
    image: { name: "formula.png", mimeType: "image/png", dataUrl: "data:image/png;base64,AA==" },
    targetLibrary: "纯 Python",
  });

  assert.equal(result.inputType, "image");
  assert.match(result.recognizedLatex, /\\int/);
  assert.match(result.code, /math\.sqrt/);
  assert.ok(result.warnings.some((item) => item.includes("演示公式")));
});

test("二次方程会生成与输入公式一致的三种代码版本", async () => {
  const agent = new FormulaAgent({ provider: new MockProvider() });
  const latex = String.raw`x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`;

  const sympy = await agent.run({ inputType: "latex", latex, targetLibrary: "SymPy" });
  assert.match(sympy.code, /discriminant = b\*\*2 - 4\*a\*c/);
  assert.match(sympy.code, /x1/);
  assert.match(sympy.code, /x2/);

  const numpy = await agent.run({ inputType: "latex", latex, targetLibrary: "NumPy" });
  assert.match(numpy.code, /quadratic_roots/);
  assert.deepEqual(numpy.dependencies, ["numpy"]);

  const python = await agent.run({ inputType: "latex", latex, targetLibrary: "纯 Python" });
  assert.match(python.code, /cmath\.sqrt/);
  assert.match(python.code, /quadratic_roots/);
});

test("二次方程会覆盖模型返回的不完整代码并实际执行", async () => {
  class IncompleteQuadraticProvider {
    name = "Test Provider";
    mode = "test";

    async generatePython() {
      return { code: "x = (-b + sqrt(b**2 - 4*a*c)) / (2*a)", dependencies: ["sympy"] };
    }
  }

  const agent = new FormulaAgent({ provider: new IncompleteQuadraticProvider() });
  const result = await agent.run({
    inputType: "latex",
    latex: String.raw`x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`,
    targetLibrary: "SymPy",
  });
  assert.match(result.code, /a, b, c = sp\.symbols/);
  assert.match(result.code, /x1/);
  assert.match(result.code, /x2/);
  assert.ok(result.trace.some((item) => item.step.includes("可靠模板")));
  assert.doesNotMatch(result.code, /quadratic_roots\(1, -3, 2\)/);
  if (result.execution.attempted) assert.equal(result.execution.passed, true);
});

test("代码预检会识别 SymPy 无穷求和的常见错误", () => {
  const result = validateGeneratedPython(
    "from sympy import summation\nresult = summation(1/n**2, (n, 1, float('inf')))\nprint(result)",
    ["sympy"]
  );
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((item) => item.includes("未定义")));
  assert.ok(result.errors.some((item) => item.includes("sp.oo")));
});

test("SymPy 无穷级数会跳过本机实际执行", () => {
  const code = "import sympy as sp\nn = sp.symbols('n')\nprint(sp.summation(1 / n**2, (n, 1, sp.oo)))";
  assert.match(needsSafetySkip(code), /无穷级数/);
});

test("目标库选项会校验实际导入和混用情况", () => {
  assert.equal(validateGeneratedPython("print(1)", [], "SymPy").passed, false);
  assert.equal(validateGeneratedPython("import numpy as np\nprint(np.sqrt(4))", ["numpy"], "NumPy").passed, true);
  assert.equal(validateGeneratedPython("import sympy as sp\nprint(sp.Integer(1))", ["sympy"], "NumPy").passed, false);
  assert.equal(validateGeneratedPython("import math\nprint(math.sqrt(4))", [], "纯 Python").passed, true);
  assert.equal(validateGeneratedPython("import sympy as sp\nprint(1)", ["sympy"], "纯 Python").passed, false);
});

test("数学一致性检查会拦截缺失二次方程核心计算的代码", () => {
  const result = validateGeneratedPython("import sympy as sp\nprint(sp.Symbol('x'))", ["sympy"], "SymPy", String.raw`x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`);
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((item) => item.includes("二次方程判别式")));
});

test("NumPy 数值积分可搭配 SciPy，但不能混用 SymPy", () => {
  const code = "import numpy as np\nfrom scipy.integrate import quad\nprint(quad(lambda x: x**2, 0, 1)[0])";
  assert.equal(validateGeneratedPython(code, ["numpy", "scipy"], "NumPy").passed, true);
});

test("真实 Provider 可用时，预检失败会触发一次修正", async () => {
  class RevisingProvider {
    name = "Test Provider";
    mode = "test";

    async generatePython() {
      return {
        code: "from sympy import summation\nresult = summation(1/n**2, (n, 1, float('inf')))\nprint(result)",
        dependencies: ["sympy"],
      };
    }

    async revisePython() {
      return {
        code: "import sympy as sp\nn = sp.symbols('n', integer=True, positive=True)\nprint(sp.summation(1 / n**2, (n, 1, sp.oo)))",
        dependencies: ["sympy"],
      };
    }
  }

  const agent = new FormulaAgent({ provider: new RevisingProvider() });
  const result = await agent.run({
    inputType: "latex",
    latex: String.raw`\sum_{n=1}^{\infty}\frac{1}{n^2}`,
    targetLibrary: "SymPy",
  });
  assert.match(result.code, /sp\.oo/);
  assert.ok(!result.warnings.some((item) => item.includes("未定义")));
  assert.equal(result.correctionLog.filter((item) => item.type === "revision-request").length, 1);
  assert.ok(result.correctionLog.some((item) => item.label.includes("纠错后检查") && item.passed));
});

test("数学结果错误即使能运行，也会触发模型纠错", async () => {
  class MathematicalRevisingProvider {
    name = "Test Provider";
    mode = "test";
    revisions = 0;
    async generatePython() {
      return {
        code: "import sympy as sp\na, b, c = sp.symbols('a b c')\ndiscriminant = b**2 - 4*a*c\nx1 = (-b + sp.sqrt(discriminant)) / (2*a)\nx2 = (-b + sp.sqrt(discriminant)) / (2*a)\nprint(x1, x2)",
        dependencies: ["sympy"],
      };
    }
    async revisePython() {
      this.revisions += 1;
      return {
        code: "import sympy as sp\na, b, c = sp.symbols('a b c')\ndiscriminant = b**2 - 4*a*c\nx1 = (-b + sp.sqrt(discriminant)) / (2*a)\nx2 = (-b - sp.sqrt(discriminant)) / (2*a)\nprint(x1, x2)",
        dependencies: ["sympy"],
      };
    }
  }
  const provider = new MathematicalRevisingProvider();
  const agent = new FormulaAgent({ provider });
  const result = await agent.run({
    inputType: "latex",
    latex: String.raw`x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`,
    targetLibrary: "SymPy",
    conversation: { formula: "已有公式上下文", history: [] },
  });
  assert.equal(provider.revisions, 1);
  assert.equal(result.mathematicalVerification.status, "verified");
  assert.ok(result.correctionLog.some((item) => item.label.includes("数学核对结果")));
});

test("执行失败会反馈给 Provider 并用修正代码复验", async () => {
  class ExecutionRevisingProvider {
    name = "Test Provider";
    mode = "test";
    calls = 0;

    async generatePython() {
      return { code: "print(unknown_value)", dependencies: [] };
    }

    async revisePython() {
      this.calls += 1;
      return { code: "print(42)", dependencies: [] };
    }
  }

  const provider = new ExecutionRevisingProvider();
  const agent = new FormulaAgent({ provider });
  const result = await agent.run({ inputType: "latex", latex: "42", targetLibrary: "纯 Python" });
  if (result.execution.attempted) {
    assert.equal(provider.calls, 1);
    assert.equal(result.execution.passed, true);
    assert.equal(result.execution.stdout.trim(), "42");
    assert.ok(result.correctionLog.some((item) => item.label.includes("根据运行错误")));
  } else {
    assert.match(result.execution.errors.join(" "), /Python/);
  }
});
