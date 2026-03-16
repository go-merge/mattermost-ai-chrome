import React, {useRef, useEffect, useState, useMemo} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import {useAIChat} from '../hooks/useAIChat';
import {useChatStore} from '../stores/chatStore';
import type {ToolCallState} from '../stores/chatStore';
import {saveSettings} from '@/bridge/settings';
import {TEMPLATE_VARIABLES} from '@/shared/context/quickActions';
import {VariableAutocomplete} from './VariableAutocomplete';

const CONTEXT_OPTIONS = [
    {value: 0, label: 'None', desc: 'No message history'},
    {value: 3, label: 'Last 3', desc: 'Last 3 messages'},
    {value: 10, label: 'Last 10', desc: 'Last 10 messages'},
    {value: -1, label: 'All', desc: 'Full conversation'},
] as const;

function PreBlock({children, ...props}: React.HTMLAttributes<HTMLPreElement>) {
    const [copied, setCopied] = useState(false);
    const codeRef = useRef<HTMLPreElement>(null);

    const handleCopy = () => {
        const text = codeRef.current?.textContent || '';
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    return (
        <div className="relative group/code">
            <button
                onClick={handleCopy}
                className="absolute top-1.5 right-1.5 opacity-0 group-hover/code:opacity-100 transition-opacity px-1.5 py-0.5 rounded bg-mm-hover text-mm-textSecondary hover:text-mm-text text-[10px]"
            >
                {copied ? 'Copied!' : 'Copy'}
            </button>
            <pre ref={codeRef} {...props}>{children}</pre>
        </div>
    );
}

function ToolCallBlock({toolCall}: {toolCall: ToolCallState}) {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className="my-1.5 border border-mm-border rounded text-[11px]">
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center gap-1.5 px-2 py-1 hover:bg-mm-hover/50 transition-colors text-left"
            >
                {toolCall.isExecuting ? (
                    <span className="inline-block w-3 h-3 border-2 border-mm-accent border-t-transparent rounded-full animate-spin flex-shrink-0" />
                ) : toolCall.isError ? (
                    <span className="text-red-400 flex-shrink-0">!</span>
                ) : (
                    <span className="text-green-400 flex-shrink-0">ok</span>
                )}
                <span className="text-mm-textSecondary font-mono truncate flex-1">{toolCall.name}</span>
                <svg
                    width="10" height="10" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2"
                    className={`text-mm-textSecondary transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`}
                >
                    <path d="M6 9l6 6 6-6" />
                </svg>
            </button>
            {expanded && (
                <div className="px-2 pb-1.5 space-y-1 border-t border-mm-border">
                    <div className="text-mm-textSecondary mt-1">Input:</div>
                    <pre className="text-[10px] bg-mm-bg rounded p-1 overflow-x-auto max-h-24 overflow-y-auto">
                        {JSON.stringify(toolCall.input, null, 2)}
                    </pre>
                    {toolCall.result !== undefined && (
                        <>
                            <div className={toolCall.isError ? 'text-red-400' : 'text-mm-textSecondary'}>
                                {toolCall.isError ? 'Error:' : 'Result:'}
                            </div>
                            <pre className={`text-[10px] rounded p-1 overflow-x-auto max-h-32 overflow-y-auto ${
                                toolCall.isError ? 'bg-red-900/20 text-red-300' : 'bg-mm-bg'
                            }`}>
                                {toolCall.result}
                            </pre>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

function ContextDepthBar() {
    const contextDepth = useChatStore((s) => s.contextDepth);
    const setContextDepth = useChatStore((s) => s.setContextDepth);
    const messageCount = useChatStore((s) => s.messages.length);

    return (
        <div className="flex items-center gap-1 px-3 pt-2.5 pb-1.5">
            <span className="text-mm-textSecondary text-[10px] mr-1" title="How many previous messages to include as context">
                Context
            </span>
            {CONTEXT_OPTIONS.map((opt) => {
                const isActive = contextDepth === opt.value;
                const isDisabled = opt.value !== 0 && opt.value !== -1 && messageCount < opt.value;
                return (
                    <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                            setContextDepth(opt.value);
                            saveSettings({contextDepth: opt.value});
                        }}
                        disabled={isDisabled}
                        title={opt.desc}
                        className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                            isActive
                                ? 'bg-mm-accent/15 text-mm-accent border border-mm-accent/30'
                                : 'text-mm-textSecondary hover:text-mm-text hover:bg-mm-hover border border-transparent'
                        } ${isDisabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                        {opt.label}
                        {isActive && opt.value === -1 && messageCount > 0 && (
                            <span className="ml-0.5 opacity-60">{messageCount}</span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

export function ChatPanel() {
    const {messages, isStreaming, sendMessage} = useAIChat();
    const contextDepth = useChatStore((s) => s.contextDepth);
    const thread = useChatStore((s) => s.thread);
    const [input, setInput] = useState('');
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [inputFocused, setInputFocused] = useState(false);
    const [showVarMenu, setShowVarMenu] = useState(false);
    const [varFilter, setVarFilter] = useState('');
    const [varSelectedIndex, setVarSelectedIndex] = useState(0);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Variables detected in the current input
    const detectedVars = useMemo(() =>
        TEMPLATE_VARIABLES.filter((v) => input.includes(`{{${v.key}}}`)),
    [input]);

    // Filtered vars for autocomplete
    const filteredVars = useMemo(() =>
        TEMPLATE_VARIABLES.filter((v) => v.key.toLowerCase().startsWith(varFilter.toLowerCase())),
    [varFilter]);

    // Insert variable at cursor position
    const insertVariable = (varKey: string) => {
        const el = textareaRef.current;
        if (!el) return;

        const cursorPos = el.selectionStart;
        const textBeforeCursor = input.slice(0, cursorPos);
        const triggerPos = textBeforeCursor.lastIndexOf('{{');

        let before: string;
        let after: string;

        if (triggerPos !== -1 && showVarMenu) {
            // Replace from {{ trigger
            before = input.slice(0, triggerPos);
            after = input.slice(cursorPos);
        } else {
            // Insert at cursor (from chip click)
            before = input.slice(0, cursorPos);
            after = input.slice(cursorPos);
        }

        const insertion = `{{${varKey}}}`;
        const newValue = before + insertion + after;
        setInput(newValue);
        setShowVarMenu(false);
        setVarFilter('');

        requestAnimationFrame(() => {
            const newPos = before.length + insertion.length;
            el.setSelectionRange(newPos, newPos);
            el.focus();
        });
    };

    // Filter visible messages based on context depth
    const allVisible = messages.filter((m) => m.role !== 'system');
    let visibleMessages = allVisible;
    let hiddenCount = 0;
    if (contextDepth === 0) {
        // Show only the last user+assistant pair (or just last msg if streaming)
        const lastPairStart = Math.max(0, allVisible.length - 2);
        visibleMessages = allVisible.slice(lastPairStart);
        hiddenCount = allVisible.length - visibleMessages.length;
    } else if (contextDepth > 0) {
        // Show last N messages
        visibleMessages = allVisible.slice(-contextDepth);
        hiddenCount = allVisible.length - visibleMessages.length;
    }

    // Auto-scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({behavior: 'smooth'});
    }, [messages, messages[messages.length - 1]?.content]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (input.trim() && !isStreaming) {
            sendMessage(input.trim());
            setInput('');
            if (textareaRef.current) {
                textareaRef.current.style.height = 'auto';
            }
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (showVarMenu && filteredVars.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setVarSelectedIndex((prev) => Math.min(prev + 1, filteredVars.length - 1));
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setVarSelectedIndex((prev) => Math.max(prev - 1, 0));
                return;
            }
            if (e.key === 'Tab' || e.key === 'Enter') {
                e.preventDefault();
                const selected = filteredVars[varSelectedIndex];
                if (selected && (!selected.requiresThread || thread)) {
                    insertVariable(selected.key);
                }
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                setShowVarMenu(false);
                return;
            }
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
        }
    };

    const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const value = e.target.value;
        setInput(value);

        // Auto-resize textarea
        const el = e.target;
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 120) + 'px';

        // Detect {{ for variable autocomplete
        const cursorPos = el.selectionStart;
        const textBeforeCursor = value.slice(0, cursorPos);
        const match = textBeforeCursor.match(/\{\{(\w*)$/);
        if (match) {
            setShowVarMenu(true);
            setVarFilter(match[1]);
            setVarSelectedIndex(0);
        } else {
            setShowVarMenu(false);
            setVarFilter('');
        }
    };

    return (
        <div className="flex flex-col flex-1 min-h-0">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
                {messages.length === 0 && (
                    <div className="text-mm-textSecondary text-sm text-center py-8">
                        Load a thread and use quick actions, or ask a question directly.
                    </div>
                )}
                {hiddenCount > 0 && (
                    <button
                        onClick={() => useChatStore.getState().setContextDepth(-1)}
                        className="w-full text-center text-[10px] text-mm-textSecondary hover:text-mm-accent py-1.5 transition-colors"
                    >
                        {hiddenCount} earlier message{hiddenCount > 1 ? 's' : ''} hidden — show all
                    </button>
                )}
                {visibleMessages.map((msg) => (
                    <div
                        key={msg.id}
                        className={`group flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                    >
                        <div
                            className={`relative max-w-[90%] rounded-lg px-3 py-2 text-sm ${
                                msg.role === 'user'
                                    ? 'bg-mm-accent text-white'
                                    : 'bg-mm-input text-mm-text'
                            }`}
                        >
                            {msg.role === 'assistant' && !msg.isStreaming && msg.content && (
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(msg.content);
                                        setCopiedId(msg.id);
                                        setTimeout(() => setCopiedId(null), 1500);
                                    }}
                                    className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-mm-hover text-mm-textSecondary hover:text-mm-text"
                                    title="Copy"
                                >
                                    {copiedId === msg.id ? (
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M20 6L9 17l-5-5" />
                                        </svg>
                                    ) : (
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                                        </svg>
                                    )}
                                </button>
                            )}
                            {msg.role === 'assistant' ? (
                                <div className="markdown-body break-words">
                                    <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    rehypePlugins={[rehypeHighlight]}
                                    components={{pre: PreBlock}}
                                >{msg.content}</ReactMarkdown>
                                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                                        <div className="mt-1">
                                            {msg.toolCalls.map((tc) => (
                                                <ToolCallBlock key={tc.id} toolCall={tc} />
                                            ))}
                                        </div>
                                    )}
                                    {msg.isStreaming && (
                                        <span className="inline-block w-1.5 h-4 bg-mm-accent ml-0.5 animate-pulse" />
                                    )}
                                </div>
                            ) : (
                                <div className="whitespace-pre-wrap break-words">
                                    {msg.content}
                                </div>
                            )}
                        </div>
                        <span className="text-mm-textSecondary text-[10px] mt-0.5 px-1">
                            {msg.role === 'user' ? 'You' : 'AI'}
                            {' '}
                            {new Date(msg.timestamp).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                            })}
                        </span>
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form onSubmit={handleSubmit} className="border-t border-mm-border">
                {/* Context depth selector */}
                <ContextDepthBar />

                {/* Variable chips */}
                {(inputFocused || input.length > 0) && (
                    <div className="flex items-center gap-1 px-3 pb-1.5 flex-wrap">
                        <span className="text-mm-textSecondary text-[10px] mr-0.5">Insert:</span>
                        {TEMPLATE_VARIABLES.map((v) => {
                            const isAvailable = !v.requiresThread || !!thread;
                            return (
                                <button
                                    key={v.key}
                                    type="button"
                                    onMouseDown={(e) => {
                                        e.preventDefault(); // prevent textarea blur
                                        if (isAvailable) insertVariable(v.key);
                                    }}
                                    disabled={!isAvailable}
                                    title={isAvailable ? v.description : 'Load a thread first'}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                                        isAvailable
                                            ? 'text-mm-accent border-mm-accent/30 hover:bg-mm-accent/10 hover:border-mm-accent/50 cursor-pointer'
                                            : 'text-mm-textSecondary border-mm-border opacity-40 cursor-not-allowed'
                                    }`}
                                >
                                    {v.icon} {v.key}
                                </button>
                            );
                        })}
                    </div>
                )}

                <div className="flex gap-2 items-end px-3 pb-3 relative">
                    {/* Autocomplete dropdown */}
                    {showVarMenu && (
                        <VariableAutocomplete
                            filter={varFilter}
                            selectedIndex={varSelectedIndex}
                            thread={thread}
                            onSelect={insertVariable}
                            onClose={() => setShowVarMenu(false)}
                        />
                    )}
                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={handleInput}
                        onKeyDown={handleKeyDown}
                        onFocus={() => setInputFocused(true)}
                        onBlur={() => setTimeout(() => setInputFocused(false), 150)}
                        placeholder="Ask a question... (type {{ for variables)"
                        rows={1}
                        className="flex-1 bg-mm-input text-mm-text text-sm px-3 py-2 rounded border border-mm-border focus:border-mm-accent focus:outline-none resize-none"
                        style={{maxHeight: '120px'}}
                    />
                    <button
                        type="submit"
                        disabled={isStreaming || !input.trim()}
                        className="px-3 py-2 bg-mm-accent text-white rounded hover:bg-mm-accentHover disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M22 2L11 13" />
                            <path d="M22 2L15 22L11 13L2 9L22 2Z" />
                        </svg>
                    </button>
                </div>

                {/* "Will resolve" indicator */}
                {detectedVars.length > 0 && (
                    <div className="flex items-center gap-1 px-3 pb-2 -mt-1">
                        <span className="text-mm-textSecondary text-[10px]">Will resolve:</span>
                        {detectedVars.map((v) => (
                            <span key={v.key} className="text-[10px] font-mono text-mm-accent bg-mm-accent/10 px-1 py-0.5 rounded">
                                {v.icon} {v.key}
                            </span>
                        ))}
                    </div>
                )}
            </form>
        </div>
    );
}
