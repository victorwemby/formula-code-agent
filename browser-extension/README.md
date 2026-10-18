# Formula Code Agent Browser Extension

The extension provides a browser side panel for the same FormulaAgent backend used by the web interface. Both interfaces remain available.

## Install in Chrome or Edge

1. Start the backend from the project root with `npm start` or, on Windows, `.\start.ps1`. Use `.\start-ollama.ps1` for Ollama mode.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the project's `browser-extension` folder.
6. Pin Formula Code Agent to the browser toolbar.

The extension defaults to `http://127.0.0.1:4173`. To use a different backend address, open the settings button in the upper-right corner of the side panel.

## Usage

- **Toolbar:** Click the extension icon to open the side panel.
- **Selection button:** Select LaTeX-like text on Overleaf or another web page, then click the conversion button next to the selection.
- **Context menu:** Select LaTeX, right-click, and choose the Formula Code Agent conversion action.
- **Read selection:** Use the side panel's selection-reading action to import text from the current page.
- **Manual input:** Paste LaTeX into the side panel.
- **Image input:** Switch to the formula image tab and upload an image of up to 8 MB.
- **Results:** Inspect the recognized LaTeX, generated Python, explanation, dependencies, warnings, and agent trace; copy the code using the copy action.

The current extension labels are in Chinese. The backend automatically selects the computation library for HTTP conversion requests.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | Manifest V3 configuration and permissions |
| `service-worker.js` | Side panel, toolbar, and context-menu actions |
| `content-script.js` | Page selection reading and floating conversion button |
| `content-script.css` | Floating button styles |
| `sidepanel.html`, `sidepanel.css`, `sidepanel.js` | Side panel interface, settings, and backend API calls |

## Limitations and troubleshooting

- Browser-internal pages, extension stores, and other protected pages do not allow content scripts.
- Refresh existing Overleaf or other pages after installing or reloading the extension.
- Keep the backend running. If the side panel reports that it is offline, verify the backend URL and check `GET /api/health`.
- The manifest permits backend requests to `http://127.0.0.1/*` and `http://localhost/*`. For another host or HTTPS, update `host_permissions` in `manifest.json` and reload the extension.
- The default backend provider is mock unless configured otherwise. Mock images return a demonstration formula. After switching the shared HTTP backend to Ollama, extension requests use that provider as well.
- Python and the required packages must be available for conversions requiring execution. See the [deployment guide](../deployment%20instrcutions.md).
