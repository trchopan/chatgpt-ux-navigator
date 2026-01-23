// extension/content/store.js
(() => {
    window.CGPT_NAV = window.CGPT_NAV || {};
    const {C} = window.CGPT_NAV;

    function isHidden() {
        return localStorage.getItem(C.STORAGE_KEY_HIDDEN) === '1';
    }

    function setHidden(v) {
        localStorage.setItem(C.STORAGE_KEY_HIDDEN, v ? '1' : '0');
    }

    function isWsEnabled() {
        return localStorage.getItem(C.STORAGE_KEY_WS_ENABLED) === '1';
    }

    function setWsEnabled(v) {
        localStorage.setItem(C.STORAGE_KEY_WS_ENABLED, v ? '1' : '0');
    }

    window.CGPT_NAV.store = {isHidden, setHidden, isWsEnabled, setWsEnabled};
})();
