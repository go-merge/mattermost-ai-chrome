import type {Post, PostList, UserProfile, Channel, Team, ThreadContext, ThreadMessage} from './types';

export class MattermostClient {
    private serverUrl: string;
    private token: string;
    private csrfToken: string;
    private userCache: Map<string, UserProfile> = new Map();

    constructor(serverUrl: string, token: string, csrfToken: string = '') {
        this.serverUrl = serverUrl.replace(/\/+$/, '');
        this.token = token;
        this.csrfToken = csrfToken;
    }

    private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
        const headers: Record<string, string> = {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json',
            ...(this.csrfToken ? {'X-CSRF-Token': this.csrfToken} : {}),
            ...(options.headers as Record<string, string> || {}),
        };

        const response = await fetch(`${this.serverUrl}/api/v4${path}`, {
            ...options,
            headers,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Mattermost API error ${response.status}: ${errorText}`);
        }

        return response.json() as Promise<T>;
    }

    async getMe(): Promise<UserProfile> {
        return this.request<UserProfile>('/users/me');
    }

    async getUser(userId: string): Promise<UserProfile> {
        const cached = this.userCache.get(userId);
        if (cached) return cached;

        const user = await this.request<UserProfile>(`/users/${userId}`);
        this.userCache.set(userId, user);
        return user;
    }

    async getUsersByIds(userIds: string[]): Promise<UserProfile[]> {
        const uncached = userIds.filter((id) => !this.userCache.has(id));

        if (uncached.length > 0) {
            const users = await this.request<UserProfile[]>('/users/ids', {
                method: 'POST',
                body: JSON.stringify(uncached),
            });
            for (const user of users) {
                this.userCache.set(user.id, user);
            }
        }

        return userIds.map((id) => this.userCache.get(id)!).filter(Boolean);
    }

    async getPost(postId: string): Promise<Post> {
        return this.request<Post>(`/posts/${postId}`);
    }

    async getPostThread(postId: string): Promise<PostList> {
        return this.request<PostList>(`/posts/${postId}/thread`);
    }

    async getChannel(channelId: string): Promise<Channel> {
        return this.request<Channel>(`/channels/${channelId}`);
    }

    async getTeam(teamId: string): Promise<Team> {
        return this.request<Team>(`/teams/${teamId}`);
    }

    async getChannelPosts(channelId: string, options?: {
        before?: string;
        after?: string;
        perPage?: number;
    }): Promise<PostList> {
        const params = new URLSearchParams();
        if (options?.before) params.set('before', options.before);
        if (options?.after) params.set('after', options.after);
        params.set('per_page', String(options?.perPage || 30));
        return this.request<PostList>(`/channels/${channelId}/posts?${params}`);
    }

    private async buildThreadContext(
        postList: PostList,
        channelId: string,
        rootPostId: string,
        contextType: 'thread' | 'channel' | 'range',
    ): Promise<ThreadContext> {
        const userIds = [...new Set(Object.values(postList.posts).map((p) => p.user_id))];
        await this.getUsersByIds(userIds);

        const messages: ThreadMessage[] = postList.order
            .filter((id) => postList.posts[id])
            .map((id) => {
                const post = postList.posts[id];
                const user = this.userCache.get(post.user_id);
                const displayName = user
                    ? `${user.first_name} ${user.last_name}`.trim() || user.username
                    : post.user_id;
                return {
                    author: user?.username || post.user_id,
                    authorDisplayName: displayName,
                    userId: post.user_id,
                    message: post.message,
                    timestamp: post.create_at,
                    postId: post.id,
                    isRoot: post.root_id === '',
                };
            });

        messages.sort((a, b) => a.timestamp - b.timestamp);

        const channel = await this.getChannel(channelId);

        return {messages, channel, rootPostId, contextType};
    }

    async loadThread(postId: string): Promise<ThreadContext> {
        const threadData = await this.getPostThread(postId);

        // Single message — just show it, no channel context
        if (threadData.order.length <= 1) {
            const post = threadData.posts[postId] || Object.values(threadData.posts)[0];
            const channelId = post?.channel_id || '';
            return this.buildThreadContext(threadData, channelId, postId, 'thread');
        }

        const rootPost = Object.values(threadData.posts).find((p) => p.root_id === '');
        const rootPostId = rootPost?.id || postId;
        const channelId = Object.values(threadData.posts)[0]?.channel_id || '';

        return this.buildThreadContext(threadData, channelId, rootPostId, 'thread');
    }

    async loadChannelContext(postId: string, count = 30): Promise<ThreadContext> {
        const post = await this.getPost(postId);
        const channelPosts = await this.getChannelPosts(post.channel_id, {
            before: postId,
            perPage: count - 1,
        });

        // Include the clicked post itself
        channelPosts.posts[postId] = post;
        if (!channelPosts.order.includes(postId)) {
            channelPosts.order.push(postId);
        }

        return this.buildThreadContext(channelPosts, post.channel_id, postId, 'channel');
    }

    async loadPostRange(startPostId: string, endPostId: string): Promise<ThreadContext> {
        const [startPost, endPost] = await Promise.all([
            this.getPost(startPostId),
            this.getPost(endPostId),
        ]);

        const [older, newer] = startPost.create_at <= endPost.create_at
            ? [startPost, endPost]
            : [endPost, startPost];

        const channelPosts = await this.getChannelPosts(older.channel_id, {
            after: older.id,
            perPage: 200,
        });

        // Include both boundary posts
        channelPosts.posts[older.id] = older;
        channelPosts.posts[newer.id] = newer;

        // Filter to only posts within the range
        const allIds = new Set([older.id, newer.id, ...channelPosts.order]);
        const filteredOrder = [...allIds].filter((id) => {
            const p = channelPosts.posts[id];
            return p && p.create_at >= older.create_at && p.create_at <= newer.create_at;
        });
        channelPosts.order = filteredOrder;

        return this.buildThreadContext(channelPosts, older.channel_id, older.id, 'range');
    }

    /**
     * Parse a Mattermost permalink URL into its components.
     * Format: https://server/team/pl/postId
     */
    static parsePermalink(url: string): {serverUrl: string; postId: string} | null {
        const match = url.match(/^(https?:\/\/[^/]+)\/[^/]+\/pl\/([a-z0-9]+)$/i);
        if (match) {
            return {serverUrl: match[1], postId: match[2]};
        }
        // Also handle direct post ID (26 char alphanumeric)
        if (/^[a-z0-9]{26}$/i.test(url)) {
            return {serverUrl: '', postId: url};
        }
        return null;
    }
}
