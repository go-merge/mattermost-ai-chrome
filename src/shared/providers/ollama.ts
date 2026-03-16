import type {AIProvider, ChatMessage, ChatOptions, ModelInfo, ProviderConfig, ProviderEvent} from './types';

export class OllamaProvider implements AIProvider {
    id = 'ollama';
    name = 'Ollama (Local)';
    supportsStreaming = true;
    maxContextLength = 32000;
    authType: 'local' = 'local';

    private config: ProviderConfig = {
        model: 'llama3.1',
        baseUrl: 'http://localhost:11434',
    };

    configure(config: ProviderConfig): void {
        const {model, ...rest} = config;
        this.config = {...this.config, ...rest, ...(model ? {model} : {})};
    }

    private getBaseUrl(): string {
        return this.config.baseUrl || 'http://localhost:11434';
    }

    async validateConfig(): Promise<boolean> {
        try {
            const response = await fetch(`${this.getBaseUrl()}/api/tags`);
            return response.ok;
        } catch {
            return false;
        }
    }

    private formatMessages(messages: ChatMessage[]): unknown[] {
        const formatted: unknown[] = [];
        for (const msg of messages) {
            if (msg.toolResults && msg.toolResults.length > 0) {
                for (const r of msg.toolResults) {
                    formatted.push({role: 'tool', content: r.content});
                }
            } else if (msg.toolCalls && msg.toolCalls.length > 0) {
                formatted.push({
                    role: 'assistant',
                    content: msg.content || '',
                    tool_calls: msg.toolCalls.map((tc) => ({
                        function: {name: tc.name, arguments: tc.input},
                    })),
                });
            } else {
                formatted.push({role: msg.role, content: msg.content});
            }
        }
        return formatted;
    }

    async *chat(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<ProviderEvent> {
        const body: Record<string, unknown> = {
            model: options?.model || this.config.model,
            messages: this.formatMessages(messages),
            stream: true,
            options: {
                temperature: options?.temperature ?? this.config.temperature ?? 0.7,
                num_predict: options?.maxTokens || this.config.maxTokens || 4096,
            },
        };

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

        const response = await fetch(`${this.getBaseUrl()}/api/chat`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body),
            signal: options?.signal,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Ollama error ${response.status}: ${errorText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error('No response body');
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let stopReason: 'end' | 'tool_use' = 'end';

        try {
            while (true) {
                const {done, value} = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, {stream: true});
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const event = JSON.parse(line);

                        if (event.message?.content) {
                            yield {type: 'text', text: event.message.content};
                        }

                        if (event.message?.tool_calls) {
                            stopReason = 'tool_use';
                            for (const tc of event.message.tool_calls) {
                                yield {
                                    type: 'tool_call',
                                    id: `ollama_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                                    name: tc.function?.name || '',
                                    input: tc.function?.arguments || {},
                                };
                            }
                        }
                    } catch {
                        // skip malformed JSON
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        yield {type: 'done', stopReason};
    }

    async listModels(): Promise<ModelInfo[]> {
        try {
            const response = await fetch(`${this.getBaseUrl()}/api/tags`);
            if (!response.ok) return [];

            const data = await response.json();
            return (data.models || []).map((m: {name: string; details?: {parameter_size?: string}}) => ({
                id: m.name,
                name: m.name,
                contextWindow: 32000,
            }));
        } catch {
            return [];
        }
    }
}
