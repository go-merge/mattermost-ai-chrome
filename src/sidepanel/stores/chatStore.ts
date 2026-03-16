import {create} from 'zustand';
import type {ThreadContext} from '@/shared/mattermost/types';
import type {UserContext, QuickAction} from '@/shared/context/types';
import {DEFAULT_USER_CONTEXT} from '@/shared/context/types';
import {BUILTIN_ACTIONS} from '@/shared/context/quickActions';

export interface ToolCallState {
    id: string;
    name: string;
    input: Record<string, unknown>;
    result?: string;
    isError?: boolean;
    isExecuting?: boolean;
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    isStreaming?: boolean;
    toolCalls?: ToolCallState[];
}

interface ChatState {
    // Connection
    serverUrl: string;
    connected: boolean;
    userId: string;

    // Thread
    thread: ThreadContext | null;
    threadLoading: boolean;
    threadError: string | null;

    // Chat
    messages: ChatMessage[];
    isStreaming: boolean;
    currentRequestId: string | null;

    // Provider
    activeProviderId: string;
    activeModel: string;

    // Context depth: 0 = no context, -1 = all, N = last N messages
    contextDepth: number;

    // User context
    userContext: UserContext;

    // Quick actions
    quickActions: QuickAction[];

    // Settings
    settingsOpen: boolean;

    // Actions
    setConnection: (serverUrl: string, userId: string) => void;
    setThread: (thread: ThreadContext | null) => void;
    setThreadLoading: (loading: boolean) => void;
    setThreadError: (error: string | null) => void;
    addMessage: (message: ChatMessage) => void;
    appendToLastMessage: (chunk: string) => void;
    finishStreaming: () => void;
    setStreaming: (streaming: boolean, requestId?: string) => void;
    setActiveProvider: (providerId: string, model: string) => void;
    setContextDepth: (depth: number) => void;
    setUserContext: (context: Partial<UserContext>) => void;
    setQuickActions: (actions: QuickAction[]) => void;
    setSettingsOpen: (open: boolean) => void;
    clearMessages: () => void;
    addToolCallToLastMessage: (toolCall: ToolCallState) => void;
    updateToolCallResult: (messageId: string, toolCallId: string, result: string, isError?: boolean) => void;
}

export const useChatStore = create<ChatState>((set) => ({
    serverUrl: '',
    connected: false,
    userId: '',

    thread: null,
    threadLoading: false,
    threadError: null,

    messages: [],
    isStreaming: false,
    currentRequestId: null,

    activeProviderId: 'claude',
    activeModel: 'claude-sonnet-4-20250514',

    contextDepth: -1, // all messages by default

    userContext: DEFAULT_USER_CONTEXT,

    quickActions: [...BUILTIN_ACTIONS],

    settingsOpen: false,

    setConnection: (serverUrl, userId) => set({serverUrl, userId, connected: true}),

    setThread: (thread) => set({thread, threadError: null}),
    setThreadLoading: (loading) => set({threadLoading: loading}),
    setThreadError: (error) => set({threadError: error, threadLoading: false}),

    addMessage: (message) =>
        set((state) => ({messages: [...state.messages, message]})),

    appendToLastMessage: (chunk) =>
        set((state) => {
            const msgs = [...state.messages];
            const last = msgs[msgs.length - 1];
            if (last && last.role === 'assistant') {
                msgs[msgs.length - 1] = {...last, content: last.content + chunk};
            }
            return {messages: msgs};
        }),

    finishStreaming: () =>
        set((state) => {
            const msgs = [...state.messages];
            const last = msgs[msgs.length - 1];
            if (last && last.isStreaming) {
                msgs[msgs.length - 1] = {...last, isStreaming: false};
            }
            return {messages: msgs, isStreaming: false, currentRequestId: null};
        }),

    setStreaming: (streaming, requestId) =>
        set({isStreaming: streaming, currentRequestId: requestId || null}),

    setActiveProvider: (providerId, model) =>
        set({activeProviderId: providerId, activeModel: model}),

    setContextDepth: (depth) => set({contextDepth: depth}),

    setUserContext: (context) =>
        set((state) => ({userContext: {...state.userContext, ...context}})),

    setQuickActions: (actions) => set({quickActions: actions}),

    setSettingsOpen: (open) => set({settingsOpen: open}),

    clearMessages: () => set({messages: [], isStreaming: false, currentRequestId: null}),

    addToolCallToLastMessage: (toolCall) =>
        set((state) => {
            const msgs = [...state.messages];
            const last = msgs[msgs.length - 1];
            if (last && last.role === 'assistant') {
                const existing = last.toolCalls || [];
                msgs[msgs.length - 1] = {...last, toolCalls: [...existing, toolCall]};
            }
            return {messages: msgs};
        }),

    updateToolCallResult: (messageId, toolCallId, result, isError) =>
        set((state) => {
            const msgs = state.messages.map((msg) => {
                if (msg.id !== messageId || !msg.toolCalls) return msg;
                return {
                    ...msg,
                    toolCalls: msg.toolCalls.map((tc) =>
                        tc.id === toolCallId
                            ? {...tc, result, isError: isError || false, isExecuting: false}
                            : tc,
                    ),
                };
            });
            return {messages: msgs};
        }),
}));
