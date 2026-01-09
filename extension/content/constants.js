(() => {
    window.CGPT_NAV = window.CGPT_NAV || {};

    const C = {
        EXT_ID: 'cgpt-nav',
        SHOW_ID: 'cgpt-nav-show',
        PROMPT_MENU_ID: 'cgpt-nav-prompt-menu',

        ITEM_ATTR: 'data-cgpt-nav-id',
        CODE_ATTR: 'data-cgpt-nav-code-id',

        STORAGE_KEY_HIDDEN: 'cgpt_nav_hidden',

        ROLE_SEL: '[data-message-author-role="user"], [data-message-author-role="assistant"]',
        TURN_SEL: '[data-testid="conversation-turn"]',

        MSG: {
            FETCH_LIST: 'cgpt-nav-fetch-list',
            FETCH_PROMPT: 'cgpt-nav-fetch-prompt',
            SAVE_RESPONSE: 'cgpt-nav-save-response',
        },

        PROMPT_LIST_TTL_MS: 10_000,
    };

    window.CGPT_NAV.C = C;
})();
