(() => {
    window.CGPT_NAV = window.CGPT_NAV || {};

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

    function scrollToSelectorNearAnchor(anchor, selector) {
        if (!anchor) return;
        const node = anchor.querySelector(selector) || document.querySelector(selector);
        if (!node) return;

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

    window.CGPT_NAV.scroll = {
        getScrollContainer,
        flashNode,
        scrollToNodeTop,
        scrollToNodeBottom,
        scrollToSelectorNearAnchor,
    };
})();
