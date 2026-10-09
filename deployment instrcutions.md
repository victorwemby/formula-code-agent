# Formula Code Agent 项目部署说明

## 1. 项目概述

Formula Code Agent 是一个本地部署的数学公式对话式 AI Agent。系统支持：

- 输入 LaTeX 源码并转换为 SymPy、NumPy 或纯 Python 代码；
- 上传公式图片，通过视觉模型识别 LaTeX；
- 围绕数学公式进行自由对话和连续追问；
- 根据公式特征选择符号计算、数值计算或混合计算策略；
- 对生成代码进行静态检查、受限执行、数学结果核对和自动纠错；
- 通过网页或浏览器扩展调用 Agent 能力；
- 同时保留 Mock 演示模型和 Ollama 本地真实模型。

项目不需要数据库，也不需要执行前端构建。Node.js 进程同时提供网页静态文件和 HTTP API。

## 2. 目录说明

```text
formula-code-agent/
├─ public/                     网页前端
├─ browser-extension/          Chrome / Edge 扩展
├─ src/agent/                  Agent 编排、决策、校验和执行逻辑
├─ src/providers/              Mock 与 Ollama Provider
├─ tests/                      自动化测试
├─ server.js                   Web 服务入口
├─ start.ps1                   Mock Web 服务启动脚本
├─ start-ollama.ps1            真实模型 Web 服务启动脚本
├─ setup-python.ps1            Python 执行环境安装脚本
└─ package.json                npm 启动与测试命令
```

## 3. 部署环境

| 项目 | 最低要求或说明 |
| --- | --- |
| 操作系统 | Windows 10/11；核心 Node.js 服务也可运行于 Linux/macOS |
| Node.js | 18 或更高版本 |
| Python | 建议 3.11 或更高版本，用于实际执行和验证生成的代码 |
| Ollama | 真实模型模式需要；Mock 模式不需要 |
| 浏览器 | 推荐最新版 Chrome 或 Edge |
| Web 端口 | 默认 `127.0.0.1:4173`，可通过 `HOST`、`PORT` 修改 |
| Ollama 端口 | 默认 `127.0.0.1:11434` |
| 磁盘空间 | 两个默认 7B 模型约需 11 GB，另建议为 Python 环境预留 1 GB |
| 内存/显存 | 由模型量化和运行设备决定；两个模型通常按需加载，不要求同时驻留 |

确认基础环境：

```powershell
node --version
npm --version
python --version
ollama --version
```

其中 Node.js 是必须项；Python 和 Ollama 根据所需功能安装。

## 4. 获取项目并进入目录

将完整项目文件夹复制到目标电脑。以下命令以当前路径为例：

```powershell
Set-Location 'H:\111\formula-code-agent'
```

本项目当前没有 npm 第三方运行依赖，因此无需执行 `npm install`。如果后续 `package.json` 增加依赖，则部署时应先执行：

```powershell
npm install
```

## 5. 配置 Python 执行环境

要完整演示“生成代码、实际运行、错误反馈和自动纠错”，应先执行一次：

```powershell
.\setup-python.ps1
```

脚本会在项目根目录创建 `.python-env`，并安装 SymPy、NumPy、SciPy 和 `antlr4-python3-runtime==4.11.*`。

验证环境：

```powershell
.\.python-env\Scripts\python.exe -c "import sympy, numpy, scipy; print('Python environment OK')"
```

也可以通过 `PYTHON_EXECUTABLE` 指定其他 Python 解释器：

```powershell
$env:PYTHON_EXECUTABLE = 'C:\Python311\python.exe'
```

未配置可用 Python 时，网页和对话仍可启动，但需要实际执行验证的代码转换请求可能失败，因此正式演示前应完成本步骤。

## 6. 部署 Mock Web 版本

Mock 模式主要用于验证页面、输入输出流程和 Agent 编排，不代表真实模型能力。项目根目录执行：

```powershell
.\start.ps1
```

或者：

```powershell
npm start
```

浏览器访问 `http://127.0.0.1:4173/`。

健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:4173/api/health
```

返回内容中的 `status` 应为 `ok`，`mode` 应为 `mock`。

## 7. 部署 Ollama 真实模型 Web 版本

### 7.1 安装并检查 Ollama

安装 Ollama 后，确认服务能够访问：

```powershell
Invoke-RestMethod http://127.0.0.1:11434/api/tags
```

### 7.2 下载默认模型

```powershell
ollama pull qwen2.5vl:7b
ollama pull qwen2.5-coder:7b
```

`qwen2.5vl:7b` 用于公式图片识别和 LaTeX 提取；`qwen2.5-coder:7b` 用于数学对话、Python 代码生成和纠错。

查看已安装模型：

```powershell
ollama list
```

### 7.3 启动真实模型 Web 服务

```powershell
.\start-ollama.ps1
```

脚本会设置 `AI_PROVIDER=open-source` 并连接本机 Ollama。浏览器仍访问 `http://127.0.0.1:4173/`。健康检查返回的 `mode` 应为 `open-source`。

如需手动指定模型或延长超时：

```powershell
$env:AI_PROVIDER = 'open-source'
$env:OLLAMA_BASE_URL = 'http://127.0.0.1:11434'
$env:VISION_MODEL = 'qwen2.5vl:7b'
$env:CODE_MODEL = 'qwen2.5-coder:7b'
$env:MODEL_TIMEOUT_MS = '120000'
node server.js
```

## 8. 修改 Web 服务端口

默认端口被占用时，可以换用其他端口：

