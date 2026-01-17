(() => {
    window.CGPT_NAV = window.CGPT_NAV || {};
    const {C, dom, model} = window.CGPT_NAV;

    /** @type {MutationObserver|null} */
    let observer = null;

    let scheduled = false;
    /** @type {Set<Element>} */
    const pendingRoots = new Set();

    // ----------------------------
    // Helpers
    // ----------------------------

    /**
     * @param {any} n
     * @returns {Element|null}
     */
    function asElement(n) {
        return n && n.nodeType === Node.ELEMENT_NODE ? /** @type {Element} */ (n) : null;
    }

    /**
     * Should we ignore this node entirely because it's inside the extension DOM?
     * @param {Element} el
     */
    function isIgnored(el) {
        return dom.isInExtensionDom(el);
    }

    /**
     * Determine whether an element itself is (or contains) a conversation turn.
     * @param {Element} el
     */
    function containsTurn(el) {
        if (el.matches && el.matches(C.TURN_SEL)) return true;
        return !!(el.querySelector && el.querySelector(C.TURN_SEL));
    }

    /**
     * Determine whether an element itself is (or contains) a role node.
     * @param {Element} el
     */
    function containsRole(el) {
        if (el.matches && el.matches(C.ROLE_SEL)) return true;
        return !!(el.querySelector && el.querySelector(C.ROLE_SEL));
    }

    /**
     * Given an added node, decide what element(s) we should scan.
     * We prefer to scan a turn node when present, because it scopes role nodes.
     * @param {Element} el
     * @returns {Element[]} array of roots to scan
     */
    function findScanRoots(el) {
        if (isIgnored(el)) return [];

        const hasTurn = containsTurn(el);
        const hasRole = containsRole(el);

        if (!hasTurn && !hasRole) return [];

        // Prefer scanning the conversation-turn element itself when possible.
        if (hasTurn) {
            if (el.matches && el.matches(C.TURN_SEL)) return [el];

            const turn = el.querySelector ? el.querySelector(C.TURN_SEL) : null;
            return [turn || el];
        }

        // No turn detected, but roles exist (scan the element itself)
        return [el];
    }

    function scheduleProcessPending(processFn) {
        if (scheduled) return;
        scheduled = true;

        setTimeout(() => {
            scheduled = false;
            processFn();
        }, 150);
    }

    // ----------------------------
    // Public
    // ----------------------------

    /**
     * Start the mutation observer (idempotent).
     * Calls onEntriesChanged() if any model entries were changed/added.
     * @param {() => void} onEntriesChanged
     */
    function startObserver(onEntriesChanged) {
        if (observer) return;

        function processPending() {
            if (pendingRoots.size === 0) return;

            const roots = Array.from(pendingRoots);
            pendingRoots.clear();

            let anyChanged = false;

            for (const root of roots) {
                if (!root || root.nodeType !== Node.ELEMENT_NODE) continue;
                if (isIgnored(root)) continue;

                const roleNodes =
                    root.matches && root.matches(C.ROLE_SEL) ? [root] : dom.findRoleNodes(root);

                for (const rn of roleNodes) {
                    const {changed} = model.upsertFromRoleNode(rn);
                    if (changed) anyChanged = true;
                }
            }

            if (anyChanged) onEntriesChanged();
        }

        observer = new MutationObserver(mutations => {
            for (const m of mutations) {
                const targetEl = asElement(m.target);
                if (targetEl && isIgnored(targetEl)) continue;

                if (!m.addedNodes || m.addedNodes.length === 0) continue;

                for (const n of m.addedNodes) {
                    const el = asElement(n);
                    if (!el) continue;
                    if (isIgnored(el)) continue;

                    const roots = findScanRoots(el);
                    for (const r of roots) pendingRoots.add(r);
                }
            }

            if (pendingRoots.size > 0) scheduleProcessPending(processPending);
        });

        observer.observe(document.documentElement, {subtree: true, childList: true});
    }

    window.CGPT_NAV.observer = {startObserver};
})();
