$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$bundledNode = 'C:\Users\星\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'

if ($nodeCommand) {
    & $nodeCommand.Source server.js
    exit $LASTEXITCODE
}

if (Test-Path -LiteralPath $bundledNode) {
    & $bundledNode server.js
    exit $LASTEXITCODE
}

throw '未找到 Node.js。请安装 Node.js 18 或更高版本后再运行。'
