# Mattermost AI Assistant

Chrome extension that adds an AI sidebar to Mattermost. Ask questions about conversations, summarize threads, and draft replies — powered by your choice of AI provider.

## Features

- Side panel AI chat that stays open while you browse Mattermost
- Click the "AI" button on any post to send it to the assistant
- Shift-click to select a range of posts for context
- Multiple AI providers: OpenAI, Anthropic Claude, Ollama, OpenRouter
- MCP (Model Context Protocol) server support
- Quick actions with customizable prompts
- Authentication via your existing Mattermost session
- Keyboard shortcut: `Ctrl+Shift+A` / `Cmd+Shift+A`

## Install from Release

1. Go to [Releases](https://github.com/go-merge/mattermost-ai-chrome/releases) and download the latest `.zip`
2. Unzip the archive to a permanent location
3. Open `chrome://extensions` in Chrome
4. Enable **Developer mode** (toggle in the top-right)
5. Click **Load unpacked** and select the unzipped folder
6. Open any Mattermost tab and click the extension icon to open the sidebar
7. Go to **Settings** in the sidebar and configure your AI provider and API key

## Build from Source

Requires Node.js 18+

```bash
git clone https://github.com/go-merge/mattermost-ai-chrome.git
cd mattermost-ai-chrome
npm ci
npm run build
```

Then load the `dist/` folder as an unpacked extension (steps 3-7 above).

## Development

```bash
npm run dev
```

Load `dist/` as an unpacked extension. CRXJS hot-reloads changes automatically.

## Configuration

In the sidebar Settings panel:
- **Provider** — choose OpenAI, Anthropic Claude, Ollama, or OpenRouter
- **API Key** — your provider's API key
- **Model** — select from available models
- **MCP Servers** — connect external tool servers
- **Quick Actions** — customize prompt templates

## License

[MIT](LICENSE)
