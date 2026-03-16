import type {AIProvider, ChatMessage, ChatOptions, ModelInfo, ProviderConfig, ProviderEvent, SessionStatus} from './types';

const CHATGPT_WEB_MODELS: ModelInfo[] = [
    {id: 'auto', name: 'Auto (Best Available)', contextWindow: 128000},
    {id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000},
    {id: 'gpt-4', name: 'GPT-4', contextWindow: 32000},
];

export class ChatGPTWebProvider implements AIProvider {
    id = 'chatgpt-web';
    name = 'ChatGPT (Web)';
    supportsStreaming = true;
    maxContextLength = 128000;
    authType: 'session' = 'session';

    private config: ProviderConfig = {model: 'auto'};
    private cachedAccessToken: string | null = null;
    private tokenExpiry: number = 0;

    configure(config: ProviderConfig): void {
        const {model, ...rest} = config;
        this.config = {...this.config, ...rest, ...(model ? {model} : {})};
    }

    async validateConfig(): Promise<boolean> {
        try {
            await this.getAccessToken();
            return true;
        } catch {
            return false;
        }
    }

    async getSessionStatus(): Promise<SessionStatus> {
        try {
            const cookie = await chrome.cookies.get({
                url: 'https://chatgpt.com',
                name: '__Secure-next-auth.session-token',
            });
            if (!cookie?.value) {
                return {active: false, label: 'Not logged in', detail: 'Open chatgpt.com and sign in'};
            }
            return {active: true, label: 'Session active'};
        } catch {
            return {active: false, label: 'Error checking session'};
        }
    }

    private async getSessionCookie(): Promise<string> {
        const cookie = await chrome.cookies.get({
            url: 'https://chatgpt.com',
            name: '__Secure-next-auth.session-token',
        });
        if (!cookie?.value) {
            throw new Error('Not logged into chatgpt.com — open chatgpt.com in any tab and sign in');
        }
        return cookie.value;
    }

    private async getAccessToken(): Promise<string> {
        if (this.cachedAccessToken && Date.now() < this.tokenExpiry) {
            return this.cachedAccessToken;
        }

        const sessionToken = await this.getSessionCookie();
        const response = await fetch('https://chatgpt.com/api/auth/session', {
            headers: {
                'Cookie': `__Secure-next-auth.session-token=${sessionToken}`,
            },
        });

        if (!response.ok) {
            this.cachedAccessToken = null;
            throw new Error(`ChatGPT session error: ${response.status}`);
        }

        const data = await response.json();
        if (!data.accessToken) {
            throw new Error('ChatGPT session expired — please log in again');
        }

        this.cachedAccessToken = data.accessToken;
        // Cache for 55 minutes (tokens typically last ~1 hour)
        this.tokenExpiry = Date.now() + 55 * 60 * 1000;
        return data.accessToken;
    }

    private async getChatRequirements(accessToken: string): Promise<{
        token: string;
        proofOfWork?: {seed: string; difficulty: string};
    }> {
        const response = await fetch('https://chatgpt.com/backend-api/sentinel/chat-requirements', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
        });

        if (!response.ok) {
            throw new Error(`Chat requirements failed: ${response.status}`);
        }

        const data = await response.json();
        return {
            token: data.token,
            proofOfWork: data.proofofwork?.required ? {
                seed: data.proofofwork.seed,
                difficulty: data.proofofwork.difficulty,
            } : undefined,
        };
    }

    private async solveProofOfWork(seed: string, difficulty: string): Promise<string> {
        const difficultyNum = parseInt(difficulty, 16) || 6;
        const encoder = new TextEncoder();
        const maxIterations = 500000;

        for (let nonce = 0; nonce < maxIterations; nonce++) {
            const input = `${seed}${nonce}`;
            const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(input));
            const hashArray = new Uint8Array(hashBuffer);

            let zeroBits = 0;
            for (const byte of hashArray) {
                if (byte === 0) {
                    zeroBits += 8;
                } else {
                    zeroBits += Math.clz32(byte) - 24;
                    break;
                }
                if (zeroBits >= difficultyNum) break;
            }

            if (zeroBits >= difficultyNum) {
                return btoa(JSON.stringify({p: seed, n: nonce, d: difficulty}));
            }
        }

        throw new Error('Failed to solve proof of work — try again');
    }

    private packMessages(messages: ChatMessage[]): Array<{
        id: string;
        author: {role: string};
        content: {content_type: string; parts: string[]};
    }> {
        const systemMsg = messages.find((m) => m.role === 'system');
        const chatMsgs = messages.filter((m) => m.role !== 'system');

        const result: Array<{
            id: string;
            author: {role: string};
            content: {content_type: string; parts: string[]};
        }> = [];

        // System message as system role
        if (systemMsg) {
            result.push({
                id: crypto.randomUUID(),
                author: {role: 'system'},
                content: {content_type: 'text', parts: [systemMsg.content]},
            });
        }

        // Pack history + current into one user message
        let packedContent = '';
        if (chatMsgs.length > 1) {
            const history = chatMsgs.slice(0, -1);
            packedContent = history.map((m) =>
                `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`,
            ).join('\n\n') + '\n\n---\n\n';
        }

        const current = chatMsgs[chatMsgs.length - 1];
        packedContent += current?.content || '';

        result.push({
            id: crypto.randomUUID(),
            author: {role: 'user'},
            content: {content_type: 'text', parts: [packedContent]},
        });

        return result;
    }

    async *chat(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<ProviderEvent> {
        const accessToken = await this.getAccessToken();

        let requirements: {token: string; proofOfWork?: {seed: string; difficulty: string}};
        try {
            requirements = await this.getChatRequirements(accessToken);
        } catch {
            // If chat-requirements fails, try without it
            requirements = {token: ''};
        }

        const headers: Record<string, string> = {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
        };

        if (requirements.token) {
            headers['openai-sentinel-chat-requirements-token'] = requirements.token;
        }

        if (requirements.proofOfWork) {
            try {
                const powToken = await this.solveProofOfWork(
                    requirements.proofOfWork.seed,
                    requirements.proofOfWork.difficulty,
                );
                headers['openai-sentinel-proof-token'] = powToken;
            } catch {
                // Continue without PoW — may fail
            }
        }

        const model = options?.model || this.config.model || 'auto';
        const packedMessages = this.packMessages(messages);

        const response = await fetch('https://chatgpt.com/backend-api/conversation', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                action: 'next',
                messages: packedMessages,
                model,
                parent_message_id: crypto.randomUUID(),
                timezone_offset_min: new Date().getTimezoneOffset(),
            }),
            signal: options?.signal,
        });

        if (response.status === 401 || response.status === 403) {
            this.cachedAccessToken = null;
            throw new Error('ChatGPT session expired — please log in again');
        }
        if (response.status === 429) {
            throw new Error('ChatGPT rate limit reached — try again later');
        }
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`ChatGPT error ${response.status}: ${text}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';
        let lastContent = '';

        try {
            while (true) {
                const {done, value} = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, {stream: true});
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') {
                        yield {type: 'done', stopReason: 'end'};
                        return;
                    }

                    try {
                        const event = JSON.parse(data);
                        const parts = event.message?.content?.parts;
                        if (parts && parts.length > 0 && event.message?.author?.role === 'assistant') {
                            const fullContent = parts.join('');
                            // ChatGPT sends full accumulated content each event — extract delta
                            if (fullContent.length > lastContent.length) {
                                const delta = fullContent.slice(lastContent.length);
                                lastContent = fullContent;
                                yield {type: 'text', text: delta};
                            }
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
        return CHATGPT_WEB_MODELS;
    }
}
