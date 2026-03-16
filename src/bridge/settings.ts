// Settings persistence via chrome.storage.local

export async function getSettings(): Promise<Record<string, unknown>> {
    const result = await chrome.storage.local.get('aiSettings');
    return (result.aiSettings as Record<string, unknown>) || {};
}

export async function saveSettings(settings: Record<string, unknown>): Promise<void> {
    const existing = await getSettings();
    await chrome.storage.local.set({aiSettings: {...existing, ...settings}});
}
