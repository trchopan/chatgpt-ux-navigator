(() => {
    const {store, model, observer, sidebar} = window.CGPT_NAV;

    function init() {
        sidebar.ensureShowButton();
        sidebar.createSidebar();

        // initial scan
        model.fullRescan();
        sidebar.renderAll(); // render from model state
        if (store.isHidden()) sidebar.hideSidebar();
        else sidebar.showSidebar();

        // observer updates
        observer.startObserver(() => {
            sidebar.renderFromModelIncremental(); // you can implement as: render new/changed + renumber + filters
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
    }

    init();
})();
