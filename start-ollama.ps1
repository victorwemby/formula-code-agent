$ollamaCommand = Get-Command ollama -ErrorAction SilentlyContinue

if (-not $ollamaCommand) {
    throw '未找到 Ollama。请先安装 Ollama 并重新打开 PowerShell。'
}

$env:AI_PROVIDER = 'open-source'
$env:OLLAMA_BASE_URL = if ($env:OLLAMA_BASE_URL) { $env:OLLAMA_BASE_URL } else { 'http://127.0.0.1:11434' }
$env:VISION_MODEL = if ($env:VISION_MODEL) { $env:VISION_MODEL } else { 'qwen2.5vl:7b' }
$env:CODE_MODEL = if ($env:CODE_MODEL) { $env:CODE_MODEL } else { 'qwen2.5-coder:7b' }

Write-Host "视觉模型：$env:VISION_MODEL"
Write-Host "代码模型：$env:CODE_MODEL"
Write-Host '正在以开源模型模式启动 Formula Code Agent...'

& node server.js
exit $LASTEXITCODE
