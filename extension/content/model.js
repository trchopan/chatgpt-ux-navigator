(() => {
    window.CGPT_NAV = window.CGPT_NAV || {};
    const {C, dom} = window.CGPT_NAV;

    /** @type {Map<string, {id:string, role:'user'|'assistant', preview:string, anchor:Element, codeIds?:string[]}>} */
    const entryById = new Map(); // id -> entry
    /** @type {string[]} */
    const order = []; // ids in DOM order

    // ----------------------------
    // Helpers
    // ----------------------------

    /**
     * Returns the role if node is a ChatGPT role node we care about.
     * @param {Element} roleNode
     * @returns {'user'|'assistant'|null}
     */
    function getRole(roleNode) {
        const r = roleNode?.getAttribute?.('data-message-author-role');
        return r === 'user' || r === 'assistant' ? r : null;
    }

    /**
     * Prefer a stable “content container” for code blocks.
     * @param {Element} roleNode
     * @returns {Element}
     */
    function getMessageContentNode(roleNode) {
        return (
            roleNode.querySelector('.markdown') ||
            roleNode.querySelector('[data-testid="message-text"]') ||
            roleNode
        );
    }

    /**
     * Extract preview text for sidebar.
     * Keeps behavior similar to original:
     * - clamp whitespace
     * - prefer textContent then innerText fallback
     * @param {Element} roleNode
     * @returns {string}
     */
    function getPreviewText(roleNode) {
        const t1 = dom.clampText(roleNode.textContent);
        if (t1) return t1;
        const t2 = dom.clampText(roleNode.innerText);
        if (t2) return t2;
        return '';
    }

    /**
     * Extract code block ids for assistant messages.
     * Ensures each <pre> has CODE_ATTR and returns ids in DOM order.
     * @param {Element} roleNode
     * @param {'user'|'assistant'} role
     * @returns {string[]}
     */
    function getCodeBlockIds(roleNode, role) {
        if (role !== 'assistant') return [];

        const content = getMessageContentNode(roleNode);
        if (!content || !content.querySelectorAll) return [];

        const pres = Array.from(content.querySelectorAll('pre'));
        if (!pres.length) return [];

        const ids = [];
        for (const pre of pres) {
            // ensureAttrId returns the attribute value (after ensuring)
            const id = dom.ensureAttrId(pre, C.CODE_ATTR);
            if (id) ids.push(id);
        }
        return ids;
    }

    /**
     * Build an entry snapshot from a role node.
     * Returns null if node is not usable.
     * @param {Element} roleNode
     * @returns {{id:string, role:'user'|'assistant', preview:string, anchor:Element, codeIds:string[]} | null}
     */
    function extractEntry(roleNode) {
        const role = getRole(roleNode);
        if (!role) return null;

        const preview = getPreviewText(roleNode);
        if (!preview) return null;

        const anchor = dom.getAnchorNode(roleNode);
        if (!anchor || !(anchor instanceof Element)) return null;

        const id = dom.ensureAttrId(anchor, C.ITEM_ATTR);
        if (!id) return null;

        const codeIds = getCodeBlockIds(roleNode, role);

        return {id, role, preview, anchor, codeIds};
    }

    function sameStringArray(a, b) {
        const aa = a || [];
        const bb = b || [];
        if (aa.length !== bb.length) return false;
        for (let i = 0; i < aa.length; i++) {
            if (aa[i] !== bb[i]) return false;
        }
        return true;
    }

    // ----------------------------
    // Public API
    // ----------------------------

    /**
     * Upsert a single role node incrementally.
     * @param {Element} roleNode
     * @returns {{changed:boolean, id:string|null}}
     */
    function upsertFromRoleNode(roleNode) {
        const next = extractEntry(roleNode);
        if (!next) return {changed: false, id: null};

        const existing = entryById.get(next.id);

        if (!existing) {
            entryById.set(next.id, {
                id: next.id,
                role: next.role,
                preview: next.preview,
                anchor: next.anchor,
                codeIds: next.codeIds,
            });
            order.push(next.id);
            return {changed: true, id: next.id};
        }

        // Update in-place
        let changed = false;

        if (existing.role !== next.role) {
            existing.role = next.role;
            changed = true;
        }
        if (existing.preview !== next.preview) {
            existing.preview = next.preview;
            changed = true;
        }
        if (existing.anchor !== next.anchor) {
            existing.anchor = next.anchor;
            changed = true;
        }

        const prevCodes = existing.codeIds || [];
        const nextCodes = next.codeIds || [];
        if (!sameStringArray(prevCodes, nextCodes)) {
            existing.codeIds = nextCodes;
            changed = true;
        }

        return {changed, id: next.id};
    }

    /**
     * Authoritative rescan from DOM.
     * Keeps behavior: first occurrence per anchor id wins; order is DOM order.
     */
    function fullRescan() {
        const roleNodes = dom.findRoleNodes();
        const freshById = new Map();
        const freshIds = [];

        for (const rn of roleNodes) {
            const entry = extractEntry(rn);
            if (!entry) continue;

            // Keep first occurrence only (same as your original logic)
            if (freshById.has(entry.id)) continue;

            freshById.set(entry.id, {
                id: entry.id,
                role: entry.role,
                preview: entry.preview,
                anchor: entry.anchor,
                codeIds: entry.codeIds,
            });
            freshIds.push(entry.id);
        }

        entryById.clear();
        for (const [id, entry] of freshById.entries()) entryById.set(id, entry);

        order.length = 0;
        order.push(...freshIds);
    }

    function getState() {
        return {entryById, order};
    }

    window.CGPT_NAV.model = {
        upsertFromRoleNode,
        fullRescan,
        getState,
    };
})();
