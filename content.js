(() => {
    const EXT_ID = 'cgpt-nav';
    const SHOW_ID = 'cgpt-nav-show';
    const ITEM_ATTR = 'data-cgpt-nav-id';
    const STORAGE_KEY = 'cgpt_nav_hidden';

    function isInExtensionDom(node) {
        // node can be a Text node; walk up via parentNode
        let n = node;
        while (n) {
            if (n.id === EXT_ID || n.id === SHOW_ID) return true;
            n = n.parentNode;
        }
        return false;
    }

    function $(sel) {
        return document.querySelector(sel);
    }
    function isHidden() {
        return localStorage.getItem(STORAGE_KEY) === '1';
    }
    function setHidden(v) {
        localStorage.setItem(STORAGE_KEY, v ? '1' : '0');
    }

    function clampText(s) {
        return (s || '').replace(/\s+/g, ' ').trim();
    }

    // Prefer a stable “turn” container; fall back to the role node itself.
    function getAnchorNode(roleNode) {
        return (
            roleNode.closest('[data-testid="conversation-turn"]') ||
            roleNode.closest('article') ||
            roleNode.closest('section') ||
            roleNode
        );
    }

    function ensureNodeId(node) {
        if (!node.hasAttribute(ITEM_ATTR)) node.setAttribute(ITEM_ATTR, crypto.randomUUID());
        return node.getAttribute(ITEM_ATTR);
    }

    function scrollToNode(node) {
        node.scrollIntoView({behavior: 'smooth', block: 'center'});
        const prevOutline = node.style.outline;
        node.style.outline = '2px solid rgba(255, 255, 255, 0.45)';
        setTimeout(() => (node.style.outline = prevOutline), 900);
    }

    // --- Floating "Show" button ----------------------------------------------
    function ensureShowButton() {
        if (document.getElementById(SHOW_ID)) return;

        const btn = document.createElement('button');
        btn.id = SHOW_ID;
        btn.type = 'button';
        btn.textContent = 'Show Navigator';
        btn.style.display = 'none'; // toggled via hide/show

        btn.addEventListener('click', () => {
            setHidden(false);
            showSidebar();
            rebuildList();
        });

        document.documentElement.appendChild(btn);
    }

    // --- Sidebar UI -----------------------------------------------------------
    function createSidebar() {
        if (document.getElementById(EXT_ID)) return;

        const root = document.createElement('div');
        root.id = EXT_ID;

        root.innerHTML = `
      <header>
        <div class="title">Navigator (User / Assistant)</div>
        <div class="controls">
          <button id="cgpt-nav-refresh" title="Refresh list">Refresh</button>
          <button id="cgpt-nav-hide" title="Hide sidebar">Hide</button>
        </div>
      </header>

      <div class="filters">
        <label><input id="cgpt-nav-filter-user" type="checkbox" checked /> User</label>
        <label><input id="cgpt-nav-filter-assistant" type="checkbox" checked /> Assistant</label>
      </div>

      <div class="list" id="cgpt-nav-list"></div>
    `;

        document.documentElement.appendChild(root);

        $('#cgpt-nav-hide').addEventListener('click', () => {
            setHidden(true);
            hideSidebar();
        });

        $('#cgpt-nav-refresh').addEventListener('click', () => rebuildList());

        ['#cgpt-nav-filter-user', '#cgpt-nav-filter-assistant'].forEach(sel => {
            $(sel).addEventListener('change', rebuildList);
        });
    }

    function hideSidebar() {
        const sidebar = document.getElementById(EXT_ID);
        const showBtn = document.getElementById(SHOW_ID);
        if (sidebar) sidebar.style.display = 'none';
        if (showBtn) showBtn.style.display = 'block';
    }

    function showSidebar() {
        const sidebar = document.getElementById(EXT_ID);
        const showBtn = document.getElementById(SHOW_ID);
        if (sidebar) sidebar.style.display = 'flex';
        if (showBtn) showBtn.style.display = 'none';
    }

    function getFilters() {
        return {
            user: $('#cgpt-nav-filter-user')?.checked ?? true,
            assistant: $('#cgpt-nav-filter-assistant')?.checked ?? true,
        };
    }

    // --- Message detection (User + Assistant) --------------------------------
    function findRoleNodes() {
        return Array.from(
            document.querySelectorAll(
                '[data-message-author-role="user"], [data-message-author-role="assistant"]'
            )
        );
    }

    function getPreviewText(roleNode) {
        const t1 = clampText(roleNode.innerText);
        if (t1) return t1;

        const t2 = clampText(roleNode.textContent);
        if (t2) return t2;

        return '';
    }

    // --- Build / rebuild list -------------------------------------------------
    function rebuildList() {
        ensureShowButton();
        createSidebar();

        const sidebar = document.getElementById(EXT_ID);
        const listEl = $('#cgpt-nav-list');
        if (!sidebar || !listEl) return;

        if (isHidden()) hideSidebar();
        else showSidebar();

        // --- capture scroll state BEFORE clearing ---
        const prevScrollTop = listEl.scrollTop;
        const prevScrollHeight = listEl.scrollHeight;
        const wasAtBottom = prevScrollHeight - (prevScrollTop + listEl.clientHeight) < 20;

        listEl.innerHTML = '';

        const filters = getFilters();
        const roleNodes = findRoleNodes();

        const entries = [];
        for (const roleNode of roleNodes) {
            const role = roleNode.getAttribute('data-message-author-role'); // user | assistant
            if (role === 'user' && !filters.user) continue;
            if (role === 'assistant' && !filters.assistant) continue;

            const preview = getPreviewText(roleNode);
            if (!preview) continue;

            const anchor = getAnchorNode(roleNode);
            const id = ensureNodeId(anchor);

            entries.push({id, role, preview, anchor});
        }

        // De-duplicate by anchor id, preserve order
        const seen = new Set();
        const deduped = entries.filter(e => (seen.has(e.id) ? false : (seen.add(e.id), true)));

        deduped.forEach((e, idx) => {
            const item = document.createElement('div');
            item.className = 'cgpt-nav-item';
            item.innerHTML = `
        <div class="meta">
          <span class="role ${e.role}">${e.role.toUpperCase()}</span>
          <span class="idx">#${idx + 1}</span>
        </div>
        <div class="preview"></div>
      `;

            item.querySelector('.preview').textContent = e.preview;
            item.addEventListener('click', () => scrollToNode(e.anchor));
            listEl.appendChild(item);
        });

        // Restore scroll position
        if (wasAtBottom) {
            listEl.scrollTop = listEl.scrollHeight; // stay pinned to bottom
        } else {
            // Keep the same scrollTop, with a small adjustment if content height changed
            const newScrollHeight = listEl.scrollHeight;
            const delta = newScrollHeight - prevScrollHeight;
            listEl.scrollTop = prevScrollTop; // typically sufficient
            // If items were inserted above (rare), you may prefer:
            // listEl.scrollTop = prevScrollTop + Math.max(0, delta);
        }
    }

    // --- Observe DOM changes --------------------------------------------------
    let observer = null;
    let rebuildScheduled = false;

    function scheduleRebuild() {
        if (rebuildScheduled) return;
        rebuildScheduled = true;
        setTimeout(() => {
            rebuildScheduled = false;
            rebuildList();
        }, 250);
    }

    function startObserver() {
        if (observer) return;

        observer = new MutationObserver(mutations => {
            for (const m of mutations) {
                // Ignore any changes occurring inside the extension sidebar / show button
                if (isInExtensionDom(m.target)) continue;

                // Also ignore if added nodes belong to the extension
                if (m.addedNodes && m.addedNodes.length) {
                    let extensionNodeAdded = false;
                    for (const n of m.addedNodes) {
                        if (isInExtensionDom(n)) {
                            extensionNodeAdded = true;
                            break;
                        }
                    }
                    if (extensionNodeAdded) continue;

                    scheduleRebuild();
                    return;
                }
            }
        });

        observer.observe(document.documentElement, {subtree: true, childList: true});
    }

    // --- Init ----------------------------------------------------------------
    function init() {
        ensureShowButton();
        createSidebar();
        rebuildList();
        startObserver();

        // Optional hotkey: Ctrl+Shift+Y toggles sidebar
        window.addEventListener('keydown', e => {
            if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'y') {
                const hidden = isHidden();
                setHidden(!hidden);
                if (hidden) {
                    showSidebar();
                    rebuildList();
                } else {
                    hideSidebar();
                }
            }
        });
    }

    init();
})();
