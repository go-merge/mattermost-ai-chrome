// Content script for Mattermost pages
// 1. Injects "AI" button into post action bars
// 2. Responds to context menu clicks with nearest post ID
// 3. Watches for permalink navigation

// Track last right-clicked element for context menu
let lastRightClickedElement: Element | null = null;

document.addEventListener('contextmenu', (e) => {
    lastRightClickedElement = e.target as Element;
}, true);

// ---- Mattermost detection ----

function isMattermostPage(): boolean {
    const root = document.getElementById('root');
    if (!root) return false;

    return !!(
        document.querySelector('.post-list__content') ||
        document.querySelector('#channel_view') ||
        document.querySelector('[data-testid="postView"]') ||
        document.querySelector('.GlobalHeader') ||
        document.querySelector('#post-list') ||
        document.querySelector('.post__body')
    );
}

// ---- Post ID extraction ----

function extractPostId(el: Element): string | null {
    // Check the element and ancestors for post IDs
    // Mattermost uses: post_<id>, rhsPost_<id>, RHS_COMMENT_*_<id>, CENTER_*_<id>
    const post = el.closest('[id^="post_"], [id^="rhsPost_"], [role="listitem"].post');
    if (post) {
        const match = post.id.match(/(?:post_|rhsPost_)([a-z0-9]{26})/i);
        if (match) return match[1];
    }

    // Check data-testid (e.g. PostDotMenu-Button-abc123)
    const testEl = el.closest('[data-testid*="-"]');
    if (testEl) {
        const testId = testEl.getAttribute('data-testid') || '';
        const match = testId.match(/([a-z0-9]{26})/i);
        if (match) return match[1];
    }

    // Check permalink href (/team/pl/postid)
    const link = el.closest('a[href*="/pl/"]');
    if (link) {
        const href = link.getAttribute('href') || '';
        const match = href.match(/\/pl\/([a-z0-9]{26})/i);
        if (match) return match[1];
    }

    return null;
}

function findNearestPostId(el: Element | null): string | null {
    if (!el) return null;

    const direct = extractPostId(el);
    if (direct) return direct;

    // Walk up searching for any element inside a post container
    let current: Element | null = el;
    while (current) {
        // Look for sibling or parent with post-like id
        if (current.id) {
            const match = current.id.match(/([a-z0-9]{26})/i);
            if (match) return match[1];
        }
        current = current.parentElement;
    }

    return null;
}

// ---- Range selection state ----

let rangeFirstPostId: string | null = null;
let rangeFirstElement: Element | null = null;
let rangeFirstBtn: HTMLButtonElement | null = null;

function clearRangeSelection() {
    rangeFirstElement?.classList.remove('mm-ai-ext-range-start');
    if (rangeFirstBtn) {
        rangeFirstBtn.innerHTML = '<span style="font-size:11px;font-weight:600;">AI</span>';
    }
    rangeFirstPostId = null;
    rangeFirstElement = null;
    rangeFirstBtn = null;
}

// ---- AI Button injection ----

function sendToAI(postId: string, btn: HTMLButtonElement, isShiftClick: boolean) {
    if (isShiftClick && rangeFirstPostId) {
        // Second shift+click → send range
        chrome.runtime.sendMessage({
            type: 'SEND_RANGE',
            startPostId: rangeFirstPostId,
            endPostId: postId,
        });
        clearRangeSelection();
        const original = btn.innerHTML;
        btn.innerHTML = '<span style="font-size:11px;font-weight:600;">✓</span>';
        btn.classList.add('mm-ai-ext-btn--sent');
        setTimeout(() => {
            btn.innerHTML = original;
            btn.classList.remove('mm-ai-ext-btn--sent');
        }, 1500);
    } else if (isShiftClick) {
        // First shift+click → mark as range start
        rangeFirstPostId = postId;
        rangeFirstElement = btn.closest('[id^="post_"], [id^="rhsPost_"], [role="listitem"].post');
        rangeFirstElement?.classList.add('mm-ai-ext-range-start');
        rangeFirstBtn = btn;
        btn.innerHTML = '<span style="font-size:11px;font-weight:600;">1⃣</span>';
    } else {
        // Normal click → send single thread
        clearRangeSelection();
        chrome.runtime.sendMessage({type: 'SEND_THREAD', postId});
        const original = btn.innerHTML;
        btn.innerHTML = '<span style="font-size:11px;font-weight:600;">✓</span>';
        btn.classList.add('mm-ai-ext-btn--sent');
        setTimeout(() => {
            btn.innerHTML = original;
            btn.classList.remove('mm-ai-ext-btn--sent');
        }, 1500);
    }
}

function injectAIButton(postElement: Element) {
    if (postElement.querySelector('.mm-ai-ext-btn')) return;

    const postId = extractPostId(postElement);
    if (!postId) return;

    // Target: div.post-menu (contains emoji, actions, dot-menu buttons)
    const actionsContainer =
        postElement.querySelector('div.post-menu') ||
        postElement.querySelector('.col.post-menu') ||
        postElement.querySelector('.col__controls');

    if (!actionsContainer) return;

    const btn = document.createElement('button');
    btn.className = 'mm-ai-ext-btn post-menu__item';
    btn.title = 'Send to AI Assistant';
    btn.innerHTML = '<span style="font-size:11px;font-weight:600;">AI</span>';
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        sendToAI(postId, btn, e.shiftKey);
    });

    // Insert before the dot-menu button (the "..." at the end)
    const dotMenu = actionsContainer.querySelector('[data-testid^="PostDotMenu-Button"]');
    if (dotMenu) {
        actionsContainer.insertBefore(btn, dotMenu);
    } else {
        actionsContainer.appendChild(btn);
    }
}

function observePosts() {
    const selector = '[id^="post_"], [id^="rhsPost_"], [role="listitem"].post';

    document.querySelectorAll(selector).forEach(injectAIButton);

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (!(node instanceof HTMLElement)) continue;

                if (node.id?.startsWith('post_') || node.id?.startsWith('rhsPost_')) {
                    injectAIButton(node);
                }

                node.querySelectorAll?.(selector).forEach(injectAIButton);
            }
        }
    });

    observer.observe(document.body, {childList: true, subtree: true});
}

// ---- Context menu support ----

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'GET_CLICKED_POST') {
        const postId = findNearestPostId(lastRightClickedElement);
        sendResponse({postId: postId || null});
    }
    return false;
});

// ---- Permalink watching ----

function watchPermalinks() {
    let lastUrl = location.href;

    const observer = new MutationObserver(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            const match = location.pathname.match(/\/[^/]+\/pl\/([a-z0-9]{26})/i);
            if (match) {
                chrome.runtime.sendMessage({type: 'SEND_THREAD', postId: match[1]});
            }
        }
    });

    observer.observe(document.body, {childList: true, subtree: true});
}

// ---- Init ----

function init() {
    if (!isMattermostPage()) {
        setTimeout(() => {
            if (isMattermostPage()) {
                observePosts();
                watchPermalinks();
            }
        }, 3000);
        return;
    }

    observePosts();
    watchPermalinks();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
