export interface Post {
    id: string;
    create_at: number;
    update_at: number;
    delete_at: number;
    user_id: string;
    channel_id: string;
    root_id: string;
    message: string;
    type: string;
    props: Record<string, unknown>;
    reply_count: number;
    metadata?: PostMetadata;
}

export interface PostMetadata {
    files?: FileInfo[];
    reactions?: Reaction[];
}

export interface FileInfo {
    id: string;
    name: string;
    extension: string;
    size: number;
    mime_type: string;
}

export interface Reaction {
    user_id: string;
    post_id: string;
    emoji_name: string;
}

export interface PostList {
    order: string[];
    posts: Record<string, Post>;
}

export interface UserProfile {
    id: string;
    username: string;
    email: string;
    first_name: string;
    last_name: string;
    nickname: string;
    position: string;
    roles: string;
    locale: string;
    timezone?: Record<string, string>;
    props?: Record<string, string>;
}

export interface Channel {
    id: string;
    team_id: string;
    name: string;
    display_name: string;
    type: string;
    header: string;
    purpose: string;
}

export interface Team {
    id: string;
    name: string;
    display_name: string;
}

export interface ThreadMessage {
    author: string;
    authorDisplayName: string;
    userId: string;
    message: string;
    timestamp: number;
    postId: string;
    isRoot: boolean;
}

export interface ThreadContext {
    messages: ThreadMessage[];
    channel: Channel;
    rootPostId: string;
    contextType?: 'thread' | 'channel' | 'range';
}
