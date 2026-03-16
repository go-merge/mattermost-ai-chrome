export interface UserContext {
    // Auto-populated from Mattermost
    username: string;
    displayName: string;
    position: string;

    // User-provided
    grade: string;
    unit: string;
    responsibility: string;
    additionalContext: string;
}

export interface QuickAction {
    id: string;
    label: string;
    icon: string;
    prompt: string;
    requiresThread: boolean;
    category: 'analysis' | 'drafting' | 'custom';
    isBuiltin: boolean;
}

export const DEFAULT_USER_CONTEXT: UserContext = {
    username: '',
    displayName: '',
    position: '',
    grade: '',
    unit: '',
    responsibility: '',
    additionalContext: '',
};
