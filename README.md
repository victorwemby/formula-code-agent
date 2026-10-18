# Formula Code Agent

A locally hosted AI agent that converts formula images or LaTeX into Python code and supports follow-up conversations about mathematics. It recognizes formulas, selects a computation strategy, generates code, validates it, executes it when appropriate, checks supported mathematical results, and requests corrections when validation fails.

## Current features

- Formula image upload, drag and drop, preview, and file size checks.
- Direct LaTeX input and natural-language conversations.
- Automatic selection of SymPy, NumPy/SciPy, or standard-library Python.
- Symbolic, numerical, and hybrid strategies, with execution skipped for certain complex symbolic formulas.
- Session context, follow-up questions, and quoted code or messages.
- Formula display, confidence, dependencies, warnings, computation decisions, validation results, and execution traces.
- Code copying and `.py` downloads in the web interface.
- Static checks, restricted execution, supported mathematical result checks, and automatic correction attempts.
- Mock and Ollama providers, a Chrome/Edge extension, and an MCP tool.

The mock provider uses a demonstration formula for images and predefined implementations for some formulas. For other formulas, it preserves the LaTeX source and returns a library-specific starter example rather than a complete mathematical implementation. It exercises the workflow without real image recognition. The current application interface and much of its task routing use Chinese.

## Demonstration

> **Please refer to the demonstration images in the project's `demonstration image` folder.**

## Quick start

Install Node.js 18 or later. No third-party npm dependencies or frontend build are currently required. From the project root:

```powershell
npm start
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). The provider defaults to `mock` unless `AI_PROVIDER` is already set. Windows users can also run `.\start.ps1`; install Node.js on `PATH` because its bundled-runtime fallback is machine-specific.

### Python execution

Python 3.11 or later is recommended. On Windows, run:

```powershell
.\setup-python.ps1
```

The script creates `.python-env`, tries an available local dependency cache, and falls back to pip when its dependency check fails. Required packages include SymPy, NumPy, SciPy, and the ANTLR LaTeX parser runtime.

Use `PYTHON_EXECUTABLE` to select another prepared interpreter. The web interface and chat can start without Python, but conversions requiring execution can fail when the interpreter or dependencies are missing.

### Local models with Ollama

Install and start [Ollama](https://ollama.com), then run:

```powershell
ollama pull qwen2.5vl:7b
ollama pull qwen2.5-coder:7b
.\start-ollama.ps1
```

The vision model recognizes formula images; the code model handles conversation, generation, and corrections. Provider settings can also be changed from the web interface.

Manual startup with custom settings:

```powershell
$env:AI_PROVIDER = 'open-source'
$env:OLLAMA_BASE_URL = 'http://127.0.0.1:11434'
$env:VISION_MODEL = 'qwen2.5vl:7b'
$env:CODE_MODEL = 'qwen2.5-coder:7b'
$env:MODEL_TIMEOUT_MS = '120000'
node server.js
```

## Browser extension

1. Start the local web backend.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable **Developer mode** and choose **Load unpacked**.
4. Select the `browser-extension` folder.

The extension shares the backend provider and defaults to `http://127.0.0.1:4173`. See the [extension guide](browser-extension/README.md).

## MCP integration

The stdio MCP server reuses `FormulaAgent` through the `formula_agent` tool. It supports formulas, conversation, generation, validation, execution, corrections, and session context independently of the HTTP server.

```powershell
npm run mcp
```

Use [mcp-config.example.json](mcp-config.example.json) as a client configuration example, replacing its absolute paths with your own. It registers `formula-code-agent` for Ollama and `formula-code-agent-mock` for demonstrations. Restart the MCP client after updating its configuration.

Reuse the returned `session.id` as `sessionId` for follow-up messages. MCP clients can request `targetLibrary: "auto"`, `"SymPy"`, or `"NumPy"`; the standard-library option retains its existing Chinese API identifier. HTTP conversion always uses automatic library selection.

## HTTP API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Return service status and provider configuration |
| `POST /api/config` | Switch mock/Ollama providers at runtime |
| `POST /api/convert` | Submit a formula or conversation message |

Example request to `POST /api/convert` with `Content-Type: application/json`:

```json
{
  "inputType": "latex",
  "latex": "\\frac{x^2 + 1}{2}"
}
```

Omitting `prompt` for LaTeX or image input uses the built-in conversion instruction. An optional `prompt` supplies a request, `sessionId` continues a session, and `quote: { "text": "..." }` provides quoted context. For images, use `inputType: "image"` and an `image` object with a `data:image/...` URL in `dataUrl`. For conversation, use `inputType: "chat"` with a nonempty `prompt`.

Conversion responses include the formula, code, dependencies, warnings, confidence, provider, computation strategy, correction log, execution results, mathematical verification, trace, and session metadata. Chat responses contain an `answer`.

Independent mathematical result checks currently cover supported quadratic-formula implementations. Other formulas can receive a `structural` verification status and still require manual mathematical review; successful execution alone does not establish mathematical correctness.

## Architecture

```text
Web interface / extension     MCP client
           |                     |
    POST /api/convert     stdio formula_agent
           |                     |
           +---- FormulaAgent ---+
                       |
              Normalize and classify
                       |
               Recognize formula
                       |
          Chat or select computation strategy
                       |
           Generate Python / apply template
                       |
           Static checks and corrections
                       |
        Restricted execution when appropriate
                       |
        Supported mathematical verification
                       |
                Structured result
```

`src/agent/` contains orchestration, sessions, strategies, templates, validation, execution, and verification. `src/providers/` contains mock and Ollama integrations. Provider methods include `recognizeFormula`, `generatePython`, `chat`, and `revisePython`.

## Tests and deployment

```powershell
npm test
npm run verify
```

The deployment check probes Python dependencies and the Ollama model-list endpoint. It reports failure if either check fails, even when mock web mode remains usable.

See the [deployment guide](deployment%20instrcutions.md) for configuration, troubleshooting, and production requirements.

The executor uses a temporary directory, import restrictions, a five-second timeout, and capped captured output. These controls are not a security sandbox. Public deployment requires authentication and stronger execution isolation as described in the guide.
