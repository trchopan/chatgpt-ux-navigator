(() => {
    window.CGPT_NAV = window.CGPT_NAV || {};
    const {C} = window.CGPT_NAV;

    /**
     * @param {string} sel
     * @param {ParentNode} [root]
     * @returns {Element|null}
     */
    function $(sel, root = document) {
        return root.querySelector(sel);
    }

    /**
     * Returns true if node is inside our injected extension UI DOM.
     * @param {any} node
     * @returns {boolean}
     */
    function isInExtensionDom(node) {
        /** @type {Element|null} */
        const el =
            node instanceof Element
                ? node
                : node && node.nodeType === Node.ELEMENT_NODE
                  ? /** @type {Element} */ (node)
                  : null;

        let n = el;
        while (n) {
            const id = n.id || '';
            if (id === C.EXT_ID || id === C.SHOW_ID || id === C.PROMPT_MENU_ID) return true;
            n = n.parentElement;
        }
        return false;
    }

    /**
     * Normalize whitespace and trim.
     * @param {any} s
     * @returns {string}
     */
    function clampText(s) {
        return String(s || '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Find all role nodes in a root.
     * @param {ParentNode} [root]
     * @returns {Element[]}
     */
    function findRoleNodes(root = document) {
        return Array.from(root.querySelectorAll(C.ROLE_SEL));
    }

    /**
     * Given a role node, pick a reasonable anchor element for navigation and stable ids.
     * @param {Element} roleNode
     * @returns {Element}
     */
    function getAnchorNode(roleNode) {
        return (
            roleNode.closest(C.TURN_SEL) ||
            roleNode.closest('article') ||
            roleNode.closest('section') ||
            roleNode
        );
    }

    /**
     * Ensure an element has a stable UUID stored in the given attribute, and return it.
     * @param {Element} node
     * @param {string} attrName
     * @returns {string|null}
     */
    function ensureAttrId(node, attrName) {
        if (!node || !(node instanceof Element)) return null;

        if (!node.hasAttribute(attrName)) {
            let id = null;
            try {
                id = crypto.randomUUID();
            } catch (_) {
                // extremely old env fallback (shouldn't happen in modern Chrome)
                id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
            }
            node.setAttribute(attrName, id);
        }

        return node.getAttribute(attrName);
    }

    window.CGPT_NAV.dom = {
        $,
        isInExtensionDom,
        clampText,
        findRoleNodes,
        getAnchorNode,
        ensureAttrId,
    };
})();
