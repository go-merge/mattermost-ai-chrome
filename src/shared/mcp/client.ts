import type {
    JsonRpcRequest,
    JsonRpcResponse,
    McpInitializeResult,
    McpToolCallResult,
    McpToolDefinition,
    McpToolsListResult,
} from './types';
import type {ToolDefinition} from '../providers/types';

const MCP_PROTOCOL_VERSION = '2024-11-05';

export class McpClient {
    private url: string;
    private headers: Record<string, string>;
    private sessionId: string | undefined;
    private requestId = 0;
    private initialized = false;

    constructor(url: string, headers?: Record<string, string>) {
        this.url = url;
        this.headers = headers || {};
    }

    private async sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
        const request: JsonRpcRequest = {
            jsonrpc: '2.0',
            id: ++this.requestId,
            method,
            ...(params ? {params} : {}),
        };

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
            ...this.headers,
        };

        if (this.sessionId) {
            headers['Mcp-Session-Id'] = this.sessionId;
        }

        const response = await fetch(this.url, {
            method: 'POST',
            headers,
            body: JSON.stringify(request),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`MCP error ${response.status}: ${text}`);
        }

        // Capture session ID from response
        const newSessionId = response.headers.get('Mcp-Session-Id');
        if (newSessionId) {
            this.sessionId = newSessionId;
        }

        const contentType = response.headers.get('Content-Type') || '';

        if (contentType.includes('text/event-stream')) {
            // SSE response — parse the first result event
            return this.parseSSEResponse(response);
        }

        // Regular JSON response
        const result = await response.json() as JsonRpcResponse;
        if (result.error) {
            throw new Error(`MCP RPC error ${result.error.code}: ${result.error.message}`);
        }
        return result.result;
    }

    private async parseSSEResponse(response: Response): Promise<unknown> {
        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const {done, value} = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, {stream: true});
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        try {
                            const parsed = JSON.parse(data) as JsonRpcResponse;
                            if (parsed.error) {
                                throw new Error(`MCP RPC error ${parsed.error.code}: ${parsed.error.message}`);
                            }
                            return parsed.result;
                        } catch (e) {
                            if (e instanceof Error && e.message.startsWith('MCP RPC error')) throw e;
                            // skip malformed data
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        throw new Error('MCP SSE stream ended without result');
    }

    async initialize(): Promise<McpInitializeResult> {
        const result = await this.sendRequest('initialize', {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: {
                name: 'mattermost-ai-chrome',
                version: '1.0.0',
            },
        }) as McpInitializeResult;

        // Send initialized notification (no response expected)
        this.sendNotification('notifications/initialized');

        this.initialized = true;
        return result;
    }

    private async sendNotification(method: string, params?: Record<string, unknown>): Promise<void> {
        const body = {
            jsonrpc: '2.0',
            method,
            ...(params ? {params} : {}),
        };

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...this.headers,
        };

        if (this.sessionId) {
            headers['Mcp-Session-Id'] = this.sessionId;
        }

        // Fire and forget
        fetch(this.url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        }).catch(() => {});
    }

    async listTools(): Promise<ToolDefinition[]> {
        if (!this.initialized) {
            throw new Error('MCP client not initialized — call initialize() first');
        }

        const result = await this.sendRequest('tools/list') as McpToolsListResult;

        return (result.tools || []).map((t: McpToolDefinition) => ({
            name: t.name,
            description: t.description || '',
            inputSchema: t.inputSchema as Record<string, unknown>,
        }));
    }

    async callTool(name: string, args: Record<string, unknown>): Promise<{content: string; isError: boolean}> {
        if (!this.initialized) {
            throw new Error('MCP client not initialized — call initialize() first');
        }

        const result = await this.sendRequest('tools/call', {
            name,
            arguments: args,
        }) as McpToolCallResult;

        // Flatten content blocks into text
        const text = (result.content || [])
            .filter((c): c is {type: 'text'; text: string} => c.type === 'text')
            .map((c) => c.text)
            .join('\n');

        return {
            content: text || '(no output)',
            isError: result.isError || false,
        };
    }

    getSessionId(): string | undefined {
        return this.sessionId;
    }

    isInitialized(): boolean {
        return this.initialized;
    }
}
