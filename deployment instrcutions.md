# Formula Code Agent Deployment Guide

## 1. Overview

Formula Code Agent is a locally hosted conversational agent for mathematics. It accepts LaTeX or formula images, supports follow-up questions, and generates Python code using an automatically selected symbolic, numerical, or hybrid computation strategy.

The implementation includes static checks, restricted execution, supported mathematical result verification, and automatic correction attempts. It offers a web interface, a Chrome/Edge extension, and an independent stdio MCP server. Mock and Ollama providers are available.

No database or frontend build is required. The HTTP process serves both static files and the API. Sessions are stored in memory and are lost when their server process restarts. The current application interface and much of its task routing use Chinese.

## 2. Project layout

```text
formula-code-agent/
|-- public/                  Web frontend
|-- browser-extension/       Chrome / Edge extension
|-- src/agent/               Orchestration, strategies, sessions, validation, execution
|-- src/providers/           Mock and Ollama providers
|-- tests/                   Automated tests
|-- demonstration image/     Example screenshots and formula input
|-- server.js                HTTP server entry point
|-- mcp-server.js            stdio MCP server
|-- mcp-config.example.json  Example MCP client configuration
|-- start.ps1                Web startup script; mock by default
|-- start-ollama.ps1         Ollama web startup script
|-- setup-python.ps1         Windows Python environment setup
|-- verify-deployment.js     Python and Ollama checks
`-- package.json             npm commands and Node.js requirement
```

## 3. Requirements

| Component | Requirement or default |
| --- | --- |
| Operating system | Windows 10/11 for supplied setup scripts; manual setup on Linux/macOS |
| Node.js | Version 18 or later |
| Python | Version 3.11 or later recommended for execution and verification |
| Ollama | Required for local model mode; optional for mock mode |
| Browser | Current Chrome or Edge recommended |
| HTTP address | `127.0.0.1:4173`, configurable through `HOST` and `PORT` |
| Ollama address | `http://127.0.0.1:11434` |
| Storage | Approximately 11 GB for the two default 7B model downloads, plus Python and dependencies; actual usage varies |
| RAM / VRAM | Depends on quantization and hardware; loading and switching models can add latency |

Check the tools you intend to use:

```powershell
node --version
npm --version
python --version
ollama --version
```

## 4. Prepare the project

Copy or clone the complete project, then open a terminal in its root directory. For example:

```powershell
Set-Location 'C:\projects\formula-code-agent'
```

There are currently no third-party npm runtime dependencies, so `npm install` is not needed. Revisit this if dependencies are added to `package.json`.

Install Node.js on `PATH`. The optional bundled Node.js fallback in `start.ps1` points to a machine-specific location.

## 5. Configure Python

On Windows, run:

```powershell
.\setup-python.ps1
```

The script creates `.python-env`. It tries an available `.python-packages-v2` or legacy `.python-packages` cache for copying dependencies. If its import check fails, it invokes pip to install or upgrade SymPy, NumPy, SciPy, and `antlr4-python3-runtime==4.11.*`.

Verify the environment, including the LaTeX parser:

```powershell
.\.python-env\Scripts\python.exe -c "import sympy, numpy, scipy; from sympy.parsing.latex import parse_latex; print(parse_latex(r'\frac{x^2+1}{2}'))"
```

To select an existing prepared interpreter at runtime:

```powershell
$env:PYTHON_EXECUTABLE = 'C:\Python311\python.exe'
```

`PYTHON_EXECUTABLE` selects the interpreter used by the executor and deployment checker; the setup script locates Python separately. Install the required packages in whichever interpreter you select.

On Linux/macOS, create the environment manually and explicitly set its executable because the current executor's automatic project-environment discovery uses the Windows layout:

```bash
python3 -m venv .python-env
.python-env/bin/python -m pip install sympy numpy scipy 'antlr4-python3-runtime==4.11.*'
export PYTHON_EXECUTABLE="$PWD/.python-env/bin/python"
```

The web service and chat can start without Python. Conversions requiring execution fail if no suitable interpreter or dependencies are found. Some complex symbolic operations deliberately skip execution.

## 6. Run the mock web service

Mock mode exercises the interface and orchestration without real model inference. Explicitly select it if the shell has previously used Ollama mode:

```powershell
$env:AI_PROVIDER = 'mock'
npm start
```

Alternatively, run `.\start.ps1`. That script preserves existing environment variables rather than forcing mock mode.

