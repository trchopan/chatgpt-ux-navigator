(() => {
    window.CGPT_NAV = window.CGPT_NAV || {};
    const {C, dom, model} = window.CGPT_NAV;

    let observer = null;
    let scheduled = false;
    const pendingRoots = new Set();

    function scheduleProcessPending(processFn) {
        if (scheduled) return;
        scheduled = true;

        setTimeout(() => {
            scheduled = false;
            processFn();
        }, 150);
    }

    function startObserver(onEntriesChanged) {
        if (observer) return;

        function processPending() {
            if (pendingRoots.size === 0) return;

            const roots = Array.from(pendingRoots);
            pendingRoots.clear();

            let anyChanged = false;

            for (const root of roots) {
                if (!root || root.nodeType !== Node.ELEMENT_NODE) continue;

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
                if (dom.isInExtensionDom(m.target)) continue;
                if (!m.addedNodes || m.addedNodes.length === 0) continue;

                for (const n of m.addedNodes) {
                    if (!n) continue;
                    if (dom.isInExtensionDom(n)) continue;
                    if (n.nodeType !== Node.ELEMENT_NODE) continue;

                    const el = n;

                    const isTurn =
                        (el.matches && el.matches(C.TURN_SEL)) ||
                        (el.querySelector && el.querySelector(C.TURN_SEL));

                    const hasRole =
                        (el.matches && el.matches(C.ROLE_SEL)) ||
                        (el.querySelector && el.querySelector(C.ROLE_SEL));

                    if (!isTurn && !hasRole) continue;

                    if (isTurn && el.matches && el.matches(C.TURN_SEL)) pendingRoots.add(el);
                    else if (isTurn && el.querySelector)
                        pendingRoots.add(el.querySelector(C.TURN_SEL) || el);
                    else pendingRoots.add(el);
                }
            }

            if (pendingRoots.size > 0) scheduleProcessPending(processPending);
        });

        observer.observe(document.documentElement, {subtree: true, childList: true});
    }

    window.CGPT_NAV.observer = {startObserver};
})();
