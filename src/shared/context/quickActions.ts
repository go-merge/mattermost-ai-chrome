import type {QuickAction, UserContext} from './types';
import type {ThreadContext} from '@/shared/mattermost/types';

export interface TemplateVariable {
    key: string;
    label: string;
    description: string;
    icon: string;
    requiresThread: boolean;
}

export const TEMPLATE_VARIABLES: TemplateVariable[] = [
    {key: 'thread', label: 'Thread', description: 'Loaded thread content', icon: '💬', requiresThread: true},
    {key: 'userName', label: 'Name', description: 'Your display name', icon: '👤', requiresThread: false},
    {key: 'userLogin', label: 'Login', description: 'Your @username', icon: '@', requiresThread: false},
    {key: 'userContext', label: 'Context', description: 'Role / grade / unit', icon: '📋', requiresThread: false},
];

export const BUILTIN_ACTIONS: QuickAction[] = [
    {
        id: 'summarize',
        label: 'Саммари треда',
        icon: '📝',
        prompt: `Summarize the following Mattermost thread concisely in the same language the thread is written in.
Highlight:
- Key discussion points and decisions made
- Action items and deadlines mentioned
- Important updates or announcements

Thread:
{{thread}}

User context: {{userContext}}`,
        requiresThread: true,
        category: 'analysis',
        isBuiltin: true,
    },
    {
        id: 'my-tasks',
        label: 'Что от меня требуется?',
        icon: '👤',
        prompt: `Analyze this thread and identify what actions, responses, or deliverables are expected specifically from me.
Consider my role and responsibilities when determining relevance.
Respond in the same language the thread is written in.

My identity: {{userName}} (@{{userLogin}})
My role: {{userContext}}

Thread:
{{thread}}

List each task/request clearly, noting who asked and any deadlines mentioned.`,
        requiresThread: true,
        category: 'analysis',
        isBuiltin: true,
    },
    {
        id: 'draft-reply',
        label: 'Черновик ответа',
        icon: '✏️',
        prompt: `Based on this thread and my role, draft an appropriate response I could post.
Match the tone and formality of the conversation.
Write in the same language the thread is written in.

My identity: {{userName}} (@{{userLogin}})
My role: {{userContext}}

Thread:
{{thread}}

Write a concise, professional response.`,
        requiresThread: true,
        category: 'drafting',
        isBuiltin: true,
    },
    {
        id: 'explain',
        label: 'Объясни контекст',
        icon: '💡',
        prompt: `Explain the context and background of this thread to someone who just joined.
What is being discussed? What decisions have been made? What's the current status?
Respond in the same language the thread is written in.

Thread:
{{thread}}`,
        requiresThread: true,
        category: 'analysis',
        isBuiltin: true,
    },
];

export function resolvePromptTemplate(
    template: string,
    vars: {
        thread?: string;
        userName?: string;
        userLogin?: string;
        userContext?: string;
    },
): string {
    let result = template;
    if (vars.thread) result = result.replace(/\{\{thread\}\}/g, vars.thread);
    if (vars.userName) result = result.replace(/\{\{userName\}\}/g, vars.userName);
    if (vars.userLogin) result = result.replace(/\{\{userLogin\}\}/g, vars.userLogin);
    if (vars.userContext) result = result.replace(/\{\{userContext\}\}/g, vars.userContext);
    return result;
}

export function buildTemplateVars(
    thread: ThreadContext | null,
    userContext: UserContext,
): {thread?: string; userName?: string; userLogin?: string; userContext?: string} {
    const threadText = thread ? formatThreadForAI(thread.messages) : undefined;
    const userContextStr = [
        userContext.grade && `Grade: ${userContext.grade}`,
        userContext.unit && `Unit: ${userContext.unit}`,
        userContext.responsibility && `Responsibility: ${userContext.responsibility}`,
    ].filter(Boolean).join(', ') || undefined;

    return {
        thread: threadText,
        userName: userContext.displayName || userContext.username || undefined,
        userLogin: userContext.username || undefined,
        userContext: userContextStr ?? 'Not specified',
    };
}

export function formatThreadForAI(messages: Array<{author: string; message: string; timestamp: number}>): string {
    return messages
        .map((m) => {
            const time = new Date(m.timestamp).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
            });
            return `[${time}] @${m.author}: ${m.message}`;
        })
        .join('\n');
}

export function buildSystemMessage(userContext: {
    displayName: string;
    username: string;
    position: string;
    grade: string;
    unit: string;
    responsibility: string;
    additionalContext: string;
}): string {
    const parts = [
        'You are an AI assistant helping a Mattermost user understand and respond to team conversations.',
        '',
        'About the user you are assisting:',
        `- Name: ${userContext.displayName} (@${userContext.username})`,
    ];

    if (userContext.position) parts.push(`- Position: ${userContext.position}`);
    if (userContext.grade) parts.push(`- Grade/Level: ${userContext.grade}`);
    if (userContext.unit) parts.push(`- Unit: ${userContext.unit}`);
    if (userContext.responsibility) parts.push(`- Area of Responsibility: ${userContext.responsibility}`);
    if (userContext.additionalContext) parts.push(`- Additional Context: ${userContext.additionalContext}`);

    parts.push(
        '',
        'Guidelines:',
        '- When analyzing threads, consider the user\'s role and responsibilities',
        '- Flag items specifically relevant to the user\'s area',
        '- Respond in the same language as the conversation',
        '- Be concise but thorough',
        '- When drafting responses, match the formality level of the thread',
    );

    return parts.join('\n');
}
