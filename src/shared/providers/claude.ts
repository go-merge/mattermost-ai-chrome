import type {AIProvider, ChatMessage, ChatOptions, ModelInfo, ProviderConfig, ProviderEvent} from './types';

const CLAUDE_MODELS: ModelInfo[] = [
    {id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', contextWindow: 200000},
    {id: 'claude-opus-4-20250514', name: 'Claude Opus 4', contextWindow: 200000},
    {id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', contextWindow: 200000},
];

export class ClaudeProvider implements AIProvider {
    id = 'claude';
    name = 'Anthropic Claude';
    supportsStreaming = true;
    maxContextLength = 200000;
    authType: 'api-key' = 'api-key';

    private config: ProviderConfig = {model: 'claude-sonnet-4-20250514'};

    configure(config: ProviderConfig): void {
        const {model, ...rest} = config;
        this.config = {...this.config, ...rest, ...(model ? {model} : {})};
    }

    async validateConfig(): Promise<boolean> {
        if (!this.config.apiKey) {
            return false;
        }
        try {
            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'x-api-key': this.config.apiKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true',
                    'content-type': 'application/json',
                },
                body: JSON.stringify({
                    model: this.config.model,
                    max_tokens: 10,
                    messages: [{role: 'user', content: 'ping'}],
                }),
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    private formatMessages(messages: ChatMessage[]): {system?: string; messages: unknown[]} {
        const systemMessage = messages.find((m) => m.role === 'system');
        const chatMessages = messages.filter((m) => m.role !== 'system');

        const formatted: unknown[] = [];
        for (const msg of chatMessages) {
            if (msg.toolResults && msg.toolResults.length > 0) {
                // Tool results go as user message with tool_result content blocks
                formatted.push({
                    role: 'user',
                    content: msg.toolResults.map((r) => ({
                        type: 'tool_result',
                        tool_use_id: r.toolCallId,
                        content: r.content,
                        ...(r.isError ? {is_error: true} : {}),
                    })),
                });
            } else if (msg.toolCalls && msg.toolCalls.length > 0) {
                // Assistant message with tool calls — mix text + tool_use blocks
                const content: unknown[] = [];
                if (msg.content) {
                    content.push({type: 'text', text: msg.content});
                }
                for (const tc of msg.toolCalls) {
                    content.push({
                        type: 'tool_use',
                        id: tc.id,
                        name: tc.name,
                        input: tc.input,
                    });
                }
                formatted.push({role: 'assistant', content});
            } else {
                formatted.push({role: msg.role, content: msg.content});
            }
        }

        return {
            system: systemMessage?.content,
            messages: formatted,
        };
    }

    async *chat(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<ProviderEvent> {
        if (!this.config.apiKey) {
            throw new Error('Claude API key not configured');
        }

        const {system, messages: apiMessages} = this.formatMessages(messages);

        const body: Record<string, unknown> = {
            model: options?.model || this.config.model,
            max_tokens: options?.maxTokens || this.config.maxTokens || 4096,
            messages: apiMessages,
            stream: true,
        };

        if (system) {
            body.system = system;
        }

        if (options?.temperature !== undefined || this.config.temperature !== undefined) {
            body.temperature = options?.temperature ?? this.config.temperature;
        }

        if (options?.tools && options.tools.length > 0) {
            body.tools = options.tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.inputSchema,
            }));
        }

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': this.config.apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true',
                'content-type': 'application/json',
            },
            body: JSON.stringify(body),
            signal: options?.signal,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Claude API error ${response.status}: ${errorText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error('No response body');
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let stopReason: 'end' | 'tool_use' = 'end';

        // Track active tool call being built
        let activeToolId = '';
        let activeToolName = '';
        let activeToolInput = '';

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
                        if (data === '[DONE]') {
                            yield {type: 'done', stopReason};
                            return;
                        }

                        try {
                            const event = JSON.parse(data);

                            if (event.type === 'content_block_start') {
                                if (event.content_block?.type === 'tool_use') {
                                    activeToolId = event.content_block.id;
                                    activeToolName = event.content_block.name;
                                    activeToolInput = '';
                                }
                            } else if (event.type === 'content_block_delta') {
                                if (event.delta?.type === 'text_delta' && event.delta.text) {
                                    yield {type: 'text', text: event.delta.text};
                                } else if (event.delta?.type === 'input_json_delta' && event.delta.partial_json) {
                                    activeToolInput += event.delta.partial_json;
                                }
                            } else if (event.type === 'content_block_stop') {
                                if (activeToolId) {
                                    let input: Record<string, unknown> = {};
                                    try {
                                        input = JSON.parse(activeToolInput || '{}');
                                    } catch {
                                        // malformed tool input
                                    }
                                    yield {type: 'tool_call', id: activeToolId, name: activeToolName, input};
                                    activeToolId = '';
                                    activeToolName = '';
                                    activeToolInput = '';
                                }
                            } else if (event.type === 'message_delta') {
                                if (event.delta?.stop_reason === 'tool_use') {
                                    stopReason = 'tool_use';
                                }
                            }
                        } catch {
                            // skip malformed JSON
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        yield {type: 'done', stopReason};
    }

    async listModels(): Promise<ModelInfo[]> {
        return CLAUDE_MODELS;
    }
}
