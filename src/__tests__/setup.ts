// Mock chrome APIs globally
const storageData: Record<string, unknown> = {};

const chromeStorageArea = {
    get: vi.fn(async (keys: string | string[]) => {
        if (typeof keys === 'string') {
            return {[keys]: storageData[keys]};
        }
        const result: Record<string, unknown> = {};
        for (const key of keys) {
            result[key] = storageData[key];
        }
        return result;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(storageData, items);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
        const arr = typeof keys === 'string' ? [keys] : keys;
        for (const key of arr) {
            delete storageData[key];
        }
    }),
    clear: vi.fn(async () => {
        for (const key of Object.keys(storageData)) {
            delete storageData[key];
        }
    }),
};

const chromeMock = {
    storage: {
        local: chromeStorageArea,
        session: chromeStorageArea,
    },
    runtime: {
        sendMessage: vi.fn(),
        onMessage: {
            addListener: vi.fn(),
            removeListener: vi.fn(),
        },
        id: 'test-extension-id',
    },
    cookies: {
        get: vi.fn(),
        getAll: vi.fn(),
    },
    sidePanel: {
        open: vi.fn(),
        setOptions: vi.fn(),
    },
    tabs: {
        query: vi.fn(),
    },
};

Object.defineProperty(globalThis, 'chrome', {
    value: chromeMock,
    writable: true,
});

beforeEach(() => {
    for (const key of Object.keys(storageData)) {
        delete storageData[key];
    }
});
