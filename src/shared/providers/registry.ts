import type {AIProvider, ProviderConfig, ProviderStatus} from './types';
import {ClaudeProvider} from './claude';
import {ClaudeWebProvider} from './claude-web';
import {OpenAIProvider} from './openai';
import {ChatGPTWebProvider} from './chatgpt-web';
import {OllamaProvider} from './ollama';
import {OpenRouterProvider} from './openrouter';

export class ProviderRegistry {
    private providers: Map<string, AIProvider> = new Map();
    private configs: Map<string, ProviderConfig> = new Map();
    private defaultProviderId: string = 'claude';

    constructor() {
        this.register(new ClaudeProvider());
        this.register(new ClaudeWebProvider());
        this.register(new OpenAIProvider());
        this.register(new ChatGPTWebProvider());
        this.register(new OllamaProvider());
        this.register(new OpenRouterProvider());
    }

    register(provider: AIProvider): void {
        this.providers.set(provider.id, provider);
    }

    get(id: string): AIProvider | undefined {
        return this.providers.get(id);
    }

    getDefault(): AIProvider {
        return this.providers.get(this.defaultProviderId) || this.providers.values().next().value!;
    }

    setDefault(id: string): void {
        if (this.providers.has(id)) {
            this.defaultProviderId = id;
        }
    }

    configureProvider(id: string, config: ProviderConfig): void {
        const provider = this.providers.get(id);
        if (provider) {
            provider.configure(config);
            this.configs.set(id, config);
        }
    }

    getConfig(id: string): ProviderConfig | undefined {
        return this.configs.get(id);
    }

    getAll(): AIProvider[] {
        return Array.from(this.providers.values());
    }

    async getStatuses(): Promise<ProviderStatus[]> {
        const statuses: ProviderStatus[] = [];
        for (const provider of this.providers.values()) {
            const config = this.configs.get(provider.id);
            let configured = false;

            if (provider.authType === 'session') {
                configured = provider.getSessionStatus
                    ? (await provider.getSessionStatus()).active
                    : false;
            } else if (provider.authType === 'local') {
                configured = true;
            } else {
                configured = config?.apiKey !== undefined;
            }

            statuses.push({
                id: provider.id,
                name: provider.name,
                configured,
                model: config?.model || '',
            });
        }
        return statuses;
    }
}

export const providerRegistry = new ProviderRegistry();
