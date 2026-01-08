(() => {
    window.CGPT_NAV = window.CGPT_NAV || {};
    const {C, messaging} = window.CGPT_NAV;

    let promptListCache = null;
    let promptListCacheAt = 0;

    async function fetchPromptList() {
        const resp = await messaging.sendMessage({type: C.MSG.FETCH_LIST});
        if (!resp?.ok) throw new Error(resp?.error || 'Failed to fetch prompt list');
        return resp.prompts || [];
    }

    async function fetchPromptByFilename(filename) {
        const resp = await messaging.sendMessage({type: C.MSG.FETCH_PROMPT, filename});
        if (!resp?.ok) throw new Error(resp?.error || 'Failed to fetch prompt');
        return resp.text || '';
    }

    async function ensurePromptListLoaded(force = false) {
        const now = Date.now();
        const fresh = promptListCache && now - promptListCacheAt < C.PROMPT_LIST_TTL_MS;
        if (!force && fresh) return promptListCache;

        const prompts = await fetchPromptList();
        prompts.sort((a, b) => a.localeCompare(b));
        promptListCache = prompts;
        promptListCacheAt = now;
        return prompts;
    }

    window.CGPT_NAV.prompts = {
        fetchPromptByFilename,
        ensurePromptListLoaded,
    };
})();
