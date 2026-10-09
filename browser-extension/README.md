# Formula Code Agent 浏览器扩展

这是网页版的浏览器侧边栏版本。它不会替换现有网页，而是复用同一个 FormulaAgent 后端。

## 安装到 Chrome / Edge

1. 先在项目根目录运行 `start.ps1`，启动本地 Agent 后端。
2. Chrome 打开 `chrome://extensions`；Edge 打开 `edge://extensions`。
3. 开启“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择本目录 `browser-extension`。
6. 将 Formula Code Agent 固定到浏览器工具栏。

扩展默认连接 `http://127.0.0.1:4173`。如果后端地址不同，可在侧边栏右上角设置。

## 使用方式

- 工具栏：点击扩展图标打开浏览器侧边栏。
- 悬浮按钮：在 Overleaf 或普通网页选中类似 LaTeX 的文本，点击选区旁的“转为 Python”。
- 右键菜单：选中 LaTeX 后右键，选择“将选中的 LaTeX 转为 Python”。
- 手动输入：直接在侧边栏粘贴 LaTeX。
- 图片输入：切换到“公式图片”并上传图片。

## 文件说明

- `manifest.json`：Manifest V3 配置。
- `service-worker.js`：侧边栏、工具栏和右键菜单编排。
- `content-script.js`：读取网页选区并显示悬浮按钮。
- `sidepanel.*`：扩展侧边栏界面和 Agent API 调用。

## 注意事项

- 浏览器内置页面、扩展商店等受保护页面不允许内容脚本运行。
- 第一次安装后，已经打开的 Overleaf 页面需要刷新一次。
- 当前后端默认是 Mock Provider；选择真实开源模型后，扩展会自动复用新的 Provider。

