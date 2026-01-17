(() => {
    window.CGPT_NAV = window.CGPT_NAV || {};
    const {model, sidebar} = window.CGPT_NAV;

    let rafScheduled = false;

    // Roughly where the "content top" begins in viewport coordinates.
    // Tune if needed (ChatGPT header varies).
    const VIEWPORT_TOP_OFFSET = 84;

    function pickActiveId() {
        const {entryById, order} = model.getState();
        if (!order || order.length === 0) return null;

        const offset = VIEWPORT_TOP_OFFSET;

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
        const id = pickActiveId();
        if (id) sidebar.setActiveId(id);
    }

    function scheduleRecompute() {
        console.log('[cgpt-nav] scroll captured');

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
