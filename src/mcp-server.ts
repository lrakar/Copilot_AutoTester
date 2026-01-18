/**
 * MCP Server for VS Code Auto Tester Extension
 * Node.js MCP protocol implementation for interactive feedback collection.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Parse command-line arguments for feedback directory
function getFeedbackDir(): string {
    const args = process.argv.slice(2);
    const feedbackDirIndex = args.indexOf('--feedback-dir');
    if (feedbackDirIndex !== -1 && args[feedbackDirIndex + 1]) {
        return args[feedbackDirIndex + 1];
    }
    // Fallback to default (for backwards compatibility)
    return path.join(os.tmpdir(), '.autotester');
}

const FEEDBACK_DIR = getFeedbackDir();
const FEEDBACK_FILE = path.join(FEEDBACK_DIR, 'feedback.json');
const REQUEST_FILE = path.join(FEEDBACK_DIR, 'request.json');
const IMAGES_DIR = path.join(FEEDBACK_DIR, 'images');
const CONFIG_FILE = path.join(FEEDBACK_DIR, 'config.json');

interface Config {
    toolName: string;
    toolDescription: string;
    footer: string;
}

const DEFAULT_CONFIG: Config = {
    toolName: 'run_auto_tester',
    toolDescription: 'Run after implementing features/fixes. Opens feedback panel with your description.',
    footer: '\n\n---\n⚠️ IMPORTANT: Always reply back via the autotester MCP tool after implementing changes. Continue the feedback loop until you receive a signal that all work is done.'
};

function loadConfig(): Config {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) };
        }
    } catch { /* use defaults */ }
    return DEFAULT_CONFIG;
}

interface ContentBlock { type: 'text' | 'image'; text?: string; data?: string; mimeType?: string; }
interface MCPRequest { jsonrpc: string; id?: number | string; method: string; params?: Record<string, unknown>; }
interface MCPResponse { jsonrpc: string; id?: number | string; result?: unknown; error?: { code: number; message: string }; }

const ensureDir = () => fs.existsSync(FEEDBACK_DIR) || fs.mkdirSync(FEEDBACK_DIR, { recursive: true });

const parseDataUri = (uri: string): { data: string; mimeType: string } => {
    if (uri.startsWith('data:') && uri.includes(';base64,')) {
        const [mime, data] = uri.slice(5).split(';base64,', 2);
        return { data, mimeType: mime };
    }
    return { data: uri, mimeType: 'image/png' };
};

async function waitForFeedback(timeout = 300000): Promise<ContentBlock[]> {
    ensureDir();
    const start = Date.now();
    
    while (Date.now() - start < timeout) {
        if (fs.existsSync(FEEDBACK_FILE)) {
            try {
                const { feedback = '', images = [] } = JSON.parse(fs.readFileSync(FEEDBACK_FILE, 'utf-8'));
                if (feedback || images.length) {
                    fs.unlinkSync(FEEDBACK_FILE);
                    
                    let text = feedback;
                    const blocks: ContentBlock[] = [];
                    
                    if (images.length) {
                        fs.existsSync(IMAGES_DIR) || fs.mkdirSync(IMAGES_DIR, { recursive: true });
                        text += `\n\n[User attached ${images.length} image(s)]`;
                        
                        images.forEach((img: string, i: number) => {
                            const { data, mimeType } = parseDataUri(img);
                            const ext = mimeType.split('/')[1] || 'png';
                            const imgPath = path.join(IMAGES_DIR, `feedback_image_${i + 1}.${ext}`);
                            try {
                                fs.writeFileSync(imgPath, Buffer.from(data, 'base64'));
                                text += `\n- Image ${i + 1}: ${imgPath}`;
                                blocks.push({ type: 'image', data, mimeType });
                            } catch { /* skip */ }
                        });
                    }
                    
                    const config = loadConfig();
                    return [{ type: 'text', text: text + config.footer }, ...blocks];
                }
            } catch { /* retry */ }
        }
        await new Promise(r => setTimeout(r, 500));
    }
    return [{ type: 'text', text: '[Timeout: No feedback received]' }];
}

async function executeTool(prompt: string): Promise<ContentBlock[]> {
    fs.existsSync(FEEDBACK_FILE) && fs.unlinkSync(FEEDBACK_FILE);
    ensureDir();
    fs.writeFileSync(REQUEST_FILE, JSON.stringify({ prompt, timestamp: Date.now() }));
    await new Promise(r => setTimeout(r, 500));
    return waitForFeedback();
}

function getTools() {
    const config = loadConfig();
    return [
        {
            name: config.toolName,
            description: config.toolDescription,
            inputSchema: { type: 'object', properties: { description: { type: 'string', description: 'What was changed' } } }
        }
    ];
}

class MCPServer {
    private buf = '';

    constructor() {
        process.stdin.setEncoding('utf-8');
        process.stdin.on('data', (c: string) => this.onData(c));
        process.stdin.on('end', () => process.exit(0));
    }

    private onData(chunk: string) {
        this.buf += chunk;
        const lines = this.buf.split('\n');
        this.buf = lines.pop() || '';
        lines.filter(l => l.trim()).forEach(l => this.handle(l));
    }

    private async handle(msg: string) {
        try {
            const req: MCPRequest = JSON.parse(msg);
            const res = await this.process(req);
            res && process.stdout.write(JSON.stringify(res) + '\n');
        } catch { /* ignore */ }
    }

    private async process(req: MCPRequest): Promise<MCPResponse | null> {
        const { method, id, params } = req;

        if (method === 'initialize') {
            return { jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'auto-tester', version: '1.0.0' } } };
        }
        if (method === 'initialized') return null;
        if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: getTools() } };
        
        if (method === 'tools/call') {
            const { name, arguments: args = {} } = params as { name: string; arguments?: Record<string, unknown> };
            const config = loadConfig();
            
            if (name === config.toolName) {
                const desc = (args.description as string)?.trim() || 'Changes made. Please review.';
                const content = await executeTool(desc);
                return { jsonrpc: '2.0', id, result: { content } };
            }
            return { jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${name}` } };
        }
        
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
    }
}

new MCPServer();
