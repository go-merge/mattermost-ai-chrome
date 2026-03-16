import React from 'react';
import {TopBar} from './components/TopBar';
import {ThreadPanel} from './components/ThreadPanel';
import {QuickActions} from './components/QuickActions';
import {ChatPanel} from './components/ChatPanel';
import {SettingsPanel} from './components/SettingsPanel';

export function App() {
    return (
        <div className="h-screen flex flex-col bg-mm-bg text-mm-text relative overflow-hidden">
            <TopBar />
            <ThreadPanel />
            <QuickActions />
            <ChatPanel />
            <SettingsPanel />
        </div>
    );
}
