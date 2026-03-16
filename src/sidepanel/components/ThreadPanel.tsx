import React, {useState} from 'react';
import {useMattermost} from '../hooks/useMattermost';
import {useChatStore} from '../stores/chatStore';

export function ThreadPanel() {
    const {thread, threadLoading, threadError, loadThreadFromUrl} = useMattermost();
    const setThread = useChatStore((s) => s.setThread);
    const [inputUrl, setInputUrl] = useState('');
    const [collapsed, setCollapsed] = useState(false);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (inputUrl.trim()) {
            loadThreadFromUrl(inputUrl);
        }
    };

    return (
        <div className="flex flex-col border-b border-mm-border">
            {/* Thread URL Input */}
            <form onSubmit={handleSubmit} className="flex gap-2 p-3">
                <input
                    type="text"
                    value={inputUrl}
                    onChange={(e) => setInputUrl(e.target.value)}
                    placeholder="Permalink or Post ID..."
                    className="flex-1 bg-mm-input text-mm-text text-sm px-3 py-2 rounded border border-mm-border focus:border-mm-accent focus:outline-none"
                />
                <button
                    type="submit"
                    disabled={threadLoading || !inputUrl.trim()}
                    className="px-3 py-2 bg-mm-accent text-white text-sm rounded hover:bg-mm-accentHover disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {threadLoading ? '...' : 'Load'}
                </button>
            </form>

            {/* Error */}
            {threadError && (
                <div className="mx-3 mb-2 p-2 bg-mm-error/20 text-mm-error text-xs rounded">
                    {threadError}
                </div>
            )}

            {/* Thread Preview */}
            {thread && (
                <div className="px-3 pb-2">
                    <button
                        onClick={() => setCollapsed(!collapsed)}
                        className="flex items-center gap-2 w-full text-left"
                    >
                        <svg
                            width="10" height="10" viewBox="0 0 24 24" fill="none"
                            stroke="currentColor" strokeWidth="2"
                            className={`text-mm-textSecondary transition-transform ${collapsed ? '' : 'rotate-90'}`}
                        >
                            <path d="M9 18l6-6-6-6" />
                        </svg>
                        <span className="text-mm-textSecondary text-xs">
                            #{thread.channel.display_name || thread.channel.name}
                        </span>
                        <span className="text-mm-textSecondary text-xs">
                            {thread.contextType === 'channel' ? 'Channel context' :
                             thread.contextType === 'range' ? 'Selected range' : 'Thread'}
                            {' · '}{thread.messages.length} msg
                        </span>
                        <button
                            onClick={(e) => { e.stopPropagation(); setThread(null); setInputUrl(''); setCollapsed(false); }}
                            className="ml-auto text-mm-textSecondary hover:text-mm-error text-sm"
                            title="Clear"
                        >
                            {'✕'}
                        </button>
                    </button>
                    {!collapsed && (
                        <div className="max-h-40 overflow-y-auto space-y-1 mt-2">
                            {thread.messages.slice(0, 5).map((msg) => (
                                <div key={msg.postId} className="text-xs">
                                    <span className="text-mm-accent font-medium">
                                        @{msg.author}
                                    </span>
                                    <span className="text-mm-textSecondary ml-1">
                                        {new Date(msg.timestamp).toLocaleTimeString([], {
                                            hour: '2-digit',
                                            minute: '2-digit',
                                        })}
                                    </span>
                                    <p className="text-mm-text mt-0.5 line-clamp-2">
                                        {msg.message}
                                    </p>
                                </div>
                            ))}
                            {thread.messages.length > 5 && (
                                <div className="text-mm-textSecondary text-xs">
                                    ... and {thread.messages.length - 5} more
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Loading */}
            {threadLoading && (
                <div className="px-3 pb-3 text-mm-textSecondary text-xs">
                    Loading thread...
                </div>
            )}
        </div>
    );
}
