(() => {
    window.CGPT_NAV = window.CGPT_NAV || {};
    const {C, messaging} = window.CGPT_NAV;

    /** @type {string[]|null} */
    let promptListCache = null;
    let promptListCacheAt = 0;

    function nowMs() {
        return Date.now();
    }

    function isFresh(atMs) {
        return nowMs() - atMs < C.PROMPT_LIST_TTL_MS;
    }

    /**
     * Send a background message and normalize error handling.
     * @param {any} message
     * @returns {Promise<any>}
     */
    async function send(message) {
        const resp = await messaging.sendMessage(message);
        if (!resp?.ok) {
            const err = resp?.error || 'Request failed';
            throw new Error(err);
        }
        return resp;
    }

    /**
     * Fetch list of prompt filenames from server.
     * Keeps original UX: alert on failure and return [].
     * @returns {Promise<string[]>}
     */
    async function fetchPromptList() {
        try {
            const resp = await send({type: C.MSG.FETCH_LIST});
            const prompts = Array.isArray(resp?.prompts) ? resp.prompts : [];
            return prompts;
        } catch (e) {
            console.warn(e?.message || e);
            alert('Failed to fetch prompt list. Please try again.');
            return [];
        }
    }

    /**
     * Fetch a thread file and return structured messages.
     * @param {string} filename
     * @returns {Promise<{ role: 'user'|'assistant', content: string }[]>}
     */
    async function fetchThreadByFilename(filename) {
        if (!filename || typeof filename !== 'string') {
            throw new Error('Missing filename');
        }

        const resp = await send({
            type: C.MSG.FETCH_PROMPT,
            filename,
        });

        const msgs = resp?.threadMessages;
        if (!Array.isArray(msgs)) throw new Error('Invalid threadMessages payload');

        // Optional light normalization: ensure shape
        return msgs
            .filter(m => m && (m.role === 'user' || m.role === 'assistant'))
            .map(m => ({role: m.role, content: String(m.content ?? '')}));
    }

    /**
     * Save assistant response markdown back to server.
     * @param {string} filename
     * @param {string} response
     */
    async function saveAssistantResponse(filename, response) {
        if (!filename || typeof filename !== 'string') {
            throw new Error('Missing filename');
        }
        if (typeof response !== 'string') {
            throw new Error('Missing response');
        }

        await send({
            type: C.MSG.SAVE_RESPONSE,
            filename,
            response,
        });
    }

    /**
     * Ensure prompt list is loaded (with TTL cache).
     * @param {boolean} force
     * @returns {Promise<string[]>}
     */
    async function ensurePromptListLoaded(force = false) {
        if (!force && promptListCache && isFresh(promptListCacheAt)) {
            return promptListCache;
        }

        const prompts = await fetchPromptList();
        prompts.sort((a, b) => a.localeCompare(b));

        promptListCache = prompts;
        promptListCacheAt = nowMs();

        return prompts;
    }

    window.CGPT_NAV.prompts = {
        fetchThreadByFilename,
        ensurePromptListLoaded,
        saveAssistantResponse,
    };
})();
