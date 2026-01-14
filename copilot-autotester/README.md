# Copilot Auto Tester

A VS Code extension that provides an interactive feedback panel for AI agents like GitHub Copilot. It enables a human-in-the-loop workflow where agents can request user feedback during automated coding tasks.

## Features

- **Native VS Code Sidebar Panel** - Clean, chat-like interface that matches VS Code's dark theme
- **MCP Server Integration** - Auto-registers with Model Context Protocol, no manual setup required
- **Image Support** - Paste or drag-drop images to include in feedback
- **Zero Configuration** - Just install the extension, it works out of the box

## Installation

### From VSIX (Local)

1. Download or build the `.vsix` file
2. In VS Code: Extensions → `...` menu → "Install from VSIX"
3. Select the `copilot-autotester-x.x.x.vsix` file
4. Reload VS Code

### From Marketplace (Coming Soon)

Search for "Copilot Auto Tester" in the VS Code Extensions marketplace.

## Usage

The extension provides two MCP tools for AI agents:

### `run_auto_tester`
Opens the feedback panel with a description of changes made. Use after implementing features or fixes.

```
Agent: "I've implemented the login form with email validation. Please test and provide feedback."
```

### `request_user_feedback`
Opens the feedback panel with a custom prompt. Use when you need specific input.

```
Agent: "Which color scheme do you prefer: A (blue) or B (green)?"
```

### User Workflow
1. AI agent calls one of the MCP tools
2. Auto Tester panel opens with agent's message
3. User types response and/or attaches images
4. Press Enter to submit (Shift+Enter for new line)
5. Agent receives feedback and continues work

## Development

```bash
# Install dependencies
npm install

# Compile
npm run compile

# Watch mode
npm run watch

# Package as VSIX
npx vsce package --allow-missing-repository
```

## Architecture

```
copilot-autotester/
├── src/
│   ├── extension.ts       # Extension activation, MCP provider registration
│   ├── webviewProvider.ts # Chat UI webview panel
│   ├── feedbackStore.ts   # In-memory feedback tracking
│   └── mcp-server.ts      # Node.js MCP server (compiled to out/)
├── resources/
│   └── icon-*.svg         # Lucide bot-message-square icons
└── package.json           # Extension manifest with MCP contribution
```

## Requirements

- VS Code 1.108.0 or later
- GitHub Copilot or any MCP-compatible AI agent

## License

MIT
