import React from 'react';
import {useAIChat} from '../hooks/useAIChat';
import {useChatStore} from '../stores/chatStore';
import type {QuickAction} from '@/shared/context/types';

export function QuickActions() {
    const {executeQuickAction, isStreaming} = useAIChat();
    const thread = useChatStore((s) => s.thread);
    const quickActions = useChatStore((s) => s.quickActions);

    const builtinActions = quickActions.filter((a) => a.isBuiltin);
    const customActions = quickActions.filter((a) => !a.isBuiltin);

    const renderAction = (action: QuickAction) => {
        const disabled = isStreaming || (action.requiresThread && !thread);
        return (
            <button
                key={action.id}
                onClick={() => executeQuickAction(action)}
                disabled={disabled}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-mm-input text-mm-text rounded-full border border-mm-border hover:bg-mm-hover hover:border-mm-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title={disabled && action.requiresThread && !thread ? 'Load a thread first' : action.label}
            >
                <span>{action.icon}</span>
                <span>{action.label}</span>
            </button>
        );
    };

    return (
        <div className="px-3 py-2 border-b border-mm-border space-y-1.5">
            <div className="flex flex-wrap gap-2">
                {builtinActions.map(renderAction)}
            </div>
            {customActions.length > 0 && (
                <>
                    <div className="text-mm-textSecondary text-[9px] uppercase tracking-wider">Custom</div>
                    <div className="flex flex-wrap gap-2">
                        {customActions.map(renderAction)}
                    </div>
                </>
            )}
        </div>
    );
}
