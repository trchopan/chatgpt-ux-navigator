(() => {
    window.CGPT_NAV = window.CGPT_NAV || {};
    const {C} = window.CGPT_NAV;

    const SELECTED_CODE_CLASS = 'cgpt-nav-selected-code';
    /** @type {Element|null} */
    let selectedNode = null;

    function getScrollContainer(node) {
        if (!node) return document.documentElement;

        let current = node.parentNode;
        while (current && current !== document.body && current !== document.documentElement) {
            const style = getComputedStyle(current);
            const scrollable =
                style.overflowY === 'auto' ||
                style.overflowY === 'scroll' ||
                style.overflow === 'auto' ||
                style.overflow === 'scroll';

            if (scrollable && current.scrollHeight > current.clientHeight) return current;
            current = current.parentNode;
        }

        // fallback to doc/body when they are scrollable
        const de = document.documentElement;
        const bo = document.body;

        const deStyle = getComputedStyle(de);
        const boStyle = getComputedStyle(bo);

        const deScrollable =
            (deStyle.overflowY === 'auto' ||
                deStyle.overflowY === 'scroll' ||
                deStyle.overflow === 'auto' ||
                deStyle.overflow === 'scroll') &&
            de.scrollHeight > de.clientHeight;

        if (deScrollable) return de;

        const boScrollable =
            (boStyle.overflowY === 'auto' ||
                boStyle.overflowY === 'scroll' ||
                boStyle.overflow === 'auto' ||
                boStyle.overflow === 'scroll') &&
            bo.scrollHeight > bo.clientHeight;

        if (boScrollable) return bo;

        return de;
    }

    function flashNode(node) {
        const prevOutline = node.style.outline;
        node.style.outline = '2px solid rgba(255, 255, 255, 0.45)';
        setTimeout(() => (node.style.outline = prevOutline), 900);
    }

    /**
     * Persistently highlight a selected node (single-selection).
     * @param {Element|null} node
     */
    function setSelectedNode(node) {
        // Clean up if previous node was removed from DOM
        if (selectedNode && selectedNode.isConnected === false) {
            selectedNode = null;
        }

        if (!node || !(node instanceof Element)) return;

        if (selectedNode && selectedNode !== node) {
            selectedNode.classList.remove(SELECTED_CODE_CLASS);
        }

        selectedNode = node;
        selectedNode.classList.add(SELECTED_CODE_CLASS);

        // Notify sidebar (and any other listeners) which code block is selected
        try {
            const codeId = C?.CODE_ATTR ? selectedNode.getAttribute(C.CODE_ATTR) : null;
            window.dispatchEvent(
                new CustomEvent('cgpt-nav-code-selected', {
                    detail: {codeId: codeId || null},
                })
            );
        } catch (_) {
            // ignore
        }
    }

    function clearSelectedNode() {
        if (selectedNode) selectedNode.classList.remove(SELECTED_CODE_CLASS);
        selectedNode = null;

        try {
            window.dispatchEvent(
                new CustomEvent('cgpt-nav-code-selected', {
                    detail: {codeId: null},
                })
            );
        } catch (_) {
            // ignore
        }
    }

    function scrollToNodeTop(node) {
        const scrollContainer = getScrollContainer(node);
        const rect = node.getBoundingClientRect();
        let y;

        if (scrollContainer === document.documentElement || scrollContainer === document.body) {
            y = rect.top + window.pageYOffset;
        } else {
            const containerRect = scrollContainer.getBoundingClientRect();
            y = rect.top - containerRect.top + scrollContainer.scrollTop;
        }

        scrollContainer.scrollTo({top: y});
        flashNode(node);
    }

    function scrollToNodeBottom(node) {
        const scrollContainer = getScrollContainer(node);
        const rect = node.getBoundingClientRect();
        let y;

        if (scrollContainer === document.documentElement || scrollContainer === document.body) {
            y = rect.bottom + window.pageYOffset - window.innerHeight;
            scrollContainer.scrollTo({top: y});
        } else {
            const containerRect = scrollContainer.getBoundingClientRect();
            y =
                rect.bottom -
                containerRect.top +
                scrollContainer.scrollTop -
                scrollContainer.clientHeight;
            scrollContainer.scrollTo({top: y});
        }

        flashNode(node);
    }

    /**
     * Scroll to a selector near anchor (or fallback to global document query).
     * Returns the matched node (so callers can highlight it).
     * @param {Element} anchor
     * @param {string} selector
     * @returns {Element|null}
     */
    function scrollToSelectorNearAnchor(anchor, selector) {
        if (!anchor) return null;

        /** @type {Element|null} */
        const node =
            (anchor.querySelector && anchor.querySelector(selector)) ||
            document.querySelector(selector);
        if (!node) return null;

        const scrollContainer = getScrollContainer(node);
        const rect = node.getBoundingClientRect();
        let y;

        if (scrollContainer === document.documentElement || scrollContainer === document.body) {
            y = rect.top + window.pageYOffset;
        } else {
            const containerRect = scrollContainer.getBoundingClientRect();
            y = rect.top - containerRect.top + scrollContainer.scrollTop;
        }

        scrollContainer.scrollTo({top: y});
        flashNode(node);

        // If it's a code block <pre>, persist highlight as selection
        if (node.matches && node.matches('pre')) {
            setSelectedNode(node);
        }

        return node;
    }

    /**
     * Convenience: select a code block by id attr (or element), ensuring it gets the selection highlight.
     * @param {Element} preEl
     */
    function selectCodeBlock(preEl) {
        if (!preEl || !(preEl instanceof Element)) return;
        if (preEl.matches && preEl.matches('pre')) {
            // Ensure it has the code attr so it’s consistent with sidebar navigation
            if (C?.CODE_ATTR && !preEl.hasAttribute(C.CODE_ATTR)) {
                try {
                    preEl.setAttribute(C.CODE_ATTR, crypto.randomUUID());
                } catch (_) {
                    // ignore
                }
            }
            setSelectedNode(preEl);
        }
    }

    window.CGPT_NAV.scroll = {
        getScrollContainer,
        flashNode,
        scrollToNodeTop,
        scrollToNodeBottom,
        scrollToSelectorNearAnchor,
        setSelectedNode,
        clearSelectedNode,
        selectCodeBlock,
        SELECTED_CODE_CLASS,
    };
})();
