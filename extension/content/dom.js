(() => {
    window.CGPT_NAV = window.CGPT_NAV || {};
    const {C} = window.CGPT_NAV;

    function $(sel, root = document) {
        return root.querySelector(sel);
    }

    function isInExtensionDom(node) {
        let n = node;
        while (n) {
            if (n.id === C.EXT_ID || n.id === C.SHOW_ID || n.id === C.PROMPT_MENU_ID) return true;
            n = n.parentNode;
        }
        return false;
    }

    function clampText(s) {
        return (s || '').replace(/\s+/g, ' ').trim();
    }

    function findRoleNodes(root = document) {
        return Array.from(root.querySelectorAll(C.ROLE_SEL));
    }

    function getAnchorNode(roleNode) {
        return (
            roleNode.closest(C.TURN_SEL) ||
            roleNode.closest('article') ||
            roleNode.closest('section') ||
            roleNode
        );
    }

    function ensureAttrId(node, attrName) {
        if (!node.hasAttribute(attrName)) node.setAttribute(attrName, crypto.randomUUID());
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
