export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
    toolCalls?: ToolCall[];
    toolResults?: ToolResult[];
}

export interface ToolCall {
    id: string;
    name: string;
    input: Record<string, unknown>;
}

export interface ToolResult {
    toolCallId: string;
    content: string;
    isError?: boolean;
}

export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

export type ProviderEvent =
    | { type: 'text'; text: string }
    | { type: 'tool_call'; id: string; name: string; input: Record<string, unknown> }
    | { type: 'done'; stopReason: 'end' | 'tool_use' };

export interface ChatOptions {
    stream?: boolean;
    temperature?: number;
    maxTokens?: number;
    model?: string;
    tools?: ToolDefinition[];
    signal?: AbortSignal;
}

export interface ModelInfo {
    id: string;
    name: string;
    contextWindow: number;
}

export interface ProviderConfig {
    apiKey?: string;
    baseUrl?: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
}

export interface SessionStatus {
    active: boolean;
    label: string;
    detail?: string;
}

export interface AIProvider {
    id: string;
    name: string;
    supportsStreaming: boolean;
    maxContextLength: number;
    authType: 'api-key' | 'local' | 'session';

    configure(config: ProviderConfig): void;
    validateConfig(): Promise<boolean>;
    chat(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<ProviderEvent>;
    listModels(): Promise<ModelInfo[]>;
    getSessionStatus?(): Promise<SessionStatus>;
}

export interface ProviderStatus {
    id: string;
    name: string;
    configured: boolean;
    model: string;
    error?: string;
}
