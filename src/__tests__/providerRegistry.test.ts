import {describe, it, expect, vi, beforeEach} from 'vitest';
import type {AIProvider, ProviderConfig, SessionStatus} from '@/shared/providers/types';

function createMockProvider(overrides: Partial<AIProvider> = {}): AIProvider {
    return {
        id: 'mock',
        name: 'Mock Provider',
        supportsStreaming: true,
        maxContextLength: 100000,
        authType: 'api-key',
        configure: vi.fn(),
        validateConfig: vi.fn().mockResolvedValue(true),
        chat: vi.fn(),
        listModels: vi.fn().mockResolvedValue([]),
        ...overrides,
    };
}

vi.mock('@/shared/providers/claude', () => ({
    ClaudeProvider: class { id = 'claude'; name = 'Claude'; supportsStreaming = true; maxContextLength = 200000; authType = 'api-key' as const; configure = vi.fn(); validateConfig = vi.fn(); chat = vi.fn(); listModels = vi.fn(); },
}));
vi.mock('@/shared/providers/claude-web', () => ({
    ClaudeWebProvider: class { id = 'claude-web'; name = 'Claude Web'; supportsStreaming = true; maxContextLength = 200000; authType = 'session' as const; configure = vi.fn(); validateConfig = vi.fn(); chat = vi.fn(); listModels = vi.fn(); getSessionStatus = vi.fn().mockResolvedValue({active: true, label: 'OK'}); },
}));
vi.mock('@/shared/providers/openai', () => ({
    OpenAIProvider: class { id = 'openai'; name = 'OpenAI'; supportsStreaming = true; maxContextLength = 128000; authType = 'api-key' as const; configure = vi.fn(); validateConfig = vi.fn(); chat = vi.fn(); listModels = vi.fn(); },
}));
vi.mock('@/shared/providers/chatgpt-web', () => ({
    ChatGPTWebProvider: class { id = 'chatgpt-web'; name = 'ChatGPT Web'; supportsStreaming = true; maxContextLength = 128000; authType = 'session' as const; configure = vi.fn(); validateConfig = vi.fn(); chat = vi.fn(); listModels = vi.fn(); },
}));
vi.mock('@/shared/providers/ollama', () => ({
    OllamaProvider: class { id = 'ollama'; name = 'Ollama'; supportsStreaming = true; maxContextLength = 128000; authType = 'local' as const; configure = vi.fn(); validateConfig = vi.fn(); chat = vi.fn(); listModels = vi.fn(); },
}));
vi.mock('@/shared/providers/openrouter', () => ({
    OpenRouterProvider: class { id = 'openrouter'; name = 'OpenRouter'; supportsStreaming = true; maxContextLength = 200000; authType = 'api-key' as const; configure = vi.fn(); validateConfig = vi.fn(); chat = vi.fn(); listModels = vi.fn(); },
}));

import {ProviderRegistry} from '@/shared/providers/registry';

describe('ProviderRegistry', () => {
    let registry: ProviderRegistry;

    beforeEach(() => {
        registry = new ProviderRegistry();
    });

    describe('registration', () => {
        it('registers all 6 default providers', () => {
            const all = registry.getAll();
            expect(all).toHaveLength(6);
            const ids = all.map((p) => p.id);
            expect(ids).toContain('claude');
            expect(ids).toContain('claude-web');
            expect(ids).toContain('openai');
            expect(ids).toContain('chatgpt-web');
            expect(ids).toContain('ollama');
            expect(ids).toContain('openrouter');
        });

        it('can register additional providers', () => {
            const custom = createMockProvider({id: 'custom', name: 'Custom'});
            registry.register(custom);
            expect(registry.get('custom')).toBe(custom);
            expect(registry.getAll()).toHaveLength(7);
        });
    });

    describe('get / getDefault', () => {
        it('get returns provider by id', () => {
            const p = registry.get('claude');
            expect(p).toBeDefined();
            expect(p!.id).toBe('claude');
        });

        it('get returns undefined for unknown id', () => {
            expect(registry.get('nonexistent')).toBeUndefined();
        });

        it('getDefault returns claude by default', () => {
            expect(registry.getDefault().id).toBe('claude');
        });

        it('setDefault changes default provider', () => {
            registry.setDefault('openai');
            expect(registry.getDefault().id).toBe('openai');
        });

        it('setDefault ignores unknown id', () => {
            registry.setDefault('nonexistent');
            expect(registry.getDefault().id).toBe('claude');
        });
    });

    describe('configureProvider', () => {
        it('calls provider.configure and stores config', () => {
            const config: ProviderConfig = {model: 'gpt-4o', apiKey: 'sk-test'};
            registry.configureProvider('openai', config);
            expect(registry.getConfig('openai')).toBe(config);
            expect(registry.get('openai')!.configure).toHaveBeenCalledWith(config);
        });

        it('ignores unknown provider id', () => {
            registry.configureProvider('nonexistent', {model: 'test'});
            expect(registry.getConfig('nonexistent')).toBeUndefined();
        });
    });

    describe('getStatuses', () => {
        it('returns status for all providers', async () => {
            registry.configureProvider('claude', {model: 'claude-3', apiKey: 'sk-test'});
            const statuses = await registry.getStatuses();
            expect(statuses).toHaveLength(6);

            const claudeStatus = statuses.find((s) => s.id === 'claude');
            expect(claudeStatus?.configured).toBe(true);
            expect(claudeStatus?.model).toBe('claude-3');
        });

        it('marks local providers as configured', async () => {
            const statuses = await registry.getStatuses();
            const ollama = statuses.find((s) => s.id === 'ollama');
            expect(ollama?.configured).toBe(true);
        });

        it('checks session status for session providers', async () => {
            const statuses = await registry.getStatuses();
            const claudeWeb = statuses.find((s) => s.id === 'claude-web');
            expect(claudeWeb?.configured).toBe(true);
        });

        it('marks unconfigured api-key providers', async () => {
            const statuses = await registry.getStatuses();
            const openai = statuses.find((s) => s.id === 'openai');
            expect(openai?.configured).toBe(false);
        });
    });
});
