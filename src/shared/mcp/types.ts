// MCP Server configuration (stored in settings)
export interface McpServerConfig {
    id: string;
    name: string;
    url: string;
    enabled: boolean;
    headers?: Record<string, string>;
}

// MCP connection status
export type McpConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface McpServerState {
    config: McpServerConfig;
    status: McpConnectionStatus;
    error?: string;
    toolCount: number;
    sessionId?: string;
}

// JSON-RPC 2.0 types
export interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: number;
    method: string;
    params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: number;
    result?: unknown;
    error?: {code: number; message: string; data?: unknown};
}

// MCP protocol types
export interface McpToolDefinition {
    name: string;
    description?: string;
    inputSchema: {
        type: 'object';
        properties?: Record<string, unknown>;
        required?: string[];
        [key: string]: unknown;
    };
}

export interface McpToolCallResult {
    content: Array<{type: 'text'; text: string} | {type: 'image'; data: string; mimeType: string}>;
    isError?: boolean;
}

export interface McpServerInfo {
    name: string;
    version: string;
}

export interface McpInitializeResult {
    protocolVersion: string;
    capabilities: Record<string, unknown>;
    serverInfo: McpServerInfo;
}

export interface McpToolsListResult {
    tools: McpToolDefinition[];
}
