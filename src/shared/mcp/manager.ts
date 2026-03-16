import {McpClient} from './client';
import type {McpServerConfig, McpServerState, McpConnectionStatus} from './types';
import type {ToolDefinition} from '../providers/types';

interface ManagedServer {
    config: McpServerConfig;
    client: McpClient;
    tools: ToolDefinition[];
    status: McpConnectionStatus;
    error?: string;
}

export class McpManager {
    private servers: Map<string, ManagedServer> = new Map();
    private onChangeCallbacks: Array<() => void> = [];

    onChange(callback: () => void): () => void {
        this.onChangeCallbacks.push(callback);
        return () => {
            this.onChangeCallbacks = this.onChangeCallbacks.filter((cb) => cb !== callback);
        };
    }

    private notifyChange(): void {
        for (const cb of this.onChangeCallbacks) {
            cb();
        }
    }

    async addServer(config: McpServerConfig): Promise<void> {
        // Disconnect existing if re-adding
        if (this.servers.has(config.id)) {
            this.removeServer(config.id);
        }

        const client = new McpClient(config.url, config.headers);
        const server: ManagedServer = {
            config,
            client,
            tools: [],
            status: 'disconnected',
        };

        this.servers.set(config.id, server);

        if (config.enabled) {
            await this.connectServer(config.id);
        }

        this.notifyChange();
    }

    removeServer(id: string): void {
        this.servers.delete(id);
        this.notifyChange();
    }

    async connectServer(id: string): Promise<void> {
        const server = this.servers.get(id);
        if (!server) return;

        server.status = 'connecting';
        server.error = undefined;
        this.notifyChange();

        try {
            await server.client.initialize();
            server.tools = await server.client.listTools();
            server.status = 'connected';
        } catch (e) {
            server.status = 'error';
            server.error = e instanceof Error ? e.message : 'Connection failed';
            server.tools = [];
        }

        this.notifyChange();
    }

    async disconnectServer(id: string): Promise<void> {
        const server = this.servers.get(id);
        if (!server) return;

        // Replace client (no explicit disconnect in MCP HTTP transport)
        server.client = new McpClient(server.config.url, server.config.headers);
        server.tools = [];
        server.status = 'disconnected';
        server.error = undefined;
        this.notifyChange();
    }

    getAllTools(): ToolDefinition[] {
        const tools: ToolDefinition[] = [];
        for (const server of this.servers.values()) {
            if (server.status !== 'connected') continue;
            for (const tool of server.tools) {
                tools.push({
                    // Prefix with server name to avoid collisions
                    name: this.servers.size > 1 ? `${server.config.name}__${tool.name}` : tool.name,
                    description: tool.description,
                    inputSchema: tool.inputSchema,
                });
            }
        }
        return tools;
    }

    async callTool(toolName: string, args: Record<string, unknown>): Promise<{content: string; isError: boolean}> {
        // Find the server that owns this tool
        for (const server of this.servers.values()) {
            if (server.status !== 'connected') continue;

            const prefix = this.servers.size > 1 ? `${server.config.name}__` : '';
            const originalName = prefix ? toolName.replace(prefix, '') : toolName;

            const hasTool = server.tools.some((t) => t.name === originalName);
            if (hasTool || server.tools.some((t) => `${server.config.name}__${t.name}` === toolName)) {
                return server.client.callTool(originalName, args);
            }
        }

        return {content: `Tool "${toolName}" not found on any connected MCP server`, isError: true};
    }

    getServerStates(): McpServerState[] {
        return Array.from(this.servers.values()).map((s) => ({
            config: s.config,
            status: s.status,
            error: s.error,
            toolCount: s.tools.length,
            sessionId: s.client.getSessionId(),
        }));
    }

    getConnectedCount(): number {
        let count = 0;
        for (const s of this.servers.values()) {
            if (s.status === 'connected') count++;
        }
        return count;
    }

    hasTools(): boolean {
        for (const server of this.servers.values()) {
            if (server.status === 'connected' && server.tools.length > 0) return true;
        }
        return false;
    }

    async connectAll(): Promise<void> {
        const promises: Promise<void>[] = [];
        for (const [id, server] of this.servers) {
            if (server.config.enabled && server.status === 'disconnected') {
                promises.push(this.connectServer(id));
            }
        }
        await Promise.allSettled(promises);
    }
}

// Singleton instance
export const mcpManager = new McpManager();
