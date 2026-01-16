(() => {
    window.CGPT_NAV = window.CGPT_NAV || {};
    const {C, dom, store, model, scroll, prompts, clipboard, markdown, chatInput} = window.CGPT_NAV;

    // --- DOM caches for sidebar rendering
    /** @type {Map<string, HTMLElement>} */
    const domItemById = new Map(); // id -> sidebar item element
    let selectedFilename = null;
    let activeId = null;
    let selectedCodeId = null;

    // --- Prompt section state
    let promptsOpen = true;
    /** @type {{filename:string, at:number, threadMessages:{role:'user'|'assistant', content:string}[]} | null} */
    let threadCache = null;

    function promptsSectionEl() {
        return document.getElementById('cgpt-nav-prompts');
    }
    function promptsBodyEl() {
        return document.getElementById('cgpt-nav-prompts-body');
    }
    function promptsChevronEl() {
        return document.getElementById('cgpt-nav-prompts-chevron');
    }

    function setPromptsOpen(next) {
        promptsOpen = !!next;
        const sec = promptsSectionEl();
        const chev = promptsChevronEl();
        if (sec) sec.classList.toggle('open', promptsOpen);
        if (chev) chev.textContent = promptsOpen ? '▾' : '▸';
    }

    function clearThreadCache() {
        threadCache = null;
    }

    function getUserMessages(threadMessages) {
        return (threadMessages || []).filter(
            m => m?.role === 'user' && typeof m.content === 'string'
        );
    }

    /**
     * Render the prompt USER messages into the prompt section body.
     * @param {{role:'user'|'assistant', content:string}[]} threadMessages
     */
    function renderPromptMessages(threadMessages) {
        const body = promptsBodyEl();
        if (!body) return;

        const userMsgs = getUserMessages(threadMessages);

        if (!selectedFilename) {
            body.innerHTML = `<div class="cgpt-nav-prompts-empty">Select a file to view prompts.</div>`;
            return;
        }

        if (!userMsgs.length) {
            body.innerHTML = `<div class="cgpt-nav-prompts-empty">No USER messages found in this file.</div>`;
            return;
        }

        body.innerHTML = '';

        userMsgs.forEach((m, idx) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'cgpt-nav-prompt-item';
            btn.title = 'Insert this prompt into ChatGPT input';

            const n = document.createElement('span');
            n.className = 'cgpt-nav-prompt-idx';
            n.textContent = `#${idx + 1}`;

            const t = document.createElement('span');
            t.className = 'cgpt-nav-prompt-text';
            t.textContent = (m.content || '').trim();

            btn.appendChild(n);
            btn.appendChild(t);

            btn.addEventListener('click', ev => {
                ev.preventDefault();
                ev.stopPropagation();
                chatInput.setChatInputText(m.content || '');
            });

            body.appendChild(btn);
        });
    }

    /**
     * Load thread messages for selectedFilename, with optional force refetch.
     * @param {boolean} force
     */
    async function ensureThreadLoaded(force = false) {
        const now = Date.now();

        if (!selectedFilename) {
            renderPromptMessages([]);
            return;
        }

        const cacheOk =
            !force &&
            threadCache &&
            threadCache.filename === selectedFilename &&
            now - threadCache.at < C.PROMPT_LIST_TTL_MS; // reuse existing TTL constant

        if (cacheOk) {
            renderPromptMessages(threadCache.threadMessages);
            return;
        }

        const threadMessages = await prompts.fetchThreadByFilename(selectedFilename);
        threadCache = {filename: selectedFilename, at: now, threadMessages};
        renderPromptMessages(threadMessages);
    }

    function applySelectedCodeHighlight() {
        const root = document.getElementById(C.EXT_ID);
        if (!root) return;

        // Clear previous
        root.querySelectorAll('.code-btn.selected').forEach(b => b.classList.remove('selected'));

        if (!selectedCodeId) return;

        // Highlight all matching buttons (should normally be just one)
        root.querySelectorAll(`.code-btn[data-cgpt-nav-code-id="${selectedCodeId}"]`).forEach(b =>
            b.classList.add('selected')
        );
    }

    function listEl() {
        return dom.$('#cgpt-nav-list');
    }

    function getFilters() {
        return {
            user: dom.$('#cgpt-nav-filter-user')?.checked ?? true,
            assistant: dom.$('#cgpt-nav-filter-assistant')?.checked ?? true,
        };
    }

    function shouldShowRole(role, filters) {
        if (role === 'user') return !!filters.user;
        if (role === 'assistant') return !!filters.assistant;
        return true;
    }

    // --- Floating "Show" button
    function ensureShowButton() {
        if (document.getElementById(C.SHOW_ID)) return;

        const btn = document.createElement('button');
        btn.id = C.SHOW_ID;
        btn.type = 'button';
        btn.textContent = 'Show Navigator';
        btn.style.display = 'none';

        btn.addEventListener('click', () => {
            store.setHidden(false);
            showSidebar();
            renderAll();
        });

        document.documentElement.appendChild(btn);
    }

    // --- Sidebar root creation + events
    function createSidebar() {
        if (document.getElementById(C.EXT_ID)) return;

        const root = document.createElement('div');
        root.id = C.EXT_ID;

        root.innerHTML = `
<header>
    <div class="header-row">
        <div class="title">Navigator</div>

        <div class="controls">
            <button id="cgpt-nav-save-response" title="Save response">💾</button>
            <button id="cgpt-nav-copy-thread" title="Copy full thread as Markdown">📋</button>
            <button id="cgpt-nav-hide" title="Hide sidebar">✖️</button>
        </div>
    </div>
</header>

<div class="prompts" id="cgpt-nav-prompts">
    <div class="prompts-header">
        <div class="prompts-title">
            <span id="cgpt-nav-prompts-chevron">▸</span>
            <span>Prompts</span>
        </div>

        <div class="prompts-right">
            <select id="cgpt-nav-file-select" title="Select prompt file"></select>
            <button id="cgpt-nav-prompts-refresh" title="Refetch prompt messages">🔄</button>
        </div>
    </div>
    <div class="prompts-body" id="cgpt-nav-prompts-body"></div>
</div>

<div class="filters">
	<div class="filters-checkboxes">
		<label><input id="cgpt-nav-filter-user" type="checkbox" checked /> User</label>
		<label><input id="cgpt-nav-filter-assistant" type="checkbox" checked /> Assistant</label>
	</div>
	<button id="cgpt-nav-refresh" title="Refresh list">🔄</button>
</div>

<div class="list" id="cgpt-nav-list"></div>
		`;

        document.documentElement.appendChild(root);

        root.querySelector('.prompts-title')?.addEventListener('click', async ev => {
            ev.preventDefault();
            ev.stopPropagation();

            setPromptsOpen(!promptsOpen);

            if (promptsOpen) {
                if (!selectedFilename) {
                    renderPromptMessages([]);
                    return;
                }
                await ensureThreadLoaded(false);
            }
        });

        root.querySelector('.prompts-right')?.addEventListener('click', ev => {
            ev.stopPropagation();
        });

        setPromptsOpen(promptsOpen);

        const select = dom.$('#cgpt-nav-file-select');

        prompts.ensurePromptListLoaded().then(files => {
            select.innerHTML = `<option value="">Select file…</option>`;
            for (const f of files) {
                const opt = document.createElement('option');
                opt.value = f;
                opt.textContent = f.length > 28 ? f.slice(0, 25) + '…' : f;
                select.appendChild(opt);
            }
        });

        select.addEventListener('change', () => {
            selectedFilename = select.value || null;
            clearThreadCache();

            if (!selectedFilename) {
                renderPromptMessages([]);
                return;
            }

            if (promptsOpen) ensureThreadLoaded(true);
        });

        dom.$('#cgpt-nav-hide')?.addEventListener('click', () => {
            store.setHidden(true);
            hideSidebar();
        });

        dom.$('#cgpt-nav-refresh')?.addEventListener('click', () => {
            // authoritative refresh: rescan model + rerender
            model.fullRescan();
            renderAll(true);
        });

        ['#cgpt-nav-filter-user', '#cgpt-nav-filter-assistant'].forEach(sel => {
            dom.$(sel)?.addEventListener('change', () => applyFiltersToRenderedItems());
        });

        dom.$('#cgpt-nav-copy-thread')?.addEventListener('click', async () => {
            const roleNodes = dom.findRoleNodes();

            const parts = [];
            for (const roleNode of roleNodes) {
                const role = roleNode.getAttribute('data-message-author-role');
                if (role !== 'user' && role !== 'assistant') continue;

                const md = markdown.getMessageMarkdown(roleNode);
                if (!md) continue;

                parts.push(role === 'user' ? '<|USER|>\n\n' : '<|ASSISTANT|>\n\n');
                parts.push(md.trim());
                parts.push('\n\n');
            }

            const payload = parts.join('').trim() + '\n';
            const ok = await clipboard.writeClipboardText(payload);

            const btn = document.getElementById('cgpt-nav-copy-thread');
            if (btn) {
                const prev = btn.textContent;
                btn.textContent = ok ? 'Copied' : 'Copy failed';
                setTimeout(() => (btn.textContent = prev), 900);
            }
        });

        // Sync selected code block highlight into Navigator buttons
        window.addEventListener('cgpt-nav-code-selected', ev => {
            selectedCodeId = ev?.detail?.codeId || null;
            applySelectedCodeHighlight();
        });

        // Refresh prompt messages (inside Prompts header)
        dom.$('#cgpt-nav-prompts-refresh')?.addEventListener('click', async ev => {
            ev.preventDefault();
            ev.stopPropagation();

            if (!selectedFilename) {
                alert('Select a file first');
                return;
            }

            await ensureThreadLoaded(true);
        });

        dom.$('#cgpt-nav-save-response')?.addEventListener('click', async () => {
            if (!selectedFilename) {
                alert('Select a file first');
                return;
            }

            const roleNodes = dom.findRoleNodes();
            let lastAssistant = null;

            for (let i = roleNodes.length - 1; i >= 0; i--) {
                const rn = roleNodes[i];
                if (rn.getAttribute('data-message-author-role') === 'assistant') {
                    lastAssistant = rn;
                    break;
                }
            }

            if (!lastAssistant) {
                alert('No assistant response found');
                return;
            }

            const md = markdown.getMessageMarkdown(lastAssistant);
            await prompts.saveAssistantResponse(selectedFilename, md);

            alert('Response saved');
        });
    }

    function hideSidebar() {
        const sidebar = document.getElementById(C.EXT_ID);
        const showBtn = document.getElementById(C.SHOW_ID);
        if (sidebar) sidebar.style.display = 'none';
        if (showBtn) showBtn.style.display = 'block';
    }

    function showSidebar() {
        const sidebar = document.getElementById(C.EXT_ID);
        const showBtn = document.getElementById(C.SHOW_ID);
        if (sidebar) sidebar.style.display = 'flex';
        if (showBtn) showBtn.style.display = 'none';
    }

    function setActiveId(id) {
        if (!id || activeId === id) return;

        // Remove previous
        if (activeId) {
            const prevEl = domItemById.get(activeId);
            if (prevEl) prevEl.classList.remove('active');
        }

        activeId = id;

        const el = domItemById.get(activeId);
        if (el) el.classList.add('active');
    }

    // --- Sidebar item construction
    /**
     * @param {{id:string, role:'user'|'assistant', preview:string, anchor:Element, codeIds?:string[]}} entry
     * @param {number} idxNumber
     * @returns {HTMLElement}
     */
    function createItemElement(entry, idxNumber) {
        const item = document.createElement('div');
        item.className = 'cgpt-nav-item';
        item.dataset.cgptNavId = entry.id;

        const meta = document.createElement('div');
        meta.className = 'meta';

        const role = document.createElement('span');
        role.className = `role ${entry.role}`;
        role.textContent = entry.role.toUpperCase();

        const right = document.createElement('div');
        right.className = 'right';

        const navbtns = document.createElement('div');
        navbtns.className = 'navbtns';

        const topBtn = document.createElement('button');
        topBtn.className = 'navbtn nav-top';
        topBtn.type = 'button';
        topBtn.title = 'Go to top of this message';
        topBtn.textContent = '↑';

        const bottomBtn = document.createElement('button');
        bottomBtn.className = 'navbtn nav-bottom';
        bottomBtn.type = 'button';
        bottomBtn.title = 'Go to bottom of this message';
        bottomBtn.textContent = '↓';

        navbtns.appendChild(topBtn);
        navbtns.appendChild(bottomBtn);

        const idxEl = document.createElement('span');
        idxEl.className = 'idx';
        idxEl.textContent = `#${idxNumber}`;

        right.appendChild(navbtns);
        right.appendChild(idxEl);

        meta.appendChild(role);
        meta.appendChild(right);

        const preview = document.createElement('div');
        preview.className = 'preview';
        preview.textContent = entry.preview;

        item.appendChild(meta);
        item.appendChild(preview);

        // Code block index buttons
        if (entry.role === 'assistant' && entry.codeIds && entry.codeIds.length > 0) {
            const codeRow = document.createElement('div');
            codeRow.className = 'code-indexes';

            const label = document.createElement('span');
            label.className = 'code-label';
            label.textContent = 'Code:';
            codeRow.appendChild(label);

            const btns = document.createElement('div');
            btns.className = 'code-btns';

            entry.codeIds.forEach((codeId, i) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'code-btn';
                b.textContent = `${i + 1}`;
                b.title = `Go to code block ${i + 1}`;
                b.dataset.cgptNavCodeId = codeId;
                if (selectedCodeId && selectedCodeId === codeId) b.classList.add('selected');
                b.addEventListener('click', ev => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const node = scroll.scrollToSelectorNearAnchor(
                        entry.anchor,
                        `[${C.CODE_ATTR}="${codeId}"]`
                    );
                    if (node) scroll.setSelectedNode(node);
                });
                btns.appendChild(b);
            });

            codeRow.appendChild(btns);
            item.appendChild(codeRow);
        }

        topBtn.addEventListener('click', ev => {
            ev.preventDefault();
            ev.stopPropagation();
            scroll.scrollToNodeTop(entry.anchor);
        });

        bottomBtn.addEventListener('click', ev => {
            ev.preventDefault();
            ev.stopPropagation();
            scroll.scrollToNodeBottom(entry.anchor);
        });

        return item;
    }

    /**
     * Update existing sidebar item node with changed entry properties.
     * @param {{id:string, role:'user'|'assistant', preview:string, anchor:Element, codeIds?:string[]}} entry
     */
    function updateItemElement(entry) {
        const el = domItemById.get(entry.id);
        if (!el) return;

        const roleEl = el.querySelector('.role');
        if (roleEl) {
            roleEl.className = `role ${entry.role}`;
            roleEl.textContent = entry.role.toUpperCase();
        }

        const prevEl = el.querySelector('.preview');
        if (prevEl && prevEl.textContent !== entry.preview) {
            prevEl.textContent = entry.preview;
        }

        const existingRow = el.querySelector('.code-indexes');
        const wantCodes = entry.role === 'assistant' && entry.codeIds && entry.codeIds.length > 0;

        if (!wantCodes) {
            if (existingRow) existingRow.remove();
            return;
        }

        const existingBtns = existingRow ? existingRow.querySelectorAll('.code-btn') : null;
        const sameCount = existingBtns && existingBtns.length === entry.codeIds.length;

        if (!existingRow || !sameCount) {
            if (existingRow) existingRow.remove();

            const codeRow = document.createElement('div');
            codeRow.className = 'code-indexes';

            const label = document.createElement('span');
            label.className = 'code-label';
            label.textContent = 'Code:';
            codeRow.appendChild(label);

            const btns = document.createElement('div');
            btns.className = 'code-btns';

            entry.codeIds.forEach((codeId, i) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'code-btn';
                b.textContent = `${i + 1}`;
                b.title = `Go to code block ${i + 1}`;
                b.addEventListener('click', ev => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const node = scroll.scrollToSelectorNearAnchor(
                        entry.anchor,
                        `[${C.CODE_ATTR}="${codeId}"]`
                    );
                    if (node) scroll.setSelectedNode(node);
                });
                btns.appendChild(b);
            });

            codeRow.appendChild(btns);
            el.appendChild(codeRow);
        }
    }

    function renumberIndices() {
        const {order} = model.getState();
        for (let i = 0; i < order.length; i++) {
            const id = order[i];
            const el = domItemById.get(id);
            if (!el) continue;
            const idxEl = el.querySelector('.idx');
            if (idxEl) idxEl.textContent = `#${i + 1}`;
        }
    }

    function applyFiltersToRenderedItems() {
        const {entryById, order} = model.getState();
        const filters = getFilters();

        for (const id of order) {
            const entry = entryById.get(id);
            const el = domItemById.get(id);
            if (!entry || !el) continue;
            el.style.display = shouldShowRole(entry.role, filters) ? '' : 'none';
        }
    }

    /**
     * Render (or update) one entry in the sidebar. Keeps scroll position stable.
     * @param {{id:string, role:'user'|'assistant', preview:string, anchor:Element, codeIds?:string[]}} entry
     */
    function renderEntry(entry) {
        const le = listEl();
        if (!le) return;

        const {order} = model.getState();
        const filters = getFilters();

        // Preserve user's scroll position in the sidebar list
        const prevScrollTop = le.scrollTop;
        const prevScrollHeight = le.scrollHeight;
        const wasAtBottom = prevScrollHeight - (prevScrollTop + le.clientHeight) < 20;

        if (!domItemById.has(entry.id)) {
            const idxNumber = order.indexOf(entry.id) + 1;
            const itemEl = createItemElement(entry, idxNumber);
            itemEl.style.display = shouldShowRole(entry.role, filters) ? '' : 'none';
            le.appendChild(itemEl);
            domItemById.set(entry.id, itemEl);
        } else {
            updateItemElement(entry);
            const el = domItemById.get(entry.id);
            if (el) el.style.display = shouldShowRole(entry.role, filters) ? '' : 'none';
        }

        if (wasAtBottom) {
            le.scrollTop = le.scrollHeight;
        } else {
            // Keep same visual position
            const newScrollHeight = le.scrollHeight;
            const delta = newScrollHeight - prevScrollHeight;
            le.scrollTop = prevScrollTop + (delta > 0 ? 0 : 0);
        }
    }

    /**
     * Clear list and fully render from model state.
     * @param {boolean} forceClear
     */
    function renderAll(forceClear = false) {
        ensureShowButton();
        createSidebar();

        const sidebar = document.getElementById(C.EXT_ID);
        const le = listEl();
        if (!sidebar || !le) return;

        if (store.isHidden()) hideSidebar();
        else showSidebar();

        if (forceClear) {
            domItemById.clear();
            le.innerHTML = '';
        }

        if (domItemById.size === 0) {
            const {entryById, order} = model.getState();
            const filters = getFilters();

            const prevScrollTop = le.scrollTop;
            const prevScrollHeight = le.scrollHeight;
            const wasAtBottom = prevScrollHeight - (prevScrollTop + le.clientHeight) < 20;

            for (let i = 0; i < order.length; i++) {
                const id = order[i];
                const entry = entryById.get(id);
                if (!entry) continue;

                const itemEl = createItemElement(entry, i + 1);
                itemEl.style.display = shouldShowRole(entry.role, filters) ? '' : 'none';
                le.appendChild(itemEl);
                domItemById.set(id, itemEl);
            }

            if (wasAtBottom) le.scrollTop = le.scrollHeight;
            else le.scrollTop = prevScrollTop;
        } else {
            applyFiltersToRenderedItems();
            renumberIndices();
            if (activeId) {
                const el = domItemById.get(activeId);
                if (el) el.classList.add('active');
            }
        }

        applySelectedCodeHighlight();
    }

    /**
     * Incremental repaint: update any entries already in the model and append new ones.
     * This is safe to call after model.upsertFromRoleNode() changes.
     */
    function renderFromModelIncremental() {
        ensureShowButton();
        createSidebar();

        const {entryById, order} = model.getState();

        // Append/update in DOM order
        for (const id of order) {
            const entry = entryById.get(id);
            if (!entry) continue;
            renderEntry(entry);
        }

        renumberIndices();
        applyFiltersToRenderedItems();

        if (activeId) {
            const el = domItemById.get(activeId);
            if (el) el.classList.add('active');
        }

        applySelectedCodeHighlight();
    }

    window.CGPT_NAV.sidebar = {
        ensureShowButton,
        createSidebar,
        hideSidebar,
        showSidebar,
        renderAll,
        renderFromModelIncremental,
        applyFiltersToRenderedItems,
        renumberIndices,
        setActiveId,
    };
})();
