import {useCallback, useEffect, useRef} from 'react';
import {useChatStore} from '../stores/chatStore';
import {MattermostClient} from '@/shared/mattermost/client';
import {getSettings} from '@/bridge/settings';
import {providerRegistry} from '@/shared/providers/registry';
import {mcpManager} from '@/shared/mcp/manager';
import type {McpServerConfig} from '@/shared/mcp/types';
import {BUILTIN_ACTIONS} from '@/shared/context/quickActions';
import type {QuickAction} from '@/shared/context/types';
import type {ExtensionMessage} from '@/bridge/types';

export function useMattermost() {
    const {
        serverUrl,
        connected,
        thread,
        threadLoading,
        threadError,
        setConnection,
        setThread,
        setThreadLoading,
        setThreadError,
        setUserContext,
        setActiveProvider,
        setContextDepth,
        setQuickActions,
    } = useChatStore();

    const clientRef = useRef<MattermostClient | null>(null);

    // Initialize connection + load settings on mount
    useEffect(() => {
        const initConnection = async () => {
            try {
                // Get session from service worker (reads cookies)
                const session = await chrome.runtime.sendMessage({type: 'GET_SESSION'});
                if (session && session.token) {
                    clientRef.current = new MattermostClient(
                        session.serverUrl,
                        session.token,
                        session.csrfToken,
                    );
                    setConnection(session.serverUrl, '');

                    // Fetch current user info
                    const me = await clientRef.current.getMe();
                    setUserContext({
                        username: me.username,
                        displayName: `${me.first_name} ${me.last_name}`.trim() || me.username,
                        position: me.position || '',
                    });
                    setConnection(session.serverUrl, me.id);
                }
            } catch (e) {
                console.error('Failed to initialize Mattermost connection:', e);
            }
        };

        const initSettings = async () => {
            try {
                const settings = await getSettings();
                const providers = settings.providers as Record<string, {apiKey?: string; model?: string; baseUrl?: string}> | undefined;
                if (providers) {
                    for (const [id, config] of Object.entries(providers)) {
                        providerRegistry.configureProvider(id, {
                            apiKey: config.apiKey || '',
                            model: config.model || '',
                            baseUrl: config.baseUrl,
                        });
                    }
                }
                const defaultProvider = settings.defaultProvider as string | undefined;
                if (defaultProvider) {
                    providerRegistry.setDefault(defaultProvider);
                    const savedModel = providers?.[defaultProvider]?.model;
                    let model = savedModel || '';
                    if (!model) {
                        const provider = providerRegistry.get(defaultProvider);
                        if (provider) {
                            const models = await provider.listModels();
                            model = models[0]?.id || '';
                        }
                    }
                    setActiveProvider(defaultProvider, model);
                }

                // Load context depth
                if (typeof settings.contextDepth === 'number') {
                    setContextDepth(settings.contextDepth);
                }

                // Load quick actions — merge saved with builtins (new builtins appear automatically)
                const saved = settings.quickActions as QuickAction[] | undefined;
                if (saved?.length) {
                    const savedIds = new Set(saved.map((a) => a.id));
                    const newBuiltins = BUILTIN_ACTIONS.filter((b) => !savedIds.has(b.id));
                    setQuickActions([...saved, ...newBuiltins]);
                }
                // Load MCP servers
                const mcpServers = settings.mcpServers as McpServerConfig[] | undefined;
                if (mcpServers?.length) {
                    for (const server of mcpServers) {
                        mcpManager.addServer(server);
                    }
                }
            } catch (e) {
                console.error('Failed to load settings:', e);
            }
        };

        const checkPendingThread = async () => {
            try {
                const result = await chrome.storage.session.get(['pendingThread', 'pendingRange']);
                if (result.pendingRange) {
                    await chrome.storage.session.remove('pendingRange');
                    setTimeout(() => loadRange(result.pendingRange.start, result.pendingRange.end), 500);
                } else if (result.pendingThread) {
                    await chrome.storage.session.remove('pendingThread');
                    setTimeout(() => loadThread(result.pendingThread), 500);
                }
            } catch {
                // session storage not available
            }
        };

        initConnection().then(checkPendingThread);
        initSettings();
    }, [setConnection, setUserContext, setActiveProvider, setContextDepth, setQuickActions]);

    // Listen for messages from content script and service worker
    useEffect(() => {
        const listener = (message: ExtensionMessage) => {
            if (message.type === 'SEND_THREAD') {
                loadThread(message.postId);
            }
            if (message.type === 'SEND_RANGE') {
                loadRange(message.startPostId, message.endPostId);
            }
            if (message.type === 'TAB_CHANGED') {
                // Re-initialize connection for potentially different server
                const reinit = async () => {
                    try {
                        const session = await chrome.runtime.sendMessage({type: 'GET_SESSION'});
                        if (session && session.token) {
                            clientRef.current = new MattermostClient(
                                session.serverUrl,
                                session.token,
                                session.csrfToken,
                            );
                            setConnection(session.serverUrl, '');
                            const me = await clientRef.current.getMe();
                            setUserContext({
                                username: me.username,
                                displayName: `${me.first_name} ${me.last_name}`.trim() || me.username,
                                position: me.position || '',
                            });
                            setConnection(session.serverUrl, me.id);
                        }
                    } catch {
                        // Not a Mattermost tab — ignore
                    }
                };
                reinit();
            }
        };

        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
    }, [setConnection, setUserContext]);

    const loadThread = useCallback(async (postIdOrUrl: string) => {
        if (!clientRef.current) {
            setThreadError('Not connected to Mattermost');
            return;
        }

        setThreadLoading(true);
        setThreadError(null);

        try {
            const parsed = MattermostClient.parsePermalink(postIdOrUrl);
            const postId = parsed?.postId || postIdOrUrl;

            const threadContext = await clientRef.current.loadThread(postId);
            setThread(threadContext);
        } catch (e) {
            const message = e instanceof Error ? e.message : 'Failed to load thread';
            setThreadError(message);
        } finally {
            setThreadLoading(false);
        }
    }, [setThread, setThreadLoading, setThreadError]);

    const loadRange = useCallback(async (startPostId: string, endPostId: string) => {
        if (!clientRef.current) {
            setThreadError('Not connected to Mattermost');
            return;
        }

        setThreadLoading(true);
        setThreadError(null);

        try {
            const context = await clientRef.current.loadPostRange(startPostId, endPostId);
            setThread(context);
        } catch (e) {
            const message = e instanceof Error ? e.message : 'Failed to load range';
            setThreadError(message);
        } finally {
            setThreadLoading(false);
        }
    }, [setThread, setThreadLoading, setThreadError]);

    const loadThreadFromUrl = useCallback(async (url: string) => {
        const trimmed = url.trim();
        if (!trimmed) return;
        await loadThread(trimmed);
    }, [loadThread]);

    return {
        serverUrl,
        connected,
        thread,
        threadLoading,
        threadError,
        loadThread,
        loadThreadFromUrl,
    };
}
