// extension/content/activeSection.js
(() => {
    window.CGPT_NAV = window.CGPT_NAV || {};
    const {model, sidebar} = window.CGPT_NAV;

    let rafScheduled = false;

    // Fallback if we can't reliably detect header height
    const FALLBACK_VIEWPORT_TOP_OFFSET = 84;

    /**
     * Best-effort attempt to compute the “content top” offset.
     * ChatGPT header varies; we try to infer a reasonable value and fallback.
     * @returns {number}
     */
    function getViewportTopOffset() {
        // Common-ish header patterns on ChatGPT; keep conservative and fail-safe.
        const header =
            document.querySelector('header') ||
            document.querySelector('[role="banner"]') ||
            document.querySelector('[data-testid="app-header"]');

        if (header instanceof Element) {
            const r = header.getBoundingClientRect();
            // If header is at top and has a reasonable height, use it + small gap.
            if (r.top <= 0 && r.height > 20 && r.height < 200) {
                return Math.round(r.height + 12);
            }
        }

        return FALLBACK_VIEWPORT_TOP_OFFSET;
    }

    /**
     * Pick the "active" message id based on anchor position in viewport.
     * @returns {string|null}
     */
    function pickActiveId() {
        if (!model?.getState) return null;

        const {entryById, order} = model.getState();
        if (!order || order.length === 0) return null;

        const offset = getViewportTopOffset();

        let bestId = null;
        let bestScore = Number.POSITIVE_INFINITY;

        for (const id of order) {
            const entry = entryById.get(id);
            if (!entry || !entry.anchor || !(entry.anchor instanceof Element)) continue;

            const rect = entry.anchor.getBoundingClientRect();

            // Skip anchors fully outside viewport to reduce noise
            if (rect.bottom <= 0) continue;
            if (rect.top >= window.innerHeight) continue;

            // Prefer the message whose top is closest to the offset,
            // but favor "already reached" (above the offset) to avoid jumping early.
            const aboveOrAt = rect.top <= offset;
            const dist = Math.abs(rect.top - offset);
            const score = aboveOrAt ? dist : dist + 10_000;

            if (score < bestScore) {
                bestScore = score;
                bestId = id;
            }
        }

        // Fallback: if nothing matched, pick last in order
        return bestId || order[order.length - 1] || null;
    }

    function recomputeActiveNow() {
        if (!sidebar?.setActiveId) return;
        const id = pickActiveId();
        if (id) sidebar.setActiveId(id);
    }

    function scheduleRecompute() {
        if (rafScheduled) return;
        rafScheduled = true;

        requestAnimationFrame(() => {
            rafScheduled = false;
            recomputeActiveNow();
        });
    }

    function start() {
        // IMPORTANT:
        // scroll events do NOT bubble, so listening on window or a guessed container may miss them.
        // Capturing on document reliably catches scrolls from ANY scrollable element.
        document.addEventListener('scroll', scheduleRecompute, {capture: true, passive: true});
        window.addEventListener('resize', scheduleRecompute, {passive: true});

        // Initial compute
        scheduleRecompute();
    }

    window.CGPT_NAV.activeSection = {
        start,
        recomputeActive: scheduleRecompute,
    };
})();