```powershell
$env:HOST = '127.0.0.1'
$env:PORT = '4200'
.\start-ollama.ps1
```

随后访问 `http://127.0.0.1:4200/`。

检查端口占用：

```powershell
netstat -ano | Select-String ':4173'
```

网页端口同时影响 Web UI 和 HTTP API 的访问地址。

## 9. 部署浏览器扩展

1. 先启动 Web 后端。
2. Chrome 打开 `chrome://extensions`，Edge 打开 `edge://extensions`。
3. 开启“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择项目中的 `browser-extension` 文件夹。

扩展默认访问 `http://127.0.0.1/*` 和 `http://localhost/*`。如果后端部署到其他域名，需要修改 `browser-extension/manifest.json` 中的 `host_permissions`，然后重新加载扩展。

## 10. HTTP API

健康检查：

```http
GET /api/health
```

公式转换：

```http
POST /api/convert
Content-Type: application/json
```

请求示例：

```json
{
  "inputType": "latex",
  "latex": "\\frac{x^2+1}{2}",
  "prompt": "转换为 Python 代码并解释",
  "targetLibrary": "SymPy"
}
```

PowerShell 调用示例：

```powershell
$body = @{
  inputType = 'latex'
  latex = '\frac{x^2+1}{2}'
  prompt = '转换为 Python 代码并解释'
  targetLibrary = 'SymPy'
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri 'http://127.0.0.1:4173/api/convert' `
  -Method Post `
  -ContentType 'application/json' `
  -Body $body
```

`POST /api/config` 可在 Web 服务运行期间切换 Mock 与 Ollama Provider。

## 11. 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Web 服务监听地址 |
| `PORT` | `4173` | Web 服务端口 |
| `AI_PROVIDER` | `mock` | `mock` 或 `open-source` |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama API 地址 |
| `VISION_MODEL` | `qwen2.5vl:7b` | 图片公式识别模型 |
| `CODE_MODEL` | `qwen2.5-coder:7b` | 对话、代码生成和纠错模型 |
| `MODEL_TIMEOUT_MS` | `60000` | 单次 Ollama 请求超时，单位毫秒 |
| `PYTHON_EXECUTABLE` | 自动查找 | 指定用于受限执行的 Python 路径 |

## 12. 自动化测试

项目根目录执行：

```powershell
npm test
```

也可以运行部署自检：

```powershell
npm run verify
```

该命令会验证 `.python-env` 是否能导入 SymPy、NumPy、SciPy，并检查 Ollama `/api/tags` 是否可访问。真实模型未启动时，Ollama 检查会失败，但 Mock Web 模式仍可使用。

部署验收不应只看网页能否打开，还应确认测试全部通过。

## 13. 部署验收清单

按实际部署模式逐项确认：

1. `node --version` 为 18 或更高版本。
2. `npm test` 全部通过。
3. Web 模式下 `/api/health` 返回 `status: ok`。
4. Mock Web 模式返回 `mode: mock`。
5. 真实 Web 模式返回 `mode: open-source`。
6. `.python-env` 能导入 SymPy、NumPy 和 SciPy。
7. LaTeX 输入能生成代码并显示 Agent 计算决策。
8. 图片输入能由视觉模型返回识别结果，而不是 Mock 演示公式。
9. 连续对话能够保留当前公式和历史消息。

## 14. 常见故障

### 网页无法打开

确认服务终端没有关闭，并检查健康接口：

```powershell
Invoke-RestMethod http://127.0.0.1:4173/api/health
```

如果提示端口已占用，设置新的 `PORT` 后重启，不要同时启动多个使用同一端口的 Web 进程。

### 页面仍显示旧内容

按 `Ctrl+F5` 强制刷新。如果仍无变化，确认浏览器地址与新启动服务的端口一致。

### 无法连接 Ollama

```powershell
Invoke-RestMethod http://127.0.0.1:11434/api/tags
ollama list
```

确认 Ollama 正在运行、模型名称完全一致，并检查 `OLLAMA_BASE_URL`。

### 模型请求超时

首次加载 7B 模型可能较慢。可以把 `MODEL_TIMEOUT_MS` 提高到 `120000`，同时检查系统内存/显存是否足够。

### 代码生成了但执行失败

确认 Python 环境存在：

```powershell
Test-Path .\.python-env\Scripts\python.exe
.\.python-env\Scripts\python.exe -c "import sympy, numpy, scipy"
```

复杂符号公式可能由 Agent 主动跳过不可靠的数值执行，这是安全决策，不等同于程序故障。

## 15. 生产部署注意事项

当前实现适合本机实验、课程展示和受信任网络，不应不加防护地直接暴露到互联网。生产部署至少需要补充：

1. 为 `/api/convert` 和 `/api/config` 增加身份认证与权限控制；
2. 将当前宽松的跨域策略限制为可信来源；
3. 使用 HTTPS、反向代理、请求限流和审计日志；
4. 将内存会话改为持久化或分布式会话存储；
5. 将 Python 执行器放入独立容器或真正的安全沙箱，并限制 CPU、内存、文件系统、网络和进程权限；
6. 不要把未鉴权的 Ollama 端口直接暴露到公网；
7. 对上传图片设置类型检查、恶意内容检测和存储清理策略；
8. 为 Web 服务和模型服务配置进程守护、自动重启、日志轮转和健康监控。

当前执行器已有库白名单、5 秒超时和输出大小限制，但这些措施不能替代容器级或虚拟化级安全隔离。
