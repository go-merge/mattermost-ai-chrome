import {describe, it, expect, beforeEach} from 'vitest';
import {useChatStore} from '@/sidepanel/stores/chatStore';
import type {ChatMessage} from '@/sidepanel/stores/chatStore';

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
    return {
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
        ...overrides,
    };
}

describe('chatStore', () => {
    beforeEach(() => {
        // Reset store state
        useChatStore.setState({
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
            contextDepth: -1,
            settingsOpen: false,
        });
    });

    describe('setConnection', () => {
        it('sets server URL, user ID, and connected flag', () => {
            useChatStore.getState().setConnection('https://mm.test.com', 'user123');
            const state = useChatStore.getState();
            expect(state.serverUrl).toBe('https://mm.test.com');
            expect(state.userId).toBe('user123');
            expect(state.connected).toBe(true);
        });
    });

    describe('thread management', () => {
        it('setThread updates thread and clears error', () => {
            useChatStore.setState({threadError: 'previous error'});
            const thread = {
                messages: [],
                channel: {id: 'ch1', team_id: 't1', name: 'gen', display_name: 'General', type: 'O', header: '', purpose: ''},
                rootPostId: 'p1',
                contextType: 'thread' as const,
            };
            useChatStore.getState().setThread(thread);
            expect(useChatStore.getState().thread).toBe(thread);
            expect(useChatStore.getState().threadError).toBeNull();
        });

        it('setThreadError sets error and clears loading', () => {
            useChatStore.setState({threadLoading: true});
            useChatStore.getState().setThreadError('Failed to load');
            expect(useChatStore.getState().threadError).toBe('Failed to load');
            expect(useChatStore.getState().threadLoading).toBe(false);
        });
    });

    describe('message management', () => {
        it('addMessage appends to messages array', () => {
            const msg = makeMessage({id: 'msg-1'});
            useChatStore.getState().addMessage(msg);
            expect(useChatStore.getState().messages).toHaveLength(1);
            expect(useChatStore.getState().messages[0].content).toBe('Hello');
        });

        it('appendToLastMessage appends to assistant message', () => {
            const msg = makeMessage({id: 'msg-1', role: 'assistant', content: 'Hi'});
            useChatStore.getState().addMessage(msg);
            useChatStore.getState().appendToLastMessage(' there');
            expect(useChatStore.getState().messages[0].content).toBe('Hi there');
        });

        it('appendToLastMessage does nothing if last is not assistant', () => {
            const msg = makeMessage({id: 'msg-1', role: 'user', content: 'Hi'});
            useChatStore.getState().addMessage(msg);
            useChatStore.getState().appendToLastMessage(' there');
            expect(useChatStore.getState().messages[0].content).toBe('Hi');
        });

        it('clearMessages resets messages and streaming state', () => {
            useChatStore.getState().addMessage(makeMessage());
            useChatStore.setState({isStreaming: true, currentRequestId: 'req-1'});
            useChatStore.getState().clearMessages();
            expect(useChatStore.getState().messages).toHaveLength(0);
            expect(useChatStore.getState().isStreaming).toBe(false);
            expect(useChatStore.getState().currentRequestId).toBeNull();
        });
    });

    describe('streaming', () => {
        it('setStreaming updates streaming state', () => {
            useChatStore.getState().setStreaming(true, 'req-1');
            expect(useChatStore.getState().isStreaming).toBe(true);
            expect(useChatStore.getState().currentRequestId).toBe('req-1');
        });

        it('finishStreaming marks last message as not streaming', () => {
            const msg = makeMessage({id: 'msg-1', role: 'assistant', isStreaming: true});
            useChatStore.getState().addMessage(msg);
            useChatStore.setState({isStreaming: true});
            useChatStore.getState().finishStreaming();

            const state = useChatStore.getState();
            expect(state.messages[0].isStreaming).toBe(false);
            expect(state.isStreaming).toBe(false);
            expect(state.currentRequestId).toBeNull();
        });
    });

    describe('tool calls', () => {
        it('addToolCallToLastMessage adds tool call to assistant message', () => {
            const msg = makeMessage({id: 'msg-1', role: 'assistant', content: ''});
            useChatStore.getState().addMessage(msg);
            useChatStore.getState().addToolCallToLastMessage({
                id: 'tc-1',
                name: 'search',
                input: {query: 'test'},
            });

            const toolCalls = useChatStore.getState().messages[0].toolCalls;
            expect(toolCalls).toHaveLength(1);
            expect(toolCalls![0].name).toBe('search');
        });

        it('updateToolCallResult updates specific tool call', () => {
            const msg = makeMessage({
                id: 'msg-1',
                role: 'assistant',
                content: '',
                toolCalls: [{id: 'tc-1', name: 'search', input: {}, isExecuting: true}],
            });
            useChatStore.getState().addMessage(msg);
            useChatStore.getState().updateToolCallResult('msg-1', 'tc-1', 'Found 3 results', false);

            const tc = useChatStore.getState().messages[0].toolCalls![0];
            expect(tc.result).toBe('Found 3 results');
            expect(tc.isError).toBe(false);
            expect(tc.isExecuting).toBe(false);
        });

        it('updateToolCallResult ignores non-matching message id', () => {
            const msg = makeMessage({
                id: 'msg-1',
                role: 'assistant',
                content: '',
                toolCalls: [{id: 'tc-1', name: 'search', input: {}, isExecuting: true}],
            });
            useChatStore.getState().addMessage(msg);
            useChatStore.getState().updateToolCallResult('msg-999', 'tc-1', 'result');

            const tc = useChatStore.getState().messages[0].toolCalls![0];
            expect(tc.result).toBeUndefined();
            expect(tc.isExecuting).toBe(true);
        });
    });

    describe('provider', () => {
        it('setActiveProvider updates provider and model', () => {
            useChatStore.getState().setActiveProvider('openai', 'gpt-4o');
            expect(useChatStore.getState().activeProviderId).toBe('openai');
            expect(useChatStore.getState().activeModel).toBe('gpt-4o');
        });
    });

    describe('context depth', () => {
        it('setContextDepth updates depth', () => {
            useChatStore.getState().setContextDepth(3);
            expect(useChatStore.getState().contextDepth).toBe(3);
        });
    });

    describe('user context', () => {
        it('setUserContext merges partial context', () => {
            useChatStore.getState().setUserContext({grade: 'Senior', unit: 'Backend'});
            const ctx = useChatStore.getState().userContext;
            expect(ctx.grade).toBe('Senior');
            expect(ctx.unit).toBe('Backend');
            expect(ctx.username).toBe(''); // default value preserved
        });
    });

    describe('settings', () => {
        it('toggles settings panel', () => {
            useChatStore.getState().setSettingsOpen(true);
            expect(useChatStore.getState().settingsOpen).toBe(true);
            useChatStore.getState().setSettingsOpen(false);
            expect(useChatStore.getState().settingsOpen).toBe(false);
        });
    });
});
