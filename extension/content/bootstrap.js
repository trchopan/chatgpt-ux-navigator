(() => {
    const {store, model, observer, sidebar, activeSection} = window.CGPT_NAV;

    function init() {
        sidebar.ensureShowButton();
        sidebar.createSidebar();

        // initial scan
        model.fullRescan();
        sidebar.renderAll(); // render from model state
        if (activeSection?.start) activeSection.start();
        if (store.isHidden()) sidebar.hideSidebar();
        else sidebar.showSidebar();

        // observer updates
        observer.startObserver(() => {
            sidebar.renderFromModelIncremental();
            if (activeSection?.recomputeActive) activeSection.recomputeActive();
        });

        // keyboard toggle
        window.addEventListener('keydown', e => {
            if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'y') {
                const hidden = store.isHidden();
                store.setHidden(!hidden);
                if (hidden) {
                    sidebar.showSidebar();
                    sidebar.renderAll();
                } else {
                    sidebar.hideSidebar();
                }
            }
        });

        // confirm when user accidently close tab on temporary chat
        window.addEventListener('beforeunload', e => {
            e.preventDefault();
            e.returnValue = '';
        });

        // Persistently highlight a code block when user clicks it in the page
        document.addEventListener(
            'click',
            e => {
                const t = e.target;
                if (!(t instanceof Element)) return;
                if (window.CGPT_NAV.dom?.isInExtensionDom(t)) return;

                const pre = t.closest('pre');
                if (!pre) return;

                // Only treat it as a "navigator code block" if it has/gets the CODE_ATTR
                if (
                    window.CGPT_NAV.C?.CODE_ATTR &&
                    !pre.hasAttribute(window.CGPT_NAV.C.CODE_ATTR)
                ) {
                    // assign an id so it participates consistently
                    window.CGPT_NAV.dom?.ensureAttrId(pre, window.CGPT_NAV.C.CODE_ATTR);
                }

                // If it is a pre inside ChatGPT content, select/highlight it
                window.CGPT_NAV.scroll?.selectCodeBlock(pre);
            },
            true
        );
    }

    init();
})();
