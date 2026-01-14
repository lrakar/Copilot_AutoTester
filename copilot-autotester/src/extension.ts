import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AutoTesterViewProvider } from './webviewProvider';
import { FeedbackStore } from './feedbackStore';

let viewProvider: AutoTesterViewProvider;
const FEEDBACK_DIR = path.join(os.homedir(), '.autotester');
const FEEDBACK_FILE = path.join(FEEDBACK_DIR, 'feedback.json');
const REQUEST_FILE = path.join(FEEDBACK_DIR, 'request.json');

function ensureDir(): void {
    if (!fs.existsSync(FEEDBACK_DIR)) {
        fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
    }
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
    constructor(private readonly extensionPath: string) {}

    provideMcpServerDefinitions(
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.McpStdioServerDefinition[]> {
        const mcpServerPath = path.join(this.extensionPath, 'out', 'mcp-server.js');
        
        // Return the MCP server definition - VS Code will spawn this process
        return [
            new vscode.McpStdioServerDefinition(
                'Auto Tester',      // label shown in UI
                'node',             // command
                [mcpServerPath],    // args
                {},                 // env
                '1.0.0'             // version
            )
        ];
    }
}

export function activate(context: vscode.ExtensionContext): void {
    const feedbackStore = new FeedbackStore();
    viewProvider = new AutoTesterViewProvider(context.extensionUri, feedbackStore, writeFeedback);

    // Register MCP Server Definition Provider
    // This makes the Auto Tester tools available to GitHub Copilot automatically
    const mcpProvider = new AutoTesterMcpProvider(context.extensionPath);
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

export function deactivate(): void {}
