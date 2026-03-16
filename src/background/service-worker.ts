import type {ExtensionMessage, SessionData} from '@/bridge/types';

// Get session from active tab's Mattermost cookies
async function getSessionFromActiveTab(): Promise<SessionData | null> {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab?.url) return null;

    let origin: string;
    try {
        const parsed = new URL(tab.url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        origin = parsed.origin;
    } catch {
        return null;
    }

    const authCookie = await chrome.cookies.get({url: origin, name: 'MMAUTHTOKEN'});
    if (!authCookie) return null;

    const csrfCookie = await chrome.cookies.get({url: origin, name: 'MMCSRF'});

    return {
        serverUrl: origin,
        token: authCookie.value,
        csrfToken: csrfCookie?.value || '',
    };
}

// Handle messages from side panel and content scripts
chrome.runtime.onMessage.addListener(
    (message: ExtensionMessage, sender, sendResponse) => {
        if (message.type === 'GET_SESSION') {
            getSessionFromActiveTab().then(sendResponse);
            return true; // async response
        }

        // Forward SEND_THREAD from content script to side panel
        // Also store as pending so side panel can pick it up on open
        if (message.type === 'SEND_THREAD' && sender.tab) {
            chrome.storage.session.set({pendingThread: message.postId}).catch(() => {});

            if (sender.tab.id) {
                chrome.sidePanel.open({tabId: sender.tab.id}).catch(() => {});
            }
        }

        // Forward SEND_RANGE from content script to side panel
        if (message.type === 'SEND_RANGE' && sender.tab) {
            chrome.storage.session.set({
                pendingRange: {start: message.startPostId, end: message.endPostId},
            }).catch(() => {});

            if (sender.tab.id) {
                chrome.sidePanel.open({tabId: sender.tab.id}).catch(() => {});
            }
        }

        return false;
    },
);

// Context menu: "Send to AI"
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: 'send-to-ai',
        title: 'Send to AI Assistant',
        contexts: ['page', 'selection'],
    });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== 'send-to-ai' || !tab?.id) return;

    // Ask content script to find the nearest post under the click
    try {
        const response = await chrome.tabs.sendMessage(tab.id, {type: 'GET_CLICKED_POST'});
        if (response?.postId) {
            await chrome.storage.session.set({pendingThread: response.postId});
            chrome.sidePanel.open({tabId: tab.id}).catch(() => {});
            chrome.runtime.sendMessage({type: 'SEND_THREAD', postId: response.postId}).catch(() => {});
        }
    } catch {
        // Content script not available on this page
    }
});

// Enable side panel to open by default
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true}).catch(() => {});

// Notify side panel when user switches tabs
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url) {
        chrome.runtime.sendMessage({type: 'TAB_CHANGED', url: tab.url}).catch(() => {});
    }
});

// Also notify when a tab finishes loading
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.active && tab.url) {
        chrome.runtime.sendMessage({type: 'TAB_CHANGED', url: tab.url}).catch(() => {});
    }
});
