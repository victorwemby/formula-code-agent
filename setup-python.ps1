$ErrorActionPreference = 'Stop'
$envPath = Join-Path $PSScriptRoot '.python-env'
$python = Get-Command python -ErrorAction SilentlyContinue
$bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'

if (-not (Test-Path (Join-Path $envPath 'Scripts\\python.exe'))) {
  if (-not $python) {
    $launcher = Get-Command py -ErrorAction SilentlyContinue
    if (Test-Path $bundledPython) {
        & $bundledPython -m venv $envPath
    } elseif ($launcher) {
        & $launcher.Source -3 -m venv $envPath
    } else {
        throw '未找到 Python 3。请安装 Python 3.11 或更高版本，或设置 PYTHON_EXECUTABLE 后重试。'
    }
  } else {
    & $python.Source -m venv $envPath
  }
}

$envPython = Join-Path $envPath 'Scripts\\python.exe'
$sitePackages = Join-Path $envPath 'Lib\\site-packages'
$localPackages = Join-Path $PSScriptRoot '.python-packages'

# The project ships a dependency cache for offline or restricted deployments.
# Copying it into the virtual environment is deterministic and avoids making
# the setup step depend on access to PyPI.
if ((Test-Path (Join-Path $localPackages 'sympy\\__init__.py')) -and
    (Test-Path (Join-Path $localPackages 'numpy\\exceptions.py'))) {
    Get-ChildItem $localPackages -Force | ForEach-Object {
        Copy-Item $_.FullName (Join-Path $sitePackages $_.Name) -Recurse -Force
    }
}

try {
    & $envPython -c "import sympy, numpy, scipy; print('Python dependencies OK')"
    if ($LASTEXITCODE -ne 0) { throw '本地 Python 依赖缓存不完整' }
} catch {
    & $envPython -m pip install --upgrade pip sympy numpy scipy antlr4-python3-runtime==4.11.*
}
Write-Host 'Python 执行环境已配置完成。现在可运行 .\\start-ollama.ps1。'
