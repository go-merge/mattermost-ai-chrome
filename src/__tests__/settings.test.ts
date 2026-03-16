import {describe, it, expect, beforeEach} from 'vitest';
import {getSettings, saveSettings} from '@/bridge/settings';

describe('settings', () => {
    beforeEach(() => {
        // Storage is reset in setup.ts beforeEach
    });

    it('returns empty object when no settings saved', async () => {
        const settings = await getSettings();
        expect(settings).toEqual({});
    });

    it('saves and retrieves settings', async () => {
        await saveSettings({theme: 'dark', fontSize: 14});
        const settings = await getSettings();
        expect(settings).toEqual({theme: 'dark', fontSize: 14});
    });

    it('merges new settings with existing', async () => {
        await saveSettings({theme: 'dark'});
        await saveSettings({fontSize: 14});
        const settings = await getSettings();
        expect(settings).toEqual({theme: 'dark', fontSize: 14});
    });

    it('overwrites existing keys', async () => {
        await saveSettings({theme: 'dark'});
        await saveSettings({theme: 'light'});
        const settings = await getSettings();
        expect(settings.theme).toBe('light');
    });
});
