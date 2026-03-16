import React, {useEffect, useRef} from 'react';
import {TEMPLATE_VARIABLES} from '@/shared/context/quickActions';
import type {ThreadContext} from '@/shared/mattermost/types';

interface Props {
    filter: string;
    selectedIndex: number;
    thread: ThreadContext | null;
    onSelect: (varKey: string) => void;
    onClose: () => void;
}

export function VariableAutocomplete({filter, selectedIndex, thread, onSelect, onClose}: Props) {
    const ref = useRef<HTMLDivElement>(null);

    const filtered = TEMPLATE_VARIABLES.filter((v) =>
        v.key.toLowerCase().startsWith(filter.toLowerCase()),
    );

    // Close on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [onClose]);

    if (filtered.length === 0) return null;

    return (
        <div
            ref={ref}
            className="absolute bottom-full left-0 mb-1 bg-mm-sidebar border border-mm-border rounded-lg shadow-xl z-50 w-full max-w-[300px] py-1"
        >
            {filtered.map((v, i) => {
                const isAvailable = !v.requiresThread || !!thread;
                const isSelected = i === selectedIndex;
                return (
                    <button
                        key={v.key}
                        onMouseDown={(e) => {
                            e.preventDefault(); // prevent textarea blur
                            if (isAvailable) onSelect(v.key);
                        }}
                        className={`w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors ${
                            isSelected ? 'bg-mm-hover' : ''
                        } ${isAvailable ? 'text-mm-text hover:bg-mm-hover' : 'text-mm-textSecondary opacity-40 cursor-default'}`}
                    >
                        <span className="w-5 text-center text-xs flex-shrink-0">{v.icon}</span>
                        <span className="font-mono text-mm-accent text-xs">{`{{${v.key}}}`}</span>
                        <span className="text-mm-textSecondary text-[10px] truncate">{v.description}</span>
                        {!isAvailable && (
                            <span className="text-mm-error text-[10px] ml-auto flex-shrink-0">no thread</span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
