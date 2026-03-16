import type {ChatMessage, ChatOptions, ModelInfo, ProviderConfig, ProviderEvent} from './types';
import {OpenAIProvider} from './openai';

const POPULAR_MODELS: ModelInfo[] = [
    {id: 'anthropic/claude-sonnet-4-20250514', name: 'Claude Sonnet 4', contextWindow: 200000},
    {id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku', contextWindow: 200000},
    {id: 'openai/gpt-4o', name: 'GPT-4o', contextWindow: 128000},
    {id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', contextWindow: 128000},
    {id: 'meta-llama/llama-3.1-405b-instruct', name: 'Llama 3.1 405B', contextWindow: 128000},
    {id: 'google/gemini-2.0-flash', name: 'Gemini 2.0 Flash', contextWindow: 1000000},
];

export class OpenRouterProvider extends OpenAIProvider {
    override id = 'openrouter';
    override name = 'OpenRouter';
    override maxContextLength = 200000;
    override authType: 'api-key' = 'api-key';

    private orConfig: ProviderConfig = {model: 'anthropic/claude-sonnet-4-20250514'};

    override configure(config: ProviderConfig): void {
        const {model, ...rest} = config;
        this.orConfig = {...this.orConfig, ...rest, ...(model ? {model} : {})};
        super.configure(config);
    }

    override async validateConfig(): Promise<boolean> {
        if (!this.orConfig.apiKey) {
            return false;
        }
        try {
            const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
                headers: {Authorization: `Bearer ${this.orConfig.apiKey}`},
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    override async *chat(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<ProviderEvent> {
        if (!this.orConfig.apiKey) {
            throw new Error('OpenRouter API key not configured');
        }

        const body: Record<string, unknown> = {
            model: options?.model || this.orConfig.model,
            messages: this.formatMessages(messages),
            stream: true,
            max_tokens: options?.maxTokens || this.orConfig.maxTokens || 4096,
        };

        if (options?.temperature !== undefined || this.orConfig.temperature !== undefined) {
            body.temperature = options?.temperature ?? this.orConfig.temperature;
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

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.orConfig.apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://mattermost-ai-companion.local',
                'X-Title': 'Mattermost AI Companion',
            },
            body: JSON.stringify(body),
            signal: options?.signal,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenRouter API error ${response.status}: ${errorText}`);
        }

        yield* this.parseSSEStream(response);
    }

    override async listModels(): Promise<ModelInfo[]> {
        if (!this.orConfig.apiKey) {
            return POPULAR_MODELS;
        }
        try {
            const response = await fetch('https://openrouter.ai/api/v1/models', {
                headers: {Authorization: `Bearer ${this.orConfig.apiKey}`},
            });
            if (!response.ok) return POPULAR_MODELS;

            const data = await response.json();
            return (data.data || []).slice(0, 50).map((m: {id: string; name: string; context_length?: number}) => ({
                id: m.id,
                name: m.name || m.id,
                contextWindow: m.context_length || 32000,
            }));
        } catch {
            return POPULAR_MODELS;
        }
    }
}
