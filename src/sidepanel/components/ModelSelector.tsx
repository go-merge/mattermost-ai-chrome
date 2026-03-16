import React, {useState, useEffect, useRef} from 'react';
import {useChatStore} from '../stores/chatStore';
import {providerRegistry} from '@/shared/providers/registry';
import {getSettings, saveSettings} from '@/bridge/settings';
import type {ModelInfo} from '@/shared/providers/types';

const PROVIDERS = [
    {id: 'claude', label: 'Claude'},
    {id: 'claude-web', label: 'Claude Web'},
    {id: 'openai', label: 'GPT'},
    {id: 'chatgpt-web', label: 'ChatGPT Web'},
    {id: 'ollama', label: 'Ollama'},
    {id: 'openrouter', label: 'Router'},
];

export function ModelSelector() {
    const {activeProviderId, activeModel, setActiveProvider} = useChatStore();
    const [modelsByProvider, setModelsByProvider] = useState<Record<string, ModelInfo[]>>({});
    const [open, setOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Fetch models for all configured providers on mount
    useEffect(() => {
        const fetchAll = async () => {
            const result: Record<string, ModelInfo[]> = {};
            for (const p of PROVIDERS) {
                const provider = providerRegistry.get(p.id);
                if (provider) {
                    try {
                        result[p.id] = await provider.listModels();
                    } catch {
                        result[p.id] = [];
                    }
                }
            }
            setModelsByProvider(result);
        };
        fetchAll();
    }, []);

    // Click outside to close
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const handleSelect = async (providerId: string, modelId: string) => {
        setActiveProvider(providerId, modelId);

        // Update provider internal config
        const existingConfig = providerRegistry.getConfig(providerId);
        providerRegistry.configureProvider(providerId, {
            ...existingConfig,
            model: modelId,
        });
        providerRegistry.setDefault(providerId);

        // Persist
        const settings = await getSettings();
        const providers = (settings.providers || {}) as Record<string, Record<string, string>>;
        providers[providerId] = {...providers[providerId], model: modelId};
        await saveSettings({providers, defaultProvider: providerId});

        setOpen(false);
    };

    const currentModels = modelsByProvider[activeProviderId] || [];
    const currentModelName = currentModels.find((m) => m.id === activeModel)?.name
        || activeModel?.split('/').pop()
        || 'Select model';
    const currentProvider = PROVIDERS.find((p) => p.id === activeProviderId);

    return (
        <div className="relative" ref={dropdownRef}>
            {/* Trigger — shows provider : model */}
            <button
                onClick={() => setOpen(!open)}
                className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] hover:bg-mm-hover transition-colors"
                title={`${currentProvider?.label}: ${activeModel}`}
            >
                <span className="text-mm-accent font-medium">{currentProvider?.label}</span>
                <span className="text-mm-textSecondary">·</span>
                <span className="text-mm-textSecondary truncate max-w-[110px]">{currentModelName}</span>
                <svg
                    width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    className={`text-mm-textSecondary flex-shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
                >
                    <path d="M6 9l6 6 6-6" />
                </svg>
            </button>

            {/* Dropdown — grouped by provider */}
            {open && (
                <div className="absolute top-full left-0 mt-1 bg-mm-sidebar border border-mm-border rounded-lg shadow-xl z-50 w-[230px] max-h-[340px] overflow-y-auto py-0.5">
                    {PROVIDERS.map((p) => {
                        const models = modelsByProvider[p.id] || [];
                        const isActiveProvider = p.id === activeProviderId;
                        const config = providerRegistry.getConfig(p.id);
                        const provider = providerRegistry.get(p.id);
                        const isSession = provider?.authType === 'session';
                        const isConfigured = !!config?.apiKey || p.id === 'ollama' || isSession;

                        return (
                            <div key={p.id} className="py-0.5">
                                {/* Provider group header */}
                                <div className={`flex items-center gap-1.5 px-3 py-1 text-[10px] uppercase tracking-wider font-semibold ${
                                    isActiveProvider ? 'text-mm-accent' : 'text-mm-textSecondary'
                                }`}>
                                    <span>{p.label}</span>
                                    {isSession && (
                                        <span className="text-yellow-400 normal-case tracking-normal font-normal ml-auto">web</span>
                                    )}
                                    {!isConfigured && !isSession && (
                                        <span className="text-mm-warning normal-case tracking-normal font-normal ml-auto">no key</span>
                                    )}
                                </div>

                                {/* Model items */}
                                {models.length > 0 ? (
                                    models.map((model) => {
                                        const isSelected = isActiveProvider && model.id === activeModel;
                                        return (
                                            <button
                                                key={`${p.id}/${model.id}`}
                                                onClick={() => handleSelect(p.id, model.id)}
                                                className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-2 ${
                                                    isSelected
                                                        ? 'text-mm-accent bg-mm-accent/8'
                                                        : 'text-mm-text hover:bg-mm-hover'
                                                }`}
                                                title={model.id}
                                            >
                                                <span className={`w-1 h-1 rounded-full flex-shrink-0 ${
                                                    isSelected ? 'bg-mm-accent' : 'bg-transparent'
                                                }`} />
                                                <span className="truncate">{model.name}</span>
                                            </button>
                                        );
                                    })
                                ) : (
                                    <div className="px-3 py-1 text-[10px] text-mm-textSecondary italic pl-6">
                                        {isSession ? 'Log in to use' : isConfigured ? 'No models' : 'Set API key in Settings'}
                                    </div>
                                )}

                                {/* Divider between groups */}
                                <div className="mx-2 border-b border-mm-border/40 mt-0.5" />
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
