(() => {
    window.CGPT_NAV = window.CGPT_NAV || {};
    const {C} = window.CGPT_NAV;

    const SELECTED_CODE_CLASS = 'cgpt-nav-selected-code';

    /** @type {Element|null} */
    let selectedNode = null;

    // ----------------------------
    // Scroll container utilities
    // ----------------------------
    function isScrollable(el) {
        if (!el) return false;
        const style = getComputedStyle(el);
        const overflowY = style.overflowY || style.overflow;
        const scrollable = overflowY === 'auto' || overflowY === 'scroll';
        return scrollable && el.scrollHeight > el.clientHeight;
    }

    /**
     * Find nearest scrollable container for a node; fallback to documentElement/body.
     * @param {Element|null} node
     * @returns {Element}
     */
    function getScrollContainer(node) {
        if (!node) return document.documentElement;

        let current = node.parentElement;
        while (current && current !== document.body && current !== document.documentElement) {
            if (isScrollable(current)) return current;
            current = current.parentElement;
        }

        // fallback to doc/body when they are scrollable
        const de = document.documentElement;
        const bo = document.body;

        if (isScrollable(de)) return de;
        if (isScrollable(bo)) return bo;

        return de;
    }

    function flashNode(node) {
        const prevOutline = node.style.outline;
        node.style.outline = '2px solid rgba(255, 255, 255, 0.45)';
        setTimeout(() => (node.style.outline = prevOutline), 900);
    }

    // ----------------------------
    // Selection/highlight
    // ----------------------------
    function dispatchSelectedCodeId(codeId) {
        try {
            window.dispatchEvent(
                new CustomEvent('cgpt-nav-code-selected', {
                    detail: {codeId: codeId || null},
                })
            );
        } catch (_) {
            // ignore
        }
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

        const codeId = C?.CODE_ATTR ? selectedNode.getAttribute(C.CODE_ATTR) : null;
        dispatchSelectedCodeId(codeId);
    }

    function clearSelectedNode() {
        if (selectedNode) selectedNode.classList.remove(SELECTED_CODE_CLASS);
        selectedNode = null;
        dispatchSelectedCodeId(null);
    }

    /**
     * Ensure node has CODE_ATTR (for consistent sidebar linkage)
     * @param {Element} preEl
     */
    function ensureCodeAttr(preEl) {
        if (!C?.CODE_ATTR) return;
        if (preEl.hasAttribute(C.CODE_ATTR)) return;
        try {
            preEl.setAttribute(C.CODE_ATTR, crypto.randomUUID());
        } catch (_) {
            // ignore
        }
    }

    /**
     * Convenience: select a code block by element, ensuring it gets selection highlight.
     * @param {Element} preEl
     */
    function selectCodeBlock(preEl) {
        if (!preEl || !(preEl instanceof Element)) return;
        if (preEl.matches && preEl.matches('pre')) {
            ensureCodeAttr(preEl);
            setSelectedNode(preEl);
        }
    }

    // ----------------------------
    // Scrolling helpers
    // ----------------------------
    function getContainerScrollTop(container) {
        if (container === document.documentElement || container === document.body) {
            return window.pageYOffset;
        }
        return container.scrollTop;
    }

    function scrollContainerTo(container, top) {
        if (container === document.documentElement || container === document.body) {
            window.scrollTo({top});
        } else {
            container.scrollTo({top});
        }
    }

    /**
     * Scroll node into view with a predictable alignment against its scroll container.
     * @param {Element} node
     * @param {{align: 'top' | 'bottom'}} opts
     */
    function scrollToNode(node, opts) {
        const align = opts?.align || 'top';
        const container = getScrollContainer(node);

        const nodeRect = node.getBoundingClientRect();

        // If scrolling inside a container, convert node's client rect to container scroll coords.
        if (container !== document.documentElement && container !== document.body) {
            const containerRect = container.getBoundingClientRect();
            const currentTop = getContainerScrollTop(container);

            let targetTop = nodeRect.top - containerRect.top + currentTop; // top align baseline

            if (align === 'bottom') {
                targetTop =
                    nodeRect.bottom - containerRect.top + currentTop - container.clientHeight;
            }

            scrollContainerTo(container, targetTop);
            return;
        }

        // Page scrolling
        let targetTop = nodeRect.top + window.pageYOffset;

        if (align === 'bottom') {
            targetTop = nodeRect.bottom + window.pageYOffset - window.innerHeight;
        }

        scrollContainerTo(container, targetTop);
    }

    function scrollToNodeTop(node) {
        if (!node) return;
        scrollToNode(node, {align: 'top'});
        flashNode(node);
    }

    function scrollToNodeBottom(node) {
        if (!node) return;
        scrollToNode(node, {align: 'bottom'});
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

        scrollToNode(node, {align: 'top'});
        flashNode(node);

        if (node.matches && node.matches('pre')) {
            selectCodeBlock(node);
        }

        return node;
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
