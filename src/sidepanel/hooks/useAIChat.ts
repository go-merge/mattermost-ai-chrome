import {useCallback, useRef} from 'react';
import {useChatStore} from '../stores/chatStore';
import type {ToolCallState} from '../stores/chatStore';
import {providerRegistry} from '@/shared/providers/registry';
import {mcpManager} from '@/shared/mcp/manager';
import {buildSystemMessage, resolvePromptTemplate, buildTemplateVars} from '@/shared/context/quickActions';
import type {QuickAction} from '@/shared/context/types';
import type {ChatMessage, ProviderEvent, ToolCall} from '@/shared/providers/types';

const MAX_TOOL_ROUNDS = 10;

export function useAIChat() {
    const {
        messages,
        isStreaming,
        thread,
        activeProviderId,
        userContext,
        addMessage,
        appendToLastMessage,
        finishStreaming,
        setStreaming,
        addToolCallToLastMessage,
        updateToolCallResult,
    } = useChatStore();

    const abortRef = useRef<AbortController | null>(null);

    const sendMessage = useCallback(async (content: string) => {
        if (isStreaming || !content.trim()) return;

        // Resolve {{variables}} if present
        let resolved = content;
        if (/\{\{(thread|userName|userLogin|userContext)\}\}/.test(content)) {
            const vars = buildTemplateVars(thread, userContext);
            resolved = resolvePromptTemplate(content, vars);
        }

        // Add user message
        const userMsg = {
            id: `msg_${Date.now()}`,
            role: 'user' as const,
            content: resolved,
            timestamp: Date.now(),
        };
        addMessage(userMsg);

        // Build messages array for API, respecting context depth
        const {contextDepth, messages: currentMessages} = useChatStore.getState();
        const systemMessage = buildSystemMessage(userContext);
        let contextMsgs: typeof currentMessages = [];
        if (contextDepth === -1) {
            contextMsgs = currentMessages.slice(0, -1);
        } else if (contextDepth > 0) {
            contextMsgs = currentMessages.slice(0, -1).slice(-contextDepth);
        }

        const apiMessages: ChatMessage[] = [
            {role: 'system', content: systemMessage},
            ...contextMsgs.map((m) => ({
                role: m.role as ChatMessage['role'],
                content: m.content,
                ...(m.toolCalls ? {toolCalls: m.toolCalls.map((tc) => ({id: tc.id, name: tc.name, input: tc.input}))} : {}),
            })),
            {role: 'user', content: resolved},
        ];

        // Add placeholder assistant message
        const assistantMsgId = `msg_${Date.now()}_resp`;
        addMessage({
            id: assistantMsgId,
            role: 'assistant' as const,
            content: '',
            timestamp: Date.now(),
            isStreaming: true,
        });
        setStreaming(true);

        try {
            const provider = providerRegistry.get(activeProviderId) || providerRegistry.getDefault();
            abortRef.current = new AbortController();
            const activeModel = useChatStore.getState().activeModel;
            const tools = mcpManager.getAllTools();

            // Agentic loop — keep going while the model wants to use tools
            for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
                const toolCalls: ToolCall[] = [];
                let stopReason: 'end' | 'tool_use' = 'end';

                for await (const event of provider.chat(apiMessages, {
                    model: activeModel || undefined,
                    tools: tools.length > 0 ? tools : undefined,
                    signal: abortRef.current.signal,
                }) as AsyncIterable<ProviderEvent>) {
                    if (event.type === 'text') {
                        appendToLastMessage(event.text);
                    } else if (event.type === 'tool_call') {
                        toolCalls.push({id: event.id, name: event.name, input: event.input});
                        // Show tool call in UI
                        addToolCallToLastMessage({
                            id: event.id,
                            name: event.name,
                            input: event.input,
                            isExecuting: true,
                        } as ToolCallState);
                    } else if (event.type === 'done') {
                        stopReason = event.stopReason;
                    }
                }

                if (stopReason !== 'tool_use' || toolCalls.length === 0) {
                    break;
                }

                // Execute tool calls via MCP
                const currentMsgId = useChatStore.getState().messages[useChatStore.getState().messages.length - 1]?.id;

                // Add assistant message with tool calls to API messages
                apiMessages.push({
                    role: 'assistant',
                    content: useChatStore.getState().messages[useChatStore.getState().messages.length - 1]?.content || '',
                    toolCalls,
                });

                // Execute all tool calls and collect results
                const toolResults = await Promise.all(
                    toolCalls.map(async (tc) => {
                        try {
                            const result = await mcpManager.callTool(tc.name, tc.input);
                            updateToolCallResult(currentMsgId, tc.id, result.content, result.isError);
                            return {toolCallId: tc.id, content: result.content, isError: result.isError};
                        } catch (e) {
                            const errMsg = e instanceof Error ? e.message : 'Tool execution failed';
                            updateToolCallResult(currentMsgId, tc.id, errMsg, true);
                            return {toolCallId: tc.id, content: errMsg, isError: true};
                        }
                    }),
                );

                // Add tool results to API messages
                apiMessages.push({
                    role: 'user',
                    content: '',
                    toolResults,
                });

                // Continue the loop — model will respond with more text or more tool calls
                // Append a newline to visually separate tool results from next text
                appendToLastMessage('\n');
            }

            finishStreaming();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            appendToLastMessage(`\n\n**Error:** ${message}`);
            finishStreaming();
        } finally {
            abortRef.current = null;
        }
    }, [isStreaming, messages, thread, activeProviderId, userContext, addMessage, appendToLastMessage, finishStreaming, setStreaming, addToolCallToLastMessage, updateToolCallResult]);

    const executeQuickAction = useCallback(async (action: QuickAction) => {
        if (isStreaming) return;
        if (action.requiresThread && !thread) return;

        const vars = buildTemplateVars(thread, userContext);
        const resolvedPrompt = resolvePromptTemplate(action.prompt, vars);

        await sendMessage(resolvedPrompt);
    }, [isStreaming, thread, userContext, sendMessage]);

    return {
        messages,
        isStreaming,
        sendMessage,
        executeQuickAction,
    };
}
