(() => {
    window.CGPT_NAV = window.CGPT_NAV || {};

    function sendMessage(message) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(message, resp => {
                const err = chrome.runtime.lastError;
                if (err) return reject(new Error(err.message));
                resolve(resp);
            });
        });
    }

    window.CGPT_NAV.messaging = {sendMessage};
})();
