class OpenSourceProvider {
  constructor(config = {}) {
    this.baseUrl = (config.baseUrl || process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
    this.visionModel = config.visionModel || process.env.VISION_MODEL || "qwen2.5vl:7b";
    this.codeModel = config.codeModel || process.env.CODE_MODEL || "qwen2.5-coder:7b";
    this.name = config.name || process.env.AI_MODEL_NAME || `${this.visionModel} + ${this.codeModel}`;
    this.mode = "open-source";
  }

  async requestModel(model, message) {
    let response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [message], stream: false, format: "json" }),
        signal: AbortSignal.timeout(Number(process.env.MODEL_TIMEOUT_MS || 60000)),
      });
    } catch (error) {
      throw Object.assign(new Error(`无法连接 Ollama：${error.message}`), { statusCode: 502 });
    }
    if (!response.ok) {
      const detail = await response.text();
      throw Object.assign(new Error(`模型请求失败：${response.status} ${detail}`), { statusCode: 502 });
    }
    const result = await response.json();
    const content = result.message?.content;
    if (!content) throw Object.assign(new Error("模型没有返回内容"), { statusCode: 502 });
    try {
      return typeof content === "string" ? JSON.parse(content) : content;
    } catch {
      throw Object.assign(new Error("模型没有返回有效的 JSON"), { statusCode: 502 });
    }
  }

  async recognizeFormula(image) {
    const base64Image = image.dataUrl.replace(/^data:image\/[^;]+;base64,/, "");
    const result = await this.requestModel(this.visionModel, {
      role: "user",
      content: "识别图片中的数学公式，只返回 JSON。字段为 latex、confidence、warnings。latex 必须是规范 LaTeX。严格保留分式结构：看到横线分子/分母必须使用 \\frac{分子}{分母}，不要把分母写成普通除法；保留上下标、括号、根号和 \\pm。无法辨认的内容写入 warnings。只输出公式本身，不要输出解释或代码。",
      images: [base64Image],
    });
    if (!result.latex) throw Object.assign(new Error("视觉模型没有识别出 LaTeX 公式"), { statusCode: 502 });
    const latex = normalizeVisionLatex(String(result.latex));
    const warnings = Array.isArray(result.warnings) ? result.warnings : [];
    if (latex !== String(result.latex).trim()) warnings.push("视觉模型输出已进行 LaTeX 结构规范化，请核对识别结果。 ");
    return {
      latex,
      confidence: Number(result.confidence || 0.8),
      warnings,
    };
  }

  async chat({ prompt, latex, conversation, quote = "", task = "chat" }) {
    const context = conversation?.formula
      ? `\n可参考的会话背景（仅在相关时使用）：当前公式：${conversation.formula}\n历史对话：${conversation.history?.map((item) => `${item.role}：${item.content}`).join("\n") || "无"}`
      : "";
    const quotedMaterial = quote
      ? `\n\n【必须阅读的引用材料】\n${quote}\n【引用材料结束】\n回答时必须直接利用这段材料，不要说“未提供公式/具体内容”，除非材料确实为空。`
      : "";
    const result = await this.requestModel(this.codeModel, {
      role: "user",
      content: `你是数学 AI 助手。请直接回答用户问题，严格只返回 JSON，字段为 answer。任务类型：${task}。${quotedMaterial}\n用户问题：${prompt}${context}\n用户可以自由讨论数学概念、推导、学习问题或与当前公式有关的问题。用户提供引用时，应优先围绕引用材料回答，并明确指出材料中的公式、代码或结论。用中文清晰回答；需要时可以使用简短 LaTeX。不要生成 Python 代码。若任务是 derive，请分步骤推导；若是 compare，请比较 SymPy、NumPy、纯 Python；若是 replace，请明确代入前后结果；若是 explain，请解释公式和变量；若是 debug，请分析原因和修复方向。`,
    });
    return { answer: result.answer };
  }

  async generatePython({ latex, targetLibrary, prompt, conversation, quotedMaterial = "", computationStrategy }) {
    const context = conversation?.formula
      ? `\n可参考的会话背景（仅在与本轮问题相关时使用）：\n当前公式：${conversation.formula}\n上一版代码：\n${conversation.previousCode || "无"}\n变量和约束：${conversation.variableConstraints?.join("；") || "无"}\n历史对话：${conversation.history?.map((item) => `${item.role}：${item.content}`).join("\n") || "无"}`
      : "";
    const result = await this.requestModel(this.codeModel, {
      role: "user",
      content: `你是数学公式与 Python 代码对话 Agent。严格只返回 JSON，字段为 code、explanation、dependencies。\n本轮可用公式：${latex}\n目标库：${targetLibrary}\nAgent 计算策略：${JSON.stringify(computationStrategy || {})}\n必须遵守的策略：${computationStrategy?.instruction || "生成符合目标库的安全代码。"}\n用户问题：${prompt}${quotedMaterial ? `\n\n【必须修改的引用代码】\n${quotedMaterial}\n【引用代码结束】\n这是本轮唯一要修改的代码。必须在该代码基础上完成用户要求，不能改为回答代码之外的历史话题。` : ""}${context}\n优先回答用户本轮问题。仅当用户的问题与会话背景有关时才引用背景；用户可以自由切换到新的数学问题、概念解释或新的代码需求。若本轮问题要求生成或修改代码，代码必须对应用户明确提到的公式或相关背景；先定义所有变量；SymPy 无穷量使用 sp.oo；不得使用 eval 或 exec；代码必须包含正确的库导入和可运行的输出。目标库必须严格遵守：SymPy 必须导入 sympy；NumPy 必须导入 numpy 且不得导入 sympy，数值积分可额外导入 scipy.integrate（例如 quad）；纯 Python 不得导入 sympy、numpy、scipy，只能使用 Python 标准库。不要在 explanation 中描述与实际 code 相矛盾的内容。`,
    });
    if (!result.code) throw Object.assign(new Error("代码模型没有返回 Python 代码"), { statusCode: 502 });
    return {
      code: String(result.code),
      explanation: result.explanation || "代码已由开源模型生成。",
      dependencies: Array.isArray(result.dependencies) ? result.dependencies : [],
    };
  }

  async revisePython({ latex, targetLibrary, prompt, previousCode, validationErrors, computationStrategy }) {
    const result = await this.requestModel(this.codeModel, {
      role: "user",
      content: `修正以下 Python 代码。严格只返回 JSON，字段为 code、explanation、dependencies。\nLaTeX：${latex}\n目标库：${targetLibrary}\nAgent 计算策略：${JSON.stringify(computationStrategy || {})}\n必须遵守的策略：${computationStrategy?.instruction || "修正为安全、可运行的代码。"}\n用户要求：${prompt}\n原代码：\n${previousCode}\n检查错误：\n${validationErrors.join("；")}\n要求：修复全部错误，保留公式数学含义，不得使用 eval、exec、文件、网络或系统调用。严格遵守目标库：SymPy 必须导入 sympy；NumPy 必须导入 numpy 且不得导入 sympy，数值积分可导入 scipy.integrate；纯 Python 不得导入 sympy、numpy、scipy，只能使用标准库。必须返回完整 JSON，不要返回说明文字或 Markdown。`,
    });
    if (!result.code) throw Object.assign(new Error("代码模型没有返回修正后的 Python 代码"), { statusCode: 502 });
    return {
      code: String(result.code),
      explanation: result.explanation || "代码已根据静态检查结果修正。",
      dependencies: Array.isArray(result.dependencies) ? result.dependencies : [],
    };
  }
}

function normalizeVisionLatex(latex) {
  let value = latex.trim().replace(/^\$+|\$+$/g, "");
  const fraction = value.match(/^(.+?)\s*\\pm\s*(\\sqrt\{[^}]+\}|[^/]+)\s*/);
  if (fraction && !/\\frac/.test(value) && /\/\s*2a$/.test(value)) {
    const numerator = `${fraction[1]}\\pm${fraction[2]}`.replace(/^-b/, "-b");
    value = `\\frac{${numerator}}{2a}`;
  }
  return value;
}

module.exports = { OpenSourceProvider };
