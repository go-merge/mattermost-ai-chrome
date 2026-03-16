import {describe, it, expect, vi, beforeEach} from 'vitest';
import {MattermostClient} from '@/shared/mattermost/client';
import type {Post, PostList, UserProfile, Channel} from '@/shared/mattermost/types';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(data: unknown, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => data,
        text: async () => JSON.stringify(data),
    };
}

function makePost(overrides: Partial<Post> = {}): Post {
    return {
        id: 'post1',
        create_at: 1700000000000,
        update_at: 1700000000000,
        delete_at: 0,
        user_id: 'user1',
        channel_id: 'ch1',
        root_id: '',
        message: 'Hello',
        type: '',
        props: {},
        reply_count: 0,
        ...overrides,
    };
}

function makeUser(overrides: Partial<UserProfile> = {}): UserProfile {
    return {
        id: 'user1',
        username: 'alice',
        email: 'alice@test.com',
        first_name: 'Alice',
        last_name: 'Smith',
        nickname: '',
        position: 'Dev',
        roles: 'system_user',
        locale: 'en',
        ...overrides,
    };
}

function makeChannel(overrides: Partial<Channel> = {}): Channel {
    return {
        id: 'ch1',
        team_id: 't1',
        name: 'general',
        display_name: 'General',
        type: 'O',
        header: '',
        purpose: '',
        ...overrides,
    };
}

describe('MattermostClient', () => {
    let client: MattermostClient;

    beforeEach(() => {
        mockFetch.mockReset();
        client = new MattermostClient('https://mm.example.com', 'test-token', 'csrf-token');
    });

    describe('constructor', () => {
        it('strips trailing slashes from serverUrl', () => {
            const c = new MattermostClient('https://mm.example.com///', 'tok');
            // Verify by making a request
            mockFetch.mockResolvedValueOnce(jsonResponse({id: 'me'}));
            c.getMe();
            expect(mockFetch).toHaveBeenCalledWith(
                'https://mm.example.com/api/v4/users/me',
                expect.any(Object),
            );
        });
    });

    describe('request headers', () => {
        it('sends Authorization and CSRF headers', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({id: 'me'}));
            await client.getMe();
            const [, options] = mockFetch.mock.calls[0];
            expect(options.headers['Authorization']).toBe('Bearer test-token');
            expect(options.headers['X-CSRF-Token']).toBe('csrf-token');
            expect(options.headers['Content-Type']).toBe('application/json');
        });

        it('omits CSRF when not provided', async () => {
            const c = new MattermostClient('https://mm.example.com', 'tok');
            mockFetch.mockResolvedValueOnce(jsonResponse({id: 'me'}));
            await c.getMe();
            const [, options] = mockFetch.mock.calls[0];
            expect(options.headers['X-CSRF-Token']).toBeUndefined();
        });
    });

    describe('error handling', () => {
        it('throws on non-ok response', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({message: 'Not found'}, 404));
            await expect(client.getPost('bad-id')).rejects.toThrow('Mattermost API error 404');
        });
    });

    describe('user caching', () => {
        it('caches user after first fetch', async () => {
            mockFetch
                .mockResolvedValueOnce(jsonResponse(makeUser()))
                .mockResolvedValueOnce(jsonResponse(makeUser()));

            const user1 = await client.getUser('user1');
            const user2 = await client.getUser('user1');

            expect(user1.username).toBe('alice');
            expect(user2.username).toBe('alice');
            // Only one fetch call — second is from cache
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it('getUsersByIds only fetches uncached users', async () => {
            // Pre-cache user1
            mockFetch.mockResolvedValueOnce(jsonResponse(makeUser({id: 'user1'})));
            await client.getUser('user1');

            // Now request user1 + user2
            mockFetch.mockResolvedValueOnce(jsonResponse([makeUser({id: 'user2', username: 'bob'})]));
            const users = await client.getUsersByIds(['user1', 'user2']);

            expect(users).toHaveLength(2);
            // Second call should only POST for user2
            const [, options] = mockFetch.mock.calls[1];
            expect(JSON.parse(options.body)).toEqual(['user2']);
        });
    });

    describe('loadThread', () => {
        it('builds thread context from post thread', async () => {
            const post1 = makePost({id: 'p1', root_id: '', user_id: 'u1', message: 'Root', create_at: 1000});
            const post2 = makePost({id: 'p2', root_id: 'p1', user_id: 'u2', message: 'Reply', create_at: 2000});

            const postList: PostList = {
                order: ['p1', 'p2'],
                posts: {p1: post1, p2: post2},
            };

            mockFetch
                .mockResolvedValueOnce(jsonResponse(postList)) // getPostThread
                .mockResolvedValueOnce(jsonResponse([makeUser({id: 'u1', username: 'alice'}), makeUser({id: 'u2', username: 'bob'})])) // getUsersByIds
                .mockResolvedValueOnce(jsonResponse(makeChannel())); // getChannel

            const ctx = await client.loadThread('p1');

            expect(ctx.contextType).toBe('thread');
            expect(ctx.messages).toHaveLength(2);
            expect(ctx.messages[0].message).toBe('Root');
            expect(ctx.messages[1].message).toBe('Reply');
            // Sorted by timestamp
            expect(ctx.messages[0].timestamp).toBeLessThan(ctx.messages[1].timestamp);
        });
    });
});

describe('MattermostClient.parsePermalink', () => {
    it('parses standard permalink', () => {
        const result = MattermostClient.parsePermalink('https://mm.example.com/myteam/pl/abc123def456ghij7890klmnop');
        expect(result).toEqual({
            serverUrl: 'https://mm.example.com',
            postId: 'abc123def456ghij7890klmnop',
        });
    });

    it('parses http permalink', () => {
        const result = MattermostClient.parsePermalink('http://localhost:8065/team/pl/abcdef1234567890abcdef1234');
        expect(result).toEqual({
            serverUrl: 'http://localhost:8065',
            postId: 'abcdef1234567890abcdef1234',
        });
    });

    it('handles direct 26-char post ID', () => {
        const result = MattermostClient.parsePermalink('abcdef1234567890abcdef1234');
        expect(result).toEqual({
            serverUrl: '',
            postId: 'abcdef1234567890abcdef1234',
        });
    });

    it('returns null for invalid URL', () => {
        expect(MattermostClient.parsePermalink('not-a-url')).toBeNull();
        expect(MattermostClient.parsePermalink('https://example.com/some/page')).toBeNull();
        expect(MattermostClient.parsePermalink('')).toBeNull();
    });

    it('returns null for too short post ID', () => {
        expect(MattermostClient.parsePermalink('abc123')).toBeNull();
    });

    it('handles permalink with port number', () => {
        const result = MattermostClient.parsePermalink('https://mm.local:8443/dev/pl/abcdef1234567890abcdef1234');
        expect(result).toEqual({
            serverUrl: 'https://mm.local:8443',
            postId: 'abcdef1234567890abcdef1234',
        });
    });
});
