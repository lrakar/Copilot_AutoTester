import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { FeedbackStore } from './feedbackStore';

export class AutoTesterViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'autotester.panel';
    private view?: vscode.WebviewView;
    private feedbackResolve?: (value: string) => void;

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
                    break;
                case 'ready':
                    this.sendConfig();
                    break;
            }
        });
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
