import {describe, it, expect, vi, beforeEach} from 'vitest';
import {McpManager} from '@/shared/mcp/manager';
import type {McpServerConfig} from '@/shared/mcp/types';

// Mock McpClient as a class
vi.mock('@/shared/mcp/client', () => {
    return {
        McpClient: class MockMcpClient {
            url: string;
            headers: Record<string, string>;
            constructor(url: string, headers?: Record<string, string>) {
                this.url = url;
                this.headers = headers || {};
            }
            async initialize() {
                return {protocolVersion: '2024-11-05', capabilities: {}, serverInfo: {name: 'test', version: '1.0'}};
            }
            async listTools() {
                return [
                    {name: 'search', description: 'Search tool', inputSchema: {type: 'object'}},
                    {name: 'fetch', description: 'Fetch tool', inputSchema: {type: 'object'}},
                ];
            }
            async callTool() {
                return {content: 'result', isError: false};
            }
            getSessionId() {
                return 'session-123';
            }
        },
    };
});

function makeConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
    return {
        id: 'server1',
        name: 'TestServer',
        url: 'https://mcp.example.com',
        enabled: true,
        ...overrides,
    };
}

describe('McpManager', () => {
    let manager: McpManager;

    beforeEach(() => {
        manager = new McpManager();
    });

    describe('addServer', () => {
        it('adds and connects an enabled server', async () => {
            await manager.addServer(makeConfig());
            const states = manager.getServerStates();
            expect(states).toHaveLength(1);
            expect(states[0].status).toBe('connected');
            expect(states[0].toolCount).toBe(2);
        });

        it('adds but does not connect a disabled server', async () => {
            await manager.addServer(makeConfig({enabled: false}));
            const states = manager.getServerStates();
            expect(states).toHaveLength(1);
            expect(states[0].status).toBe('disconnected');
            expect(states[0].toolCount).toBe(0);
        });

        it('replaces existing server with same id', async () => {
            await manager.addServer(makeConfig());
            await manager.addServer(makeConfig({url: 'https://new-url.com'}));
            expect(manager.getServerStates()).toHaveLength(1);
        });
    });

    describe('removeServer', () => {
        it('removes server by id', async () => {
            await manager.addServer(makeConfig());
            expect(manager.getServerStates()).toHaveLength(1);
            manager.removeServer('server1');
            expect(manager.getServerStates()).toHaveLength(0);
        });
    });

    describe('onChange', () => {
        it('fires callback on server changes', async () => {
            const callback = vi.fn();
            manager.onChange(callback);
            await manager.addServer(makeConfig());
            expect(callback.mock.calls.length).toBeGreaterThanOrEqual(2);
        });

        it('returns unsubscribe function', async () => {
            const callback = vi.fn();
            const unsub = manager.onChange(callback);
            unsub();
            await manager.addServer(makeConfig());
            expect(callback).not.toHaveBeenCalled();
        });
    });

    describe('getAllTools', () => {
        it('returns tools from connected servers', async () => {
            await manager.addServer(makeConfig());
            const tools = manager.getAllTools();
            expect(tools).toHaveLength(2);
            expect(tools[0].name).toBe('search');
            expect(tools[1].name).toBe('fetch');
        });

        it('prefixes tool names when multiple servers', async () => {
            await manager.addServer(makeConfig({id: 's1', name: 'Alpha'}));
            await manager.addServer(makeConfig({id: 's2', name: 'Beta'}));
            const tools = manager.getAllTools();
            expect(tools.length).toBe(4);
            expect(tools[0].name).toBe('Alpha__search');
            expect(tools[2].name).toBe('Beta__search');
        });

        it('returns empty when no connected servers', async () => {
            await manager.addServer(makeConfig({enabled: false}));
            expect(manager.getAllTools()).toHaveLength(0);
        });
    });

    describe('callTool', () => {
        it('routes tool call to correct server', async () => {
            await manager.addServer(makeConfig());
            const result = await manager.callTool('search', {query: 'test'});
            expect(result.content).toBe('result');
            expect(result.isError).toBe(false);
        });

        it('returns error for unknown tool', async () => {
            await manager.addServer(makeConfig());
            const result = await manager.callTool('nonexistent', {});
            expect(result.isError).toBe(true);
            expect(result.content).toContain('not found');
        });
    });

    describe('helper methods', () => {
        it('getConnectedCount returns correct count', async () => {
            expect(manager.getConnectedCount()).toBe(0);
            await manager.addServer(makeConfig({id: 's1'}));
            expect(manager.getConnectedCount()).toBe(1);
            await manager.addServer(makeConfig({id: 's2', enabled: false}));
            expect(manager.getConnectedCount()).toBe(1);
        });

        it('hasTools returns true when tools available', async () => {
            expect(manager.hasTools()).toBe(false);
            await manager.addServer(makeConfig());
            expect(manager.hasTools()).toBe(true);
        });
    });

    describe('disconnectServer', () => {
        it('resets server state', async () => {
            await manager.addServer(makeConfig());
            expect(manager.getServerStates()[0].status).toBe('connected');

            await manager.disconnectServer('server1');
            const state = manager.getServerStates()[0];
            expect(state.status).toBe('disconnected');
            expect(state.toolCount).toBe(0);
        });
    });

    describe('connectAll', () => {
        it('connects all enabled disconnected servers', async () => {
            await manager.addServer(makeConfig({id: 's1', enabled: true}));
            await manager.disconnectServer('s1');
            await manager.addServer(makeConfig({id: 's2', enabled: false}));

            await manager.connectAll();

            const states = manager.getServerStates();
            expect(states.find((s) => s.config.id === 's1')?.status).toBe('connected');
            expect(states.find((s) => s.config.id === 's2')?.status).toBe('disconnected');
        });
    });
});
