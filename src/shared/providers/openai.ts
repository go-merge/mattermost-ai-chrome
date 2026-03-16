import type {AIProvider, ChatMessage, ChatOptions, ModelInfo, ProviderConfig, ProviderEvent} from './types';

const OPENAI_MODELS: ModelInfo[] = [
    {id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000},
    {id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextWindow: 128000},
    {id: 'gpt-4-turbo', name: 'GPT-4 Turbo', contextWindow: 128000},
    {id: 'o1', name: 'o1', contextWindow: 200000},
    {id: 'o3-mini', name: 'o3 Mini', contextWindow: 200000},
];

export class OpenAIProvider implements AIProvider {
    id = 'openai';
    name = 'OpenAI';
    supportsStreaming = true;
    maxContextLength = 128000;
    authType: 'api-key' = 'api-key';

    private config: ProviderConfig = {model: 'gpt-4o'};

    configure(config: ProviderConfig): void {
        const {model, ...rest} = config;
        this.config = {...this.config, ...rest, ...(model ? {model} : {})};
    }

    async validateConfig(): Promise<boolean> {
        if (!this.config.apiKey) {
            return false;
        }
        try {
            const response = await fetch(`${this.getBaseUrl()}/models`, {
                headers: {Authorization: `Bearer ${this.config.apiKey}`},
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    private getBaseUrl(): string {
        return this.config.baseUrl || 'https://api.openai.com/v1';
    }

    protected formatMessages(messages: ChatMessage[]): unknown[] {
        const formatted: unknown[] = [];
        for (const msg of messages) {
            if (msg.toolResults && msg.toolResults.length > 0) {
                // Each tool result is a separate message in OpenAI format
                for (const r of msg.toolResults) {
                    formatted.push({
                        role: 'tool',
                        tool_call_id: r.toolCallId,
                        content: r.content,
                    });
                }
            } else if (msg.toolCalls && msg.toolCalls.length > 0) {
                // Assistant message with tool calls
                formatted.push({
                    role: 'assistant',
                    content: msg.content || null,
                    tool_calls: msg.toolCalls.map((tc) => ({
                        id: tc.id,
                        type: 'function',
                        function: {
                            name: tc.name,
                            arguments: JSON.stringify(tc.input),
                        },
                    })),
                });
            } else {
                formatted.push({role: msg.role, content: msg.content});
            }
        }
        return formatted;
    }

    async *chat(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<ProviderEvent> {
        if (!this.config.apiKey) {
            throw new Error('OpenAI API key not configured');
        }

        const body: Record<string, unknown> = {
            model: options?.model || this.config.model,
            messages: this.formatMessages(messages),
            stream: true,
            max_tokens: options?.maxTokens || this.config.maxTokens || 4096,
        };

        if (options?.temperature !== undefined || this.config.temperature !== undefined) {
            body.temperature = options?.temperature ?? this.config.temperature;
        }

        if (options?.tools && options.tools.length > 0) {
            body.tools = options.tools.map((t) => ({
                type: 'function',
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.inputSchema,
                },
            }));
        }

        const response = await fetch(`${this.getBaseUrl()}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.config.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal: options?.signal,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
        }

        yield* this.parseSSEStream(response);
    }

    protected async *parseSSEStream(response: Response): AsyncIterable<ProviderEvent> {
        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error('No response body');
        }

        const decoder = new TextDecoder();
        let buffer = '';

        // Track tool calls being built incrementally
        const pendingToolCalls: Map<number, {id: string; name: string; args: string}> = new Map();
        let stopReason: 'end' | 'tool_use' = 'end';

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
                            // Emit any pending tool calls
                            for (const tc of pendingToolCalls.values()) {
                                let input: Record<string, unknown> = {};
                                try { input = JSON.parse(tc.args || '{}'); } catch { /* ignore */ }
                                yield {type: 'tool_call', id: tc.id, name: tc.name, input};
                            }
                            yield {type: 'done', stopReason};
                            return;
                        }

                        try {
                            const event = JSON.parse(data);
                            const delta = event.choices?.[0]?.delta;
                            const finishReason = event.choices?.[0]?.finish_reason;

                            if (delta?.content) {
                                yield {type: 'text', text: delta.content};
                            }

                            // Accumulate tool calls
                            if (delta?.tool_calls) {
                                for (const tc of delta.tool_calls) {
                                    const idx = tc.index ?? 0;
                                    if (tc.id) {
                                        // New tool call starting
                                        pendingToolCalls.set(idx, {
                                            id: tc.id,
                                            name: tc.function?.name || '',
                                            args: tc.function?.arguments || '',
                                        });
                                    } else {
                                        // Continuation of existing tool call
                                        const existing = pendingToolCalls.get(idx);
                                        if (existing) {
                                            if (tc.function?.name) existing.name = tc.function.name;
                                            if (tc.function?.arguments) existing.args += tc.function.arguments;
                                        }
                                    }
                                }
                            }

                            if (finishReason === 'tool_calls') {
                                stopReason = 'tool_use';
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

        // Emit remaining tool calls if stream ended without [DONE]
        for (const tc of pendingToolCalls.values()) {
            let input: Record<string, unknown> = {};
            try { input = JSON.parse(tc.args || '{}'); } catch { /* ignore */ }
            yield {type: 'tool_call', id: tc.id, name: tc.name, input};
        }
        yield {type: 'done', stopReason};
    }

    async listModels(): Promise<ModelInfo[]> {
        return OPENAI_MODELS;
    }
}
