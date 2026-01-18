import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { AutoTesterViewProvider } from './webviewProvider';
import { FeedbackStore } from './feedbackStore';

let viewProvider: AutoTesterViewProvider;

// Generate unique instance ID for this VS Code window
const INSTANCE_ID = crypto.randomBytes(8).toString('hex');
const FEEDBACK_DIR = path.join(os.tmpdir(), '.autotester', INSTANCE_ID);
const FEEDBACK_FILE = path.join(FEEDBACK_DIR, 'feedback.json');
const REQUEST_FILE = path.join(FEEDBACK_DIR, 'request.json');
const CONFIG_FILE = path.join(FEEDBACK_DIR, 'config.json');

function ensureDir(): void {
    if (!fs.existsSync(FEEDBACK_DIR)) {
        fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
    }
}

function writeConfig(): void {
    ensureDir();
    const config = vscode.workspace.getConfiguration('autotester');
    const settings = {
        toolName: config.get<string>('toolName', 'run_auto_tester'),
        toolDescription: config.get<string>('toolDescription', 'Run after implementing features/fixes. Opens feedback panel with your description.'),
        footer: config.get<string>('footer', '\n\n---\n⚠️ IMPORTANT: Always reply back via the autotester MCP tool after implementing changes. Continue the feedback loop until you receive a signal that all work is done.')
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(settings));
}

function writeFeedback(feedback: string, images?: string[]): void {
    ensureDir();
    fs.writeFileSync(FEEDBACK_FILE, JSON.stringify({
        feedback,
        images: images || [],
        timestamp: Date.now()
    }));
}

function checkForRequest(): { prompt: string } | null {
    try {
        if (fs.existsSync(REQUEST_FILE)) {
            const data = JSON.parse(fs.readFileSync(REQUEST_FILE, 'utf-8'));
            fs.unlinkSync(REQUEST_FILE);
            return data;
        }
    } catch {
        // Ignore errors
    }
    return null;
}

/**
 * MCP Server Definition Provider
 * Automatically registers the Auto Tester MCP server with VS Code
 * so Copilot can use it without manual mcp.json configuration
 */
class AutoTesterMcpProvider implements vscode.McpServerDefinitionProvider<vscode.McpStdioServerDefinition> {
    constructor(
        private readonly extensionPath: string,
        private readonly feedbackDir: string
    ) {}

    provideMcpServerDefinitions(
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.McpStdioServerDefinition[]> {
        const mcpServerPath = path.join(this.extensionPath, 'out', 'mcp-server.js');
        
        // Return the MCP server definition - VS Code will spawn this process
        // Pass the unique feedback directory as a command-line argument
        return [
            new vscode.McpStdioServerDefinition(
                'Auto Tester',      // label shown in UI
                'node',             // command
                [mcpServerPath, '--feedback-dir', this.feedbackDir],    // args with unique folder
                {},                 // env
                '1.0.0'             // version
            )
        ];
    }
}

export function activate(context: vscode.ExtensionContext): void {
    const feedbackStore = new FeedbackStore();
    viewProvider = new AutoTesterViewProvider(context.extensionUri, feedbackStore, writeFeedback);

    // Write initial config for MCP server
    writeConfig();

    // Watch for settings changes and update config file + webview
    const configChangeDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('autotester')) {
            writeConfig();
            viewProvider.sendConfig();
        }
    });
    context.subscriptions.push(configChangeDisposable);

    // Register MCP Server Definition Provider
    // This makes the Auto Tester tools available to GitHub Copilot automatically
    const mcpProvider = new AutoTesterMcpProvider(context.extensionPath, FEEDBACK_DIR);
    const mcpDisposable = vscode.lm.registerMcpServerDefinitionProvider(
        'autotester.mcpProvider',
        mcpProvider
    );
    context.subscriptions.push(mcpDisposable);

    // Poll for MCP requests (file-based IPC)
    const pollInterval = setInterval(() => {
        const request = checkForRequest();
        if (request) {
            vscode.commands.executeCommand('autotester.panel.focus').then(() => {
                if (request.prompt && request.prompt.trim()) {
                    viewProvider.showPrompt(request.prompt);
                }
            });
        }
    }, 500);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('autotester.panel', viewProvider),
        vscode.commands.registerCommand('autotester.openPanel', () => {
            vscode.commands.executeCommand('autotester.panel.focus');
        }),
        vscode.commands.registerCommand('autotester.submitFeedback', () => {
            viewProvider.focusInput();
        }),
        { dispose: () => clearInterval(pollInterval) }
    );

    console.log('Auto Tester extension activated with MCP server provider');
}

export function deactivate(): void {
    // Cleanup the instance-specific folder
    try {
        if (fs.existsSync(FEEDBACK_DIR)) {
            fs.rmSync(FEEDBACK_DIR, { recursive: true, force: true });
        }
    } catch {
        // Ignore cleanup errors
    }
}
