// Message types for Chrome extension runtime messaging

export interface SessionData {
    serverUrl: string;
    token: string;
    csrfToken: string;
}

export type ExtensionMessage =
    | {type: 'GET_SESSION'}
    | {type: 'SESSION_RESULT'; data: SessionData | null}
    | {type: 'SEND_THREAD'; postId: string}
    | {type: 'SEND_RANGE'; startPostId: string; endPostId: string}
    | {type: 'TAB_CHANGED'; url: string}
    | {type: 'OPEN_SIDE_PANEL'};
