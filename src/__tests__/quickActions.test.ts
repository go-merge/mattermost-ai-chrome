import {describe, it, expect} from 'vitest';
import {
    resolvePromptTemplate,
    buildTemplateVars,
    formatThreadForAI,
    buildSystemMessage,
    BUILTIN_ACTIONS,
    TEMPLATE_VARIABLES,
} from '@/shared/context/quickActions';
import type {UserContext} from '@/shared/context/types';
import type {ThreadContext} from '@/shared/mattermost/types';

describe('resolvePromptTemplate', () => {
    it('replaces all template variables', () => {
        const template = 'Hello {{userName}} (@{{userLogin}}), context: {{userContext}}, thread: {{thread}}';
        const result = resolvePromptTemplate(template, {
            userName: 'John Doe',
            userLogin: 'johnd',
            userContext: 'Engineer, Backend',
            thread: '[10:00] @alice: hello',
        });
        expect(result).toBe('Hello John Doe (@johnd), context: Engineer, Backend, thread: [10:00] @alice: hello');
    });

    it('replaces multiple occurrences of same variable', () => {
        const template = '{{userName}} said hi. {{userName}} also said bye.';
        const result = resolvePromptTemplate(template, {userName: 'Alice'});
        expect(result).toBe('Alice said hi. Alice also said bye.');
    });

    it('leaves unreplaced variables when value not provided', () => {
        const template = '{{thread}} and {{userName}}';
        const result = resolvePromptTemplate(template, {thread: 'some thread'});
        expect(result).toBe('some thread and {{userName}}');
    });

    it('returns template unchanged when no vars provided', () => {
        const template = 'Just a simple prompt';
        const result = resolvePromptTemplate(template, {});
        expect(result).toBe('Just a simple prompt');
    });

    it('handles empty string values (falsy — not replaced)', () => {
        const template = '{{userName}} test';
        const result = resolvePromptTemplate(template, {userName: ''});
        // Empty string is falsy, so the if check skips it
        expect(result).toBe('{{userName}} test');
    });
});

describe('formatThreadForAI', () => {
    it('formats messages with time and author', () => {
        const messages = [
            {author: 'alice', message: 'Hello!', timestamp: new Date('2024-01-15T10:30:00').getTime()},
            {author: 'bob', message: 'Hi there', timestamp: new Date('2024-01-15T10:31:00').getTime()},
        ];
        const result = formatThreadForAI(messages);
        const lines = result.split('\n');
        expect(lines).toHaveLength(2);
        expect(lines[0]).toMatch(/@alice: Hello!/);
        expect(lines[1]).toMatch(/@bob: Hi there/);
        // Check time format [HH:MM]
        expect(lines[0]).toMatch(/^\[\d{2}:\d{2}\s*(AM|PM)?\]/);
    });

    it('handles empty messages array', () => {
        expect(formatThreadForAI([])).toBe('');
    });

    it('handles single message', () => {
        const messages = [{author: 'user1', message: 'solo', timestamp: Date.now()}];
        const result = formatThreadForAI(messages);
        expect(result).toContain('@user1: solo');
        expect(result.split('\n')).toHaveLength(1);
    });
});

describe('buildTemplateVars', () => {
    const baseUserContext: UserContext = {
        username: 'johnd',
        displayName: 'John Doe',
        position: 'Engineer',
        grade: 'Senior',
        unit: 'Backend',
        responsibility: 'API',
        additionalContext: '',
    };

    it('builds all vars when thread is present', () => {
        const thread: ThreadContext = {
            messages: [
                {
                    author: 'alice',
                    authorDisplayName: 'Alice',
                    userId: 'u1',
                    message: 'hello',
                    timestamp: Date.now(),
                    postId: 'p1',
                    isRoot: true,
                },
            ],
            channel: {id: 'ch1', team_id: 't1', name: 'general', display_name: 'General', type: 'O', header: '', purpose: ''},
            rootPostId: 'p1',
            contextType: 'thread',
        };

        const vars = buildTemplateVars(thread, baseUserContext);
        expect(vars.thread).toContain('@alice: hello');
        expect(vars.userName).toBe('John Doe');
        expect(vars.userLogin).toBe('johnd');
        expect(vars.userContext).toContain('Grade: Senior');
        expect(vars.userContext).toContain('Unit: Backend');
        expect(vars.userContext).toContain('Responsibility: API');
    });

    it('returns undefined thread when no thread', () => {
        const vars = buildTemplateVars(null, baseUserContext);
        expect(vars.thread).toBeUndefined();
        expect(vars.userName).toBe('John Doe');
    });

    it('returns "Not specified" userContext when no profile fields', () => {
        const emptyContext: UserContext = {
            username: 'test',
            displayName: 'Test',
            position: '',
            grade: '',
            unit: '',
            responsibility: '',
            additionalContext: '',
        };
        const vars = buildTemplateVars(null, emptyContext);
        expect(vars.userContext).toBe('Not specified');
    });

    it('uses username as fallback for displayName', () => {
        const ctx: UserContext = {
            ...baseUserContext,
            displayName: '',
            username: 'fallback_user',
        };
        const vars = buildTemplateVars(null, ctx);
        expect(vars.userName).toBe('fallback_user');
    });
});

describe('buildSystemMessage', () => {
    it('includes all user profile fields', () => {
        const msg = buildSystemMessage({
            displayName: 'John',
            username: 'johnd',
            position: 'CTO',
            grade: 'C-level',
            unit: 'Engineering',
            responsibility: 'Architecture',
            additionalContext: 'Likes coffee',
        });
        expect(msg).toContain('John (@johnd)');
        expect(msg).toContain('Position: CTO');
        expect(msg).toContain('Grade/Level: C-level');
        expect(msg).toContain('Unit: Engineering');
        expect(msg).toContain('Area of Responsibility: Architecture');
        expect(msg).toContain('Additional Context: Likes coffee');
        expect(msg).toContain('AI assistant');
    });

    it('omits empty fields', () => {
        const msg = buildSystemMessage({
            displayName: 'Jane',
            username: 'jane',
            position: '',
            grade: '',
            unit: '',
            responsibility: '',
            additionalContext: '',
        });
        expect(msg).toContain('Jane (@jane)');
        expect(msg).not.toContain('Position:');
        expect(msg).not.toContain('Grade/Level:');
        expect(msg).not.toContain('Unit:');
    });
});

describe('BUILTIN_ACTIONS', () => {
    it('has 4 builtin actions', () => {
        expect(BUILTIN_ACTIONS).toHaveLength(4);
    });

    it('all require thread', () => {
        for (const action of BUILTIN_ACTIONS) {
            expect(action.requiresThread).toBe(true);
            expect(action.isBuiltin).toBe(true);
        }
    });

    it('all use {{thread}} variable', () => {
        for (const action of BUILTIN_ACTIONS) {
            expect(action.prompt).toContain('{{thread}}');
        }
    });

    it('has unique ids', () => {
        const ids = BUILTIN_ACTIONS.map((a) => a.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('TEMPLATE_VARIABLES', () => {
    it('has 4 variables', () => {
        expect(TEMPLATE_VARIABLES).toHaveLength(4);
    });

    it('thread variable requires thread', () => {
        const threadVar = TEMPLATE_VARIABLES.find((v) => v.key === 'thread');
        expect(threadVar?.requiresThread).toBe(true);
    });

    it('user variables do not require thread', () => {
        const userVars = TEMPLATE_VARIABLES.filter((v) => v.key !== 'thread');
        for (const v of userVars) {
            expect(v.requiresThread).toBe(false);
        }
    });
});
