# Formula Code Agent

一个可运行的 AI Agent 原型：接收数学公式图片或 LaTeX 源码，通过“识别 → 解析 → 生成 → 静态检查 → 受限执行 → 自动修正”的流程返回 Python 代码。

## 当前能力

- 图片上传、拖拽、预览与大小校验
- LaTeX 源码直接输入
- 自然语言转换要求
- SymPy、NumPy、纯 Python 三种目标
- 对话式结果、LaTeX 回显、置信度、依赖和 Agent 执行轨迹
- 代码复制与 `.py` 下载
- 生成后实际运行 Python：独立临时目录、隔离模式、5 秒超时、输出大小限制和库白名单
- 静态检查或执行失败时，将错误反馈给代码模型并自动修正一次、再次验证
- 可插拔 Provider；当前默认启用 Mock Provider
- Chrome / Edge 浏览器扩展：侧边栏、选区悬浮按钮和右键转换

> Mock Provider 会让 LaTeX 输入走真实的结构化流程并生成通用 SymPy 解析代码；图片输入使用演示公式。它只用于在开源模型选型前验证完整产品交互。

## 运行

需要 Node.js 18 或更高版本，无需安装第三方依赖。

Windows 下可以直接运行（脚本会自动寻找系统或 Codex 自带的 Node.js）：

```powershell
.\start.ps1
```

也可以使用 npm：

```bash
npm start
```

打开 <http://127.0.0.1:4173>。

### 配置 Python 执行环境

要启用“实际执行并自动修正”功能，需要 Python 3.11 或更高版本。在项目根目录运行一次：

```powershell
.\\setup-python.ps1
```

脚本会在项目中创建 `.python-env`，并安装 SymPy、NumPy、SciPy 和 LaTeX 解析依赖。没有该环境时，网站仍会生成和静态检查代码，但会提示未实际执行。

## 浏览器扩展

网页版会继续保留。浏览器扩展位于 `browser-extension`，它复用同一个本地 Agent 后端。

安装步骤：

1. 启动本项目后端。
2. Chrome 打开 `chrome://extensions`，Edge 打开 `edge://extensions`。
3. 开启开发者模式，点击“加载已解压的扩展程序”。
4. 选择项目中的 `browser-extension` 文件夹。

详细使用说明参见 `browser-extension/README.md`。

## MCP 工具

项目已提供标准输入输出模式的 MCP Server，注册的工具名为 `formula_agent`。它复用网页使用的同一个 `FormulaAgent`，支持 LaTeX、公式图片、自然语言对话、代码生成、纠错、执行和会话上下文。

直接启动：

```powershell
npm run mcp
```

MCP 客户端配置示例见 `mcp-config.example.json`。示例同时注册了 `formula-code-agent`（本地 Ollama 真实模型）和 `formula-code-agent-mock`（演示模型），二者互不替换。重启客户端后即可分别调用两套服务中的 `formula_agent`。调用时复用返回结果中的 `session.id`，即可继续同一公式的对话。

运行测试：

```bash
npm test
```

部署自检（检查项目 Python 依赖和本地 Ollama）：

```bash
npm run verify
```

## 架构

```text
浏览器 UI
  └─ POST /api/convert
       └─ FormulaAgent
            ├─ validateAndNormalize()
            ├─ recognizeFormula()
            ├─ generatePython()
            └─ reviewCode()
                 └─ Provider（Mock / 开源模型）
```

`FormulaAgent` 负责任务编排和统一输出；`Provider` 负责具体模型调用。更换模型不会影响前端接口。

## 接入开源模型

项目已内置 Ollama Provider。安装 Ollama 后，先下载一个视觉模型和一个代码模型：

```powershell
ollama pull qwen2.5vl:7b
ollama pull qwen2.5-coder:7b
```

然后在项目根目录运行：

```powershell
.\start-ollama.ps1
```

启动成功后，页面右上角会从 `MOCK MODE` 变为 `MODEL ONLINE`。默认模型名称可通过环境变量调整：

```powershell
$env:VISION_MODEL = "qwen2.5vl:7b"
$env:CODE_MODEL = "qwen2.5-coder:7b"
.\start-ollama.ps1
```

Ollama 默认服务地址为 `http://127.0.0.1:11434`，也可用 `OLLAMA_BASE_URL` 覆盖。

Provider 的核心接口如下：

```js
async recognizeFormula(image) {
  // 返回 { latex, confidence, warnings }
}

async generatePython(context) {
  // 返回 { code, explanation, dependencies }
}
```

也可以手动启动：

```powershell
$env:AI_PROVIDER="open-source"
$env:VISION_MODEL="qwen2.5vl:7b"
$env:CODE_MODEL="qwen2.5-coder:7b"
node server.js
```

建议的开源组件：

- 公式 OCR：Pix2Text、LaTeX-OCR、Qwen2.5-VL、InternVL
- 代码模型：Qwen2.5-Coder、DeepSeek-Coder
- 本地推理服务：Ollama、vLLM

生产环境建议把视觉识别和代码生成拆成两个 Provider，并增加鉴权、持久化、限流和 Python 沙箱执行。

## API 示例

```json
POST /api/convert
{
  "inputType": "latex",
  "latex": "\\frac{x^2 + 1}{2}",
  "prompt": "转换成 Python，并添加中文注释",
  "targetLibrary": "SymPy"
}
```

服务会返回识别公式、Python 代码、依赖、警告、置信度、Provider 信息和 Agent 执行轨迹。
