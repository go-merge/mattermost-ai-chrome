import type {AIProvider, ChatMessage, ChatOptions, ModelInfo, ProviderConfig, ProviderEvent, SessionStatus} from './types';

const CLAUDE_WEB_MODELS: ModelInfo[] = [
    {id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', contextWindow: 200000},
    {id: 'claude-opus-4-20250514', name: 'Claude Opus 4', contextWindow: 200000},
    {id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', contextWindow: 200000},
];

export class ClaudeWebProvider implements AIProvider {
    id = 'claude-web';
    name = 'Claude (Web)';
    supportsStreaming = true;
    maxContextLength = 200000;
    authType: 'session' = 'session';

    private config: ProviderConfig = {model: 'claude-sonnet-4-20250514'};
    private cachedOrgId: string | null = null;

    configure(config: ProviderConfig): void {
        const {model, ...rest} = config;
        this.config = {...this.config, ...rest, ...(model ? {model} : {})};
    }

    async validateConfig(): Promise<boolean> {
        try {
            const sessionKey = await this.getSessionKey();
            await this.getOrgId(sessionKey);
            return true;
        } catch {
            return false;
        }
    }

    async getSessionStatus(): Promise<SessionStatus> {
        try {
            const cookie = await chrome.cookies.get({
                url: 'https://claude.ai',
                name: 'sessionKey',
            });
            if (!cookie?.value) {
                return {active: false, label: 'Not logged in', detail: 'Open claude.ai and sign in'};
            }
            return {active: true, label: 'Session active'};
        } catch {
            return {active: false, label: 'Error checking session'};
        }
    }

    private async getSessionKey(): Promise<string> {
        const cookie = await chrome.cookies.get({
            url: 'https://claude.ai',
            name: 'sessionKey',
        });
        if (!cookie?.value) {
            throw new Error('Not logged into claude.ai — open claude.ai in any tab and sign in');
        }
        return cookie.value;
    }

    private async getOrgId(sessionKey: string): Promise<string> {
        if (this.cachedOrgId) return this.cachedOrgId;

        const response = await fetch('https://claude.ai/api/organizations', {
            headers: {
                'Content-Type': 'application/json',
                'Cookie': `sessionKey=${sessionKey}`,
            },
        });

        if (response.status === 403 || response.status === 401) {
            this.cachedOrgId = null;
            throw new Error('Claude.ai session expired — please log in again');
        }
        if (!response.ok) {
            throw new Error(`Claude.ai API error: ${response.status}`);
        }

        const orgs = await response.json();
        this.cachedOrgId = orgs[0]?.uuid;
        if (!this.cachedOrgId) throw new Error('No organization found on Claude.ai account');
        return this.cachedOrgId;
    }

    private async createConversation(sessionKey: string, orgId: string): Promise<string> {
        const uuid = crypto.randomUUID();
        const response = await fetch(
            `https://claude.ai/api/organizations/${orgId}/chat_conversations`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Cookie': `sessionKey=${sessionKey}`,
                },
                body: JSON.stringify({uuid, name: ''}),
            },
        );
        if (!response.ok) {
            throw new Error(`Failed to create conversation: ${response.status}`);
        }
        const data = await response.json();
        return data.uuid;
    }

    private packMessages(messages: ChatMessage[]): string {
        const systemMsg = messages.find((m) => m.role === 'system');
        const chatMsgs = messages.filter((m) => m.role !== 'system');

        const parts: string[] = [];
        if (systemMsg) {
            parts.push(`[System Instructions]\n${systemMsg.content}`);
        }

        if (chatMsgs.length > 1) {
            const history = chatMsgs.slice(0, -1);
            const historyText = history.map((m) =>
                `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`,
            ).join('\n\n');
            parts.push(`[Conversation History]\n${historyText}`);
        }

        const current = chatMsgs[chatMsgs.length - 1];
        if (current) {
            parts.push(current.content);
        }

        return parts.join('\n\n');
    }

    async *chat(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<ProviderEvent> {
        const sessionKey = await this.getSessionKey();
        const orgId = await this.getOrgId(sessionKey);
        const convId = await this.createConversation(sessionKey, orgId);
        const packedMessage = this.packMessages(messages);

        const response = await fetch(
            `https://claude.ai/api/organizations/${orgId}/chat_conversations/${convId}/completion`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Cookie': `sessionKey=${sessionKey}`,
                },
                body: JSON.stringify({
                    prompt: packedMessage,
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    model: options?.model || this.config.model,
                }),
                signal: options?.signal,
            },
        );

        if (response.status === 403 || response.status === 401) {
            this.cachedOrgId = null;
            throw new Error('Claude.ai session expired — please log in again');
        }
        if (response.status === 429) {
            throw new Error('Claude.ai rate limit reached — try again later');
        }
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Claude.ai error ${response.status}: ${text}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const {done, value} = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, {stream: true});
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const data = line.slice(6);
                    try {
                        const event = JSON.parse(data);
                        if (event.completion) {
                            yield {type: 'text', text: event.completion};
                        }
                        if (event.stop_reason === 'stop_sequence' || event.stop_reason === 'end_turn') {
                            yield {type: 'done', stopReason: 'end'};
                            return;
                        }
                    } catch {
                        // skip malformed JSON
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        yield {type: 'done', stopReason: 'end'};
    }

    async listModels(): Promise<ModelInfo[]> {
        return CLAUDE_WEB_MODELS;
    }
}
