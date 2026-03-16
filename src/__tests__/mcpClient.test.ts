import {describe, it, expect, vi, beforeEach} from 'vitest';
import {McpClient} from '@/shared/mcp/client';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(result: unknown, headers?: Record<string, string>) {
    const headerMap = new Map(Object.entries(headers || {}));
    return {
        ok: true,
        status: 200,
        headers: {
            get: (key: string) => headerMap.get(key) ?? null,
        },
        json: async () => ({jsonrpc: '2.0', id: 1, result}),
        text: async () => JSON.stringify({jsonrpc: '2.0', id: 1, result}),
    };
}

function errorResponse(code: number, message: string) {
    return {
        ok: true,
        status: 200,
        headers: {get: () => null},
        json: async () => ({jsonrpc: '2.0', id: 1, error: {code, message}}),
        text: async () => 'error',
    };
}

function httpErrorResponse(status: number) {
    return {
        ok: false,
        status,
        headers: {get: () => null},
        text: async () => `HTTP ${status} error`,
    };
}

describe('McpClient', () => {
    let client: McpClient;

    beforeEach(() => {
        mockFetch.mockReset();
        client = new McpClient('https://mcp.example.com/rpc', {'X-API-Key': 'test-key'});
    });

    describe('initialize', () => {
        it('sends initialize request and marks as initialized', async () => {
            const initResult = {
                protocolVersion: '2024-11-05',
                capabilities: {},
                serverInfo: {name: 'test', version: '1.0'},
            };

            // First call: initialize, second call: notification
            mockFetch
                .mockResolvedValueOnce(jsonResponse(initResult, {'Mcp-Session-Id': 'sess-1'}))
                .mockResolvedValueOnce({ok: true}); // notification

            const result = await client.initialize();

            expect(result.protocolVersion).toBe('2024-11-05');
            expect(client.isInitialized()).toBe(true);
            expect(client.getSessionId()).toBe('sess-1');

            // Verify the initialize request body
            const [, options] = mockFetch.mock.calls[0];
            const body = JSON.parse(options.body);
            expect(body.method).toBe('initialize');
            expect(body.params.protocolVersion).toBe('2024-11-05');
            expect(body.params.clientInfo.name).toBe('mattermost-ai-chrome');
        });

        it('sends custom headers', async () => {
            mockFetch
                .mockResolvedValueOnce(jsonResponse({}))
                .mockResolvedValueOnce({ok: true});

            await client.initialize();

            const [, options] = mockFetch.mock.calls[0];
            expect(options.headers['X-API-Key']).toBe('test-key');
            expect(options.headers['Content-Type']).toBe('application/json');
        });
    });

    describe('listTools', () => {
        it('throws if not initialized', async () => {
            await expect(client.listTools()).rejects.toThrow('not initialized');
        });

        it('returns mapped tool definitions', async () => {
            // Initialize first
            mockFetch
                .mockResolvedValueOnce(jsonResponse({}))
                .mockResolvedValueOnce({ok: true});
            await client.initialize();

            // listTools
            mockFetch.mockResolvedValueOnce(jsonResponse({
                tools: [
                    {name: 'search', description: 'Search stuff', inputSchema: {type: 'object', properties: {q: {type: 'string'}}}},
                ],
            }));

            const tools = await client.listTools();
            expect(tools).toHaveLength(1);
            expect(tools[0].name).toBe('search');
            expect(tools[0].description).toBe('Search stuff');
        });
    });

    describe('callTool', () => {
        it('throws if not initialized', async () => {
            await expect(client.callTool('search', {})).rejects.toThrow('not initialized');
        });

        it('sends tool call and returns flattened text', async () => {
            // Initialize
            mockFetch
                .mockResolvedValueOnce(jsonResponse({}))
                .mockResolvedValueOnce({ok: true});
            await client.initialize();

            // callTool
            mockFetch.mockResolvedValueOnce(jsonResponse({
                content: [
                    {type: 'text', text: 'Line 1'},
                    {type: 'text', text: 'Line 2'},
                ],
                isError: false,
            }));

            const result = await client.callTool('search', {query: 'hello'});
            expect(result.content).toBe('Line 1\nLine 2');
            expect(result.isError).toBe(false);
        });

        it('returns "(no output)" for empty content', async () => {
            mockFetch
                .mockResolvedValueOnce(jsonResponse({}))
                .mockResolvedValueOnce({ok: true});
            await client.initialize();

            mockFetch.mockResolvedValueOnce(jsonResponse({content: [], isError: false}));
            const result = await client.callTool('noop', {});
            expect(result.content).toBe('(no output)');
        });
    });

    describe('error handling', () => {
        it('throws on HTTP error', async () => {
            mockFetch.mockResolvedValueOnce(httpErrorResponse(500));
            await expect(client.initialize()).rejects.toThrow('MCP error 500');
        });

        it('throws on JSON-RPC error', async () => {
            mockFetch.mockResolvedValueOnce(errorResponse(-32600, 'Invalid request'));
            await expect(client.initialize()).rejects.toThrow('MCP RPC error -32600: Invalid request');
        });
    });

    describe('session management', () => {
        it('sends session ID in subsequent requests', async () => {
            // Initialize with session ID
            mockFetch
                .mockResolvedValueOnce(jsonResponse({}, {'Mcp-Session-Id': 'sess-42'}))
                .mockResolvedValueOnce({ok: true}); // notification
            await client.initialize();

            // Next request should include session ID
            mockFetch.mockResolvedValueOnce(jsonResponse({tools: []}));
            await client.listTools();

            const [, options] = mockFetch.mock.calls[2]; // 3rd call (init, notif, listTools)
            expect(options.headers['Mcp-Session-Id']).toBe('sess-42');
        });
    });
});
