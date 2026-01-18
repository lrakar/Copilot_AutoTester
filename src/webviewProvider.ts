import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { FeedbackStore } from './feedbackStore';

interface ChatMessage {
    text: string;
    type: 'user' | 'agent';
    images?: string[];
}

interface WebviewState {
    messages: ChatMessage[];
    inputEnabled: boolean;
    pendingPrompt?: string;
}

export class AutoTesterViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'autotester.panel';
    private view?: vscode.WebviewView;
    private feedbackResolve?: (value: string) => void;
    
    // Persistent state stored in extension
    private state: WebviewState = {
        messages: [],
        inputEnabled: false,
        pendingPrompt: undefined
    };

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly feedbackStore: FeedbackStore,
        private readonly onFeedbackSubmit?: (feedback: string, images?: string[]) => void
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        webviewView.webview.html = this.getHtmlContent();

        webviewView.webview.onDidReceiveMessage((message) => {
            switch (message.command) {
                case 'submit':
                    this.handleFeedbackSubmit(message.text, message.images);
                    break;
                case 'clear':
                    this.feedbackStore.clear();
                    this.state.messages = [];
                    break;
                case 'ready':
                    this.sendConfig();
                    this.restoreState();
                    break;
            }
        });
    }

    private restoreState(): void {
        // Restore messages
        if (this.state.messages.length > 0) {
            this.postMessage({
                command: 'restoreMessages',
                messages: this.state.messages
            });
        }
        
        // Restore input state - if there's a pending prompt or input was enabled
        if (this.state.inputEnabled || this.state.pendingPrompt) {
            this.postMessage({
                command: 'enableInput'
            });
            // If there was a pending prompt, show it again
            if (this.state.pendingPrompt) {
                this.postMessage({
                    command: 'showPrompt',
                    message: this.state.pendingPrompt,
                    skipAddMessage: true // Don't add duplicate message
                });
            }
        }
    }

    public sendConfig(): void {
        const config = vscode.workspace.getConfiguration('autotester');
        this.postMessage({
            command: 'config',
            enterToSubmit: config.get<boolean>('enterToSubmit', true),
            ctrlEnterToSubmit: config.get<boolean>('ctrlEnterToSubmit', false)
        });
    }

    private handleFeedbackSubmit(text: string, images?: string[]): void {
        if (!text.trim() && (!images || images.length === 0)) return;

        // Track user message in state
        this.state.messages.push({
            text: text || '(image)',
            type: 'user',
            images: images
        });
        this.state.inputEnabled = false;
        this.state.pendingPrompt = undefined;

        this.feedbackStore.add(text);
        
        // Write feedback to file for MCP server
        if (this.onFeedbackSubmit) {
            this.onFeedbackSubmit(text, images);
        }
        
        if (this.feedbackResolve) {
            this.feedbackResolve(text);
            this.feedbackResolve = undefined;
        }

        this.postMessage({ command: 'submitted', success: true });
    }

    public waitForFeedback(): Promise<string> {
        return new Promise((resolve) => {
            this.feedbackResolve = resolve;
            this.showPrompt('Agent is waiting for your feedback...');
        });
    }

    public focusInput(): void {
        this.postMessage({ command: 'focus' });
    }

    public showPrompt(message: string): void {
        // Track agent message and input state
        if (message && message.trim()) {
            this.state.messages.push({
                text: message,
                type: 'agent'
            });
        }
        this.state.inputEnabled = true;
        this.state.pendingPrompt = message;
        
        this.postMessage({ command: 'showPrompt', message });
        vscode.commands.executeCommand('autotester.panel.focus');
    }

    private postMessage(message: unknown): void {
        this.view?.webview.postMessage(message);
    }

    private showNotification(message: string): void {
        vscode.window.showInformationMessage(message);
    }

    private getHtmlContent(): string {
        const htmlPath = path.join(this.extensionUri.fsPath, 'resources', 'webview.html');
        return fs.readFileSync(htmlPath, 'utf-8');
    }
}
