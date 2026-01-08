(() => {
    window.CGPT_NAV = window.CGPT_NAV || {};
    const {C, dom} = window.CGPT_NAV;

    const entryById = new Map(); // id -> entry
    const order = []; // ids

    function getMessageContentNode(roleNode) {
        return (
            roleNode.querySelector('.markdown') ||
            roleNode.querySelector('[data-testid="message-text"]') ||
            roleNode
        );
    }

    function getCodeBlockIds(roleNode) {
        const role = roleNode.getAttribute('data-message-author-role');
        if (role !== 'assistant') return [];

        const content = getMessageContentNode(roleNode);
        if (!content || !content.querySelectorAll) return [];

        const pres = Array.from(content.querySelectorAll('pre'));
        return pres.map(pre => dom.ensureAttrId(pre, C.CODE_ATTR));
    }

    function getPreviewText(roleNode) {
        const t1 = dom.clampText(roleNode.textContent);
        if (t1) return t1;
        const t2 = dom.clampText(roleNode.innerText);
        if (t2) return t2;
        return '';
    }

    function upsertFromRoleNode(roleNode) {
        const role = roleNode.getAttribute('data-message-author-role');
        if (role !== 'user' && role !== 'assistant') return {changed: false, id: null};

        const preview = getPreviewText(roleNode);
        if (!preview) return {changed: false, id: null};

        const anchor = dom.getAnchorNode(roleNode);
        const id = dom.ensureAttrId(anchor, C.ITEM_ATTR);
        const codeIds = getCodeBlockIds(roleNode);

        const existing = entryById.get(id);
        if (!existing) {
            const entry = {id, role, preview, anchor, codeIds};
            entryById.set(id, entry);
            order.push(id);
            return {changed: true, id};
        }

        let changed = false;
        if (existing.role !== role) {
            existing.role = role;
            changed = true;
        }
        if (existing.preview !== preview) {
            existing.preview = preview;
            changed = true;
        }
        if (existing.anchor !== anchor) {
            existing.anchor = anchor;
            changed = true;
        }

        const prevCode = existing.codeIds || [];
        const nextCode = codeIds || [];
        if (prevCode.length !== nextCode.length || prevCode.join(',') !== nextCode.join(',')) {
            existing.codeIds = nextCode;
            changed = true;
        }

        return {changed, id};
    }

    function fullRescan() {
        const roleNodes = dom.findRoleNodes();
        const freshIds = [];
        const freshById = new Map();

        for (const rn of roleNodes) {
            const role = rn.getAttribute('data-message-author-role');
            if (role !== 'user' && role !== 'assistant') continue;

            const preview = getPreviewText(rn);
            if (!preview) continue;

            const anchor = dom.getAnchorNode(rn);
            const id = dom.ensureAttrId(anchor, C.ITEM_ATTR);

            if (!freshById.has(id)) {
                const codeIds = getCodeBlockIds(rn);
                freshById.set(id, {id, role, preview, anchor, codeIds});
                freshIds.push(id);
            }
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
