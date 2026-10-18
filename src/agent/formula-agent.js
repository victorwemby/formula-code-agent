const crypto = require("node:crypto");
const { validateGeneratedPython } = require("./code-validator");
const { runGeneratedPython } = require("./python-runner");
const { verifyFormulaResult } = require("./formula-verifier");
const { getFormulaTemplate } = require("./formula-template");
const { decideComputationStrategy } = require("./computation-strategy");

class FormulaAgent {
  constructor({ provider }) {
    if (!provider) throw new Error("FormulaAgent 需要一个模型 Provider");
    this.provider = provider;
  }

  async run(input) {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();

    try {
      const normalized = this.validateAndNormalize(input);
      const quotedText = String(input.quote?.text || "").slice(0, 12000);
      const quotedCodeEdit = Boolean(quotedText && /(?:注释|说明|注解|修改代码|改代码|优化代码|重构)/.test(normalized.prompt));
      // A quoted code answer plus an edit request is a code task, even when
      // the request does not contain words such as "转换" or "生成".
      const task = this.classifyTask(normalized.prompt, normalized.inputType, quotedText);
      const chatFormula = normalized.inputType === "chat" && ["convert", "debug"].includes(task)
        ? this.extractLatexFromPrompt(normalized.prompt)
        : "";
      if (chatFormula && task !== "chat") {
        normalized.inputType = "latex";
        normalized.latex = chatFormula;
      }
      if (normalized.inputType === "chat" && ["convert", "debug"].includes(task) && input.conversation?.formula) {
        normalized.inputType = "latex";
        normalized.latex = input.conversation.formula;
      }
      const recognized = await this.recognizeFormula(normalized);
      if (!["convert", "debug"].includes(task)) {
        return this.runChat({ requestId, startedAt, normalized, recognized, conversation: input.conversation, quote: input.quote, task });
      }
      const computationStrategy = decideComputationStrategy({
        latex: recognized.latex,
        prompt: normalized.prompt,
        targetLibrary: normalized.targetLibrary,
      });
      // The agent decides the implementation library from the formula and
      // request. Explicit API choices are preserved for backwards
      // compatibility, while `auto` is resolved here before any generation
      // or validation happens.
      normalized.targetLibrary = computationStrategy.recommendedLibrary;
      const template = input.conversation?.formula || quotedText ? null : getFormulaTemplate(recognized.latex, normalized.targetLibrary);
      const templateApplied = Boolean(template);
      let generated = template || await this.generatePython({
        ...normalized,
        ...recognized,
        conversation: input.conversation,
        quotedMaterial: quotedText,
        computationStrategy,
      });
      let review = await this.reviewCode(generated, normalized.targetLibrary, recognized.latex);
      const correctionLog = [{
        type: "validation",
        label: "首次静态检查",
        passed: review.passed,
        details: review.passed ? ["代码符合目标库与安全规则"] : review.errors,
      }];

      if (!review.passed && typeof this.provider.revisePython === "function") {
        for (let attempt = 0; attempt < 2 && !review.passed; attempt += 1) {
          correctionLog.push({
            type: "revision-request",
            label: `第 ${attempt + 1} 轮模型纠错`,
            passed: null,
            details: review.errors,
          });
          generated = await this.provider.revisePython({
            latex: recognized.latex,
            targetLibrary: normalized.targetLibrary,
            prompt: normalized.prompt,
            previousCode: generated.code,
            validationErrors: review.errors,
            computationStrategy,
          });
          review = await this.reviewCode(generated, normalized.targetLibrary, recognized.latex);
          correctionLog.push({
            type: "validation",
            label: `第 ${attempt + 1} 轮纠错后检查`,
            passed: review.passed,
            details: review.passed ? ["纠错后的代码通过静态检查"] : review.errors,
          });
        }
      }

      let execution = review.passed
        ? computationStrategy.executionPolicy === "skip-complex-symbolic"
          ? this.skippedExecution(computationStrategy)
          : await runGeneratedPython(generated.code)
        : { attempted: false, passed: false, errors: review.errors, stdout: "", stderr: "" };

      if (review.passed && execution.attempted && !execution.passed && typeof this.provider.revisePython === "function") {
        correctionLog.push({
          type: "execution",
          label: "首次受限 Python 执行",
          passed: false,
          details: execution.errors,
        });
        correctionLog.push({
          type: "revision-request",
          label: "根据运行错误进行模型纠错",
          passed: null,
          details: execution.errors,
        });
        generated = await this.provider.revisePython({
          latex: recognized.latex,
          targetLibrary: normalized.targetLibrary,
          prompt: normalized.prompt,
          previousCode: generated.code,
          validationErrors: execution.errors,
          computationStrategy,
        });
        review = await this.reviewCode(generated, normalized.targetLibrary, recognized.latex);
        correctionLog.push({
          type: "validation",
          label: "运行纠错后静态检查",
          passed: review.passed,
          details: review.passed ? ["纠错后的代码通过静态检查"] : review.errors,
        });
        execution = review.passed
          ? computationStrategy.executionPolicy === "skip-complex-symbolic"
            ? this.skippedExecution(computationStrategy)
            : await runGeneratedPython(generated.code)
          : { attempted: false, passed: false, errors: review.errors, stdout: "", stderr: "" };
        correctionLog.push({
          type: "execution",
          label: "运行纠错后受限 Python 执行",
          passed: execution.passed,
          details: execution.passed ? ["代码已实际执行成功"] : execution.errors,
        });
      }

      let mathematicalVerification = quotedCodeEdit
        ? { status: "not-applicable", passed: true, details: ["引用代码编辑任务不重新推导数学结果。"] }
        : execution.passed
        ? await verifyFormulaResult({ latex: recognized.latex, code: generated.code })
        : { status: "not-run", passed: false, details: ["代码未通过执行，无法进行数学结果核对。"] };

      if (review.passed && execution.passed && !mathematicalVerification.passed && typeof this.provider.revisePython === "function") {
        correctionLog.push({
          type: "mathematical-verification",
          label: "数学结果核对",
          passed: false,
          details: mathematicalVerification.details,
        });
        correctionLog.push({
          type: "revision-request",
          label: "根据数学核对结果进行模型纠错",
          passed: null,
          details: mathematicalVerification.details,
        });
        generated = await this.provider.revisePython({
          latex: recognized.latex,
          targetLibrary: normalized.targetLibrary,
          prompt: normalized.prompt,
          previousCode: generated.code,
          validationErrors: mathematicalVerification.details,
          computationStrategy,
        });
        review = await this.reviewCode(generated, normalized.targetLibrary, recognized.latex);
        execution = review.passed
          ? computationStrategy.executionPolicy === "skip-complex-symbolic"
            ? this.skippedExecution(computationStrategy)
            : await runGeneratedPython(generated.code)
          : { attempted: false, passed: false, errors: review.errors, stdout: "", stderr: "" };
        mathematicalVerification = review.passed && execution.passed
          ? await verifyFormulaResult({ latex: recognized.latex, code: generated.code })
          : { status: "not-run", passed: false, details: review.errors || execution.errors || ["纠错后的代码未能执行"] };
        correctionLog.push({
          type: "mathematical-verification",
          label: "纠错后数学结果核对",
          passed: mathematicalVerification.passed,
          details: mathematicalVerification.details,
        });
      }

      if (!review.passed) {
        throw Object.assign(new Error(`生成的代码未通过检查：${review.errors.join("；")}`), { statusCode: 422 });
      }
      if ((!execution.attempted && !execution.skippedForSafety) || !execution.passed) {
        const reason = execution.errors?.join("；") || "未能在受限 Python 环境中执行";
        throw Object.assign(new Error(`生成的代码未实际执行成功：${reason}`), { statusCode: 422 });
      }
      if (!mathematicalVerification.passed) {
        throw Object.assign(new Error(`生成的代码未通过数学结果核对：${mathematicalVerification.details.join("；")}`), { statusCode: 422 });
      }

      return {
        requestId,
        status: "completed",
        inputType: normalized.inputType,
        recognizedLatex: recognized.latex,
        code: generated.code,
        explanation: generated.explanation,
        dependencies: generated.dependencies || [],
        warnings: [...(recognized.warnings || []), ...(review.warnings || [])],
        correctionLog,
        execution,
        mathematicalVerification,
        computationStrategy,
        confidence: recognized.confidence,
        provider: {
          name: this.provider.name,
          mode: this.provider.mode,
        },
        conversation: input.conversation?.formula ? {
          continued: true,
          formula: input.conversation.formula,
          codeVersion: input.conversation.previousCode ? "已有上一版代码" : "首次代码版本",
        } : { continued: false },
        trace: [
          { step: "理解请求", status: "completed" },
          { step: normalized.inputType === "image" ? "识别图片公式" : "解析 LaTeX", status: "completed" },
          { step: `计算策略：${computationStrategy.mode === "symbolic" ? "符号计算" : computationStrategy.mode === "numeric" ? "数值计算" : "混合计算"}`, status: "completed" },
          { step: `生成 ${normalized.targetLibrary} 代码`, status: "completed" },
          ...(templateApplied ? [{ step: "应用二次方程可靠模板", status: "completed" }] : []),
          { step: "静态安全检查", status: review.passed ? "completed" : "failed" },
          { step: "受限 Python 执行", status: execution.skippedForSafety ? "skipped" : execution.attempted ? (execution.passed ? "completed" : "failed") : "skipped" },
          { step: "数学结果核对", status: mathematicalVerification.status === "verified" ? "completed" : "skipped" },
        ],
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      error.requestId = requestId;
      throw error;
    }
  }

  classifyTask(prompt, inputType = "chat", quotedText = "") {
    const text = String(prompt || "").trim();
    if (inputType === "image" && !text) return "convert";
    if (/(?:报错|错误|异常|失败|debug|bug|修正|纠错|为什么.*运行|不能运行)/i.test(text)) return "debug";
    if (/(?:转换|转(?:成|为)|改成|生成|写成|实现|运行代码|python代码|代码实现|程序实现|注释|修改代码|改代码|重构|优化代码)/i.test(text)) return "convert";
    if (quotedText && /(?:^|\n)\s*(?:import\s+|from\s+\w+\s+import|def\s+\w+|class\s+\w+|print\s*\(|[A-Za-z_]\w*\s*=\s*(?:sp\.|np\.|cmath\.|math\.))/m.test(quotedText)
      && /(?:添加|加入|补充|增加|修改|改|优化|重构|注释|说明)/.test(text)) return "convert";
    if (/(?:推导|证明|演算|推演|derive)/i.test(text)) return "derive";
    if (/(?:比较|区别|差异|优缺点|compare)/i.test(text)) return "compare";
    if (/(?:替换|代入|令\s*[A-Za-z]|改为|换成|取\s*[A-Za-z])/i.test(text)) return "replace";
    if (/(?:解释|含义|意义|是什么|怎么理解|为什么|概念|explain)/i.test(text)) return "explain";
    return "chat";
  }

  isChatRequest(prompt) {
    return !["convert", "debug"].includes(this.classifyTask(prompt));
  }

  extractLatexFromPrompt(prompt) {
    const source = String(prompt || "");
    const match = source.match(/(\\(?:frac|int|sum|sqrt|left|right|begin|lim|sin|cos|tan|log|mathrm|alpha|beta|gamma|delta|theta|pi)[\s\S]*|(?:[A-Za-z0-9_{}^=+\-*/(),.]+\s*){2,})/);
    if (!match) return "";
    const candidate = match[1].replace(/(?:转(?:为|成)?|转换(?:成)?|生成|写成|python|代码|请|帮我).*$/i, "").trim();
    return /[\\^_=]/.test(candidate) ? candidate : "";
  }

  async runChat({ requestId, startedAt, normalized, recognized, conversation, quote, task = "chat" }) {
    if (typeof this.provider.chat !== "function") {
      throw Object.assign(new Error("当前模型不支持自由对话"), { statusCode: 502 });
    }
    const response = await this.provider.chat({
      prompt: normalized.prompt,
      latex: recognized.latex,
      conversation,
      quote: String(quote?.text || "").slice(0, 12000),
      task,
    });
    if (!response.answer || !String(response.answer).trim()) {
      throw Object.assign(new Error("模型没有返回聊天回答"), { statusCode: 502 });
    }
    return {
      requestId,
      status: "completed",
      kind: "chat",
      task,
      inputType: normalized.inputType,
      recognizedLatex: recognized.latex,
      answer: String(response.answer),
      confidence: recognized.confidence,
      provider: { name: this.provider.name, mode: this.provider.mode },
      conversation: { continued: Boolean(conversation?.formula) },
      trace: [{ step: "理解问题", status: "completed" }, { step: "生成聊天回答", status: "completed" }],
      durationMs: Date.now() - startedAt,
    };
  }

  validateAndNormalize(input = {}) {
    const inputType = ["latex", "image", "chat"].includes(input.inputType) ? input.inputType : "chat";
    const prompt = String(input.prompt || "").trim();
    const targetLibrary = ["SymPy", "NumPy", "纯 Python", "auto"].includes(input.targetLibrary)
      ? input.targetLibrary
      : "auto";

    if (inputType === "chat") {
      if (!prompt) throw Object.assign(new Error("请输入你的问题"), { statusCode: 400 });
      return { inputType, latex: "", prompt, targetLibrary };
    }

    if (inputType === "latex") {
      const latex = String(input.latex || "").trim();
      if (!latex) throw Object.assign(new Error("请输入 LaTeX 源代码"), { statusCode: 400 });
      if (latex.length > 12000) throw Object.assign(new Error("LaTeX 内容过长"), { statusCode: 400 });
      return { inputType, latex, prompt: prompt || "请将这个数学公式转换为 Python 代码", targetLibrary };
    }

    const image = input.image || {};
    if (!image.dataUrl || !String(image.dataUrl).startsWith("data:image/")) {
      throw Object.assign(new Error("请上传有效的公式图片"), { statusCode: 400 });
    }
    return {
      inputType,
      image: {
        name: String(image.name || "formula.png"),
        mimeType: String(image.mimeType || "image/png"),
        dataUrl: image.dataUrl,
      },
      prompt: prompt || "请将这个数学公式转换为 Python 代码",
      targetLibrary,
    };
  }

  async recognizeFormula(input) {
    if (input.inputType === "chat") {
      return { latex: "", confidence: 1, warnings: [] };
    }
    if (input.inputType === "latex") {
      return {
        latex: input.latex.replace(/^\$+|\$+$/g, "").trim(),
        confidence: 1,
        warnings: [],
      };
    }
    return this.provider.recognizeFormula(input.image);
  }

  async generatePython(context) {
    return this.provider.generatePython(context);
  }

  async reviewCode(generated, targetLibrary, latex = "") {
    if (!generated.code || !generated.code.trim()) {
      throw Object.assign(new Error("模型没有返回 Python 代码"), { statusCode: 502 });
    }
    return validateGeneratedPython(generated.code, generated.dependencies || [], targetLibrary, latex);
  }

  skippedExecution(strategy) {
    return {
      attempted: false,
      passed: true,
      skippedForSafety: true,
      errors: [],
      stdout: "",
      stderr: "",
      safetyReason: `Agent 决策为符号计算：${strategy.reasons.join("；")}。已保留符号代码，不强制进行不可靠的数值执行。`,
    };
  }
}

module.exports = { FormulaAgent };