Open [http://127.0.0.1:4173](http://127.0.0.1:4173) and check:

```powershell
Invoke-RestMethod http://127.0.0.1:4173/api/health
```

Expect `status: ok` and `mode: mock`. Mock image input uses a demonstration formula; it does not recognize the uploaded image.

The mock provider has predefined implementations for some formulas. For arbitrary formulas, it returns a starter example that preserves the input rather than a complete implementation. Use Ollama mode to evaluate model-generated conversions.

## 7. Run with Ollama models

Install and start [Ollama](https://ollama.com), then check its API:

```powershell
Invoke-RestMethod http://127.0.0.1:11434/api/tags
```

Download and list the default models:

```powershell
ollama pull qwen2.5vl:7b
ollama pull qwen2.5-coder:7b
ollama list
```

The vision model extracts LaTeX from images. The code model handles conversation, generation, and corrections. Start the service:

```powershell
.\start-ollama.ps1
```

For manual startup or custom settings:

```powershell
$env:AI_PROVIDER = 'open-source'
$env:OLLAMA_BASE_URL = 'http://127.0.0.1:11434'
$env:VISION_MODEL = 'qwen2.5vl:7b'
$env:CODE_MODEL = 'qwen2.5-coder:7b'
$env:MODEL_TIMEOUT_MS = '120000'
node server.js
```

The web address remains the same. `/api/health` should report `mode: open-source`. This endpoint reports the HTTP configuration; it does not perform live inference. Verify Ollama connectivity and make an actual conversion request as well.

## 8. Change the HTTP address

If the default port is occupied:

```powershell
$env:HOST = '127.0.0.1'
$env:PORT = '4200'
.\start-ollama.ps1
```

Open [http://127.0.0.1:4200](http://127.0.0.1:4200). The port applies to both the web interface and API. Update the extension's backend settings if needed.

Inspect listeners on the default port:

```powershell
netstat -ano | Select-String ':4173'
```

## 9. Install the browser extension

1. Start the HTTP backend.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable **Developer mode** and choose **Load unpacked**.
4. Select the `browser-extension` directory.
5. Refresh existing pages where you want to use selection actions.

The extension defaults to `http://127.0.0.1:4173`. Its settings allow another backend URL. The manifest permits `http://127.0.0.1/*` and `http://localhost/*`; another host or HTTPS requires updating `host_permissions` and reloading the extension. See the [extension guide](browser-extension/README.md).

## 10. HTTP API

| Method and path | Purpose |
| --- | --- |
| `GET /api/health` | Read service status and provider settings |
| `POST /api/config` | Change the shared HTTP provider configuration |
| `POST /api/convert` | Convert a formula or send a conversation message |

### Formula conversion

Send JSON with `Content-Type: application/json`:

```json
{
  "inputType": "latex",
  "latex": "\\frac{x^2+1}{2}"
}
```

Omitting `prompt` uses the built-in conversion instruction. PowerShell example:

```powershell
$body = @{
  inputType = 'latex'
  latex = '\frac{x^2+1}{2}'
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri 'http://127.0.0.1:4173/api/convert' `
  -Method Post `
  -ContentType 'application/json' `
  -Body $body
```

The HTTP endpoint always selects the target library automatically, even if a client sends `targetLibrary`. Successful conversions return code, formula recognition, computation decisions, validation and execution results, and session metadata. Validation or execution failures can return HTTP 422 after correction attempts.

Independent mathematical result checks currently cover supported quadratic-formula implementations. A `mathematicalVerification.status` of `structural` means the result still requires manual mathematical review. Some code forms cannot be checked by the quadratic verifier either. A successful response does not imply that an arbitrary formula has been independently verified.

### Conversation and image input

Use `inputType: "chat"` and a nonempty `prompt` for conversation. Supply the previous response's `session.id` as `sessionId` to reuse context. `quote: { "text": "..." }` supplies quoted text or code. Chat responses contain an `answer`.

For images, use `inputType: "image"` and `image: { "name": "formula.png", "mimeType": "image/png", "dataUrl": "data:image/png;base64,..." }`. Browser interfaces limit image files to 8 MB; the HTTP server limits the entire JSON body to 12 MB, including base64 overhead.

### Provider configuration

`POST /api/config` accepts `provider` (`mock` or `open-source`), `baseUrl`, `visionModel`, `codeModel`, and an optional display `name`. It changes the shared HTTP provider and checks Ollama's model-list endpoint when selecting `open-source`. It does not update a separate MCP process.

## 11. MCP server

Run the stdio MCP server independently of the web service:

```powershell
npm run mcp
```

Configure your MCP client using [mcp-config.example.json](mcp-config.example.json). Replace the absolute paths in both entries with your project's `mcp-server.js` path and ensure the client can find `node`.

The example registers `formula-code-agent` for Ollama and `formula-code-agent-mock` for demonstrations. Each exposes `formula_agent` and keeps its own in-memory sessions. Restart the client after changes. Add `PYTHON_EXECUTABLE` to the server entry's environment if automatic discovery cannot find the interpreter.

The tool accepts `inputType` (`latex`, `image`, or `chat`), `latex`, `image`, `prompt`, `targetLibrary`, `sessionId`, and `quote`. It can infer input type from the supplied fields. Reuse the returned `session.id` as `sessionId` for follow-up messages.

Unlike the HTTP endpoint, the MCP tool preserves explicit library choices. Use `auto`, `SymPy`, or `NumPy`; the standard-library option retains the existing Chinese identifier shown in the tool schema.

## 12. Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | HTTP listening address |
| `PORT` | `4173` | HTTP listening port |
| `AI_PROVIDER` | `mock` | `mock` or `open-source` |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama API address |
| `VISION_MODEL` | `qwen2.5vl:7b` | Formula recognition model |
| `CODE_MODEL` | `qwen2.5-coder:7b` | Conversation, generation, and correction model |
| `MODEL_TIMEOUT_MS` | `60000` | Timeout per Ollama request, in milliseconds |
| `AI_MODEL_NAME` | Derived from model names | Optional Ollama provider display name |
| `PYTHON_EXECUTABLE` | Auto-discovered | Interpreter for execution and verification |

Set variables before starting the relevant process. Provider changes made through web settings apply to the running HTTP process.

## 13. Tests and deployment checks

From the project root:

```powershell
npm test
npm run verify
```

The deployment check probes Python imports for SymPy, NumPy, and SciPy, then requests Ollama's `/api/tags` endpoint and lists models. It exits with failure if either check fails. Unavailable Ollama does not prevent mock mode from working. Successful model listing does not guarantee that configured models are installed or can perform inference.

Before demonstrating the selected mode, confirm:

1. Node.js is version 18 or later and automated tests pass.
2. `/api/health` reports the expected provider mode.
3. The selected Python interpreter imports required packages and parses LaTeX.
4. LaTeX input generates code and displays the computation decision.
5. Ollama image input recognizes the supplied formula rather than returning a mock example.
6. Follow-up messages preserve the formula and conversation context.
7. Execution and mathematical verification results are inspected, including skipped checks.
8. The extension or MCP client works if included in the deployment.

## 14. Troubleshooting

### The web page will not open

Keep the server terminal open and request `/api/health`. If the port is occupied, set another `PORT` and restart. Avoid multiple HTTP processes on the same address and port.

### The page shows old content

Press `Ctrl+F5`. Confirm that the browser URL matches the running server's port.

### Ollama cannot be reached

```powershell
Invoke-RestMethod http://127.0.0.1:11434/api/tags
ollama list
```

Check that Ollama is running, model names match exactly, and `OLLAMA_BASE_URL` is correct for the server process.

### Model requests time out

Initial loading may take longer than later requests. Increase `MODEL_TIMEOUT_MS`, for example to `120000`, and check available RAM and VRAM.

### Generated code fails execution

```powershell
Test-Path .\.python-env\Scripts\python.exe
.\.python-env\Scripts\python.exe -c "import sympy, numpy, scipy"
```

Check `PYTHON_EXECUTABLE` if set, inspect the error, and rerun setup if dependencies are missing. Some complex symbolic expressions deliberately skip execution to avoid expensive evaluation; this does not establish that their numerical results have been verified.

### An English request produces chat instead of code

The classifier primarily recognizes Chinese conversion instructions. For basic conversion, submit LaTeX or an image without a custom `prompt` to use the built-in instruction. English task routing is not complete.

## 15. Production deployment

The implementation is intended for local experiments, coursework demonstrations, and trusted environments. Before public deployment:

1. Add authentication and authorization to conversion and configuration endpoints.
2. Restrict the permissive CORS policy to trusted origins.
3. Add HTTPS, a reverse proxy, rate limits, and audit logging.
4. Replace in-memory sessions with persistent or distributed storage.
5. Run generated Python in a separate container or stronger sandbox with CPU, memory, filesystem, network, and process restrictions.
6. Keep unauthenticated Ollama endpoints off the public internet.
7. Strengthen image validation, content checks, and storage cleanup where applicable.
8. Configure process supervision, restarts, log rotation, and health monitoring.

The executor uses a temporary working directory, an import allowlist, a five-second timeout, and capped captured output. It launches Python with `-B`; it does not use Python's `-I` isolation mode. These controls do not replace operating-system-level isolation.
