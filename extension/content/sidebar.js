(() => {
    window.CGPT_NAV = window.CGPT_NAV || {};
    const {C, dom, store, model, scroll, prompts, clipboard, markdown, chatInput, newChat} =
        window.CGPT_NAV;

    // --- DOM caches for sidebar rendering
    /** @type {Map<string, HTMLElement>} */
    const domItemById = new Map(); // entryId -> sidebar item element
    let selectedFilename = null;
    let activeId = null;
    let selectedCodeId = null;

    // --- Prompt section state
    /** @type {{filename:string, at:number, threadMessages:{role:'user'|'assistant', content:string}[]} | null} */
    let threadCache = null;
    let promptsOpen = true;

    // ----------------------------
    // DOM helpers
    // ----------------------------
    function rootEl() {
        return document.getElementById(C.EXT_ID);
    }
    function listEl() {
        return dom.$('#cgpt-nav-list');
    }

    function promptsSectionEl() {
        return document.getElementById('cgpt-nav-prompts');
    }
    function promptsBodyEl() {
        return document.getElementById('cgpt-nav-prompts-body');
    }
    function promptsChevronEl() {
        return document.getElementById('cgpt-nav-prompts-chevron');
    }

    function isAtBottom(scroller, thresholdPx = 20) {
        if (!scroller) return false;
        return scroller.scrollHeight - (scroller.scrollTop + scroller.clientHeight) < thresholdPx;
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

    // ----------------------------
    // Prompts section
    // ----------------------------
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
            now - threadCache.at < C.PROMPT_LIST_TTL_MS;

        if (cacheOk) {
            renderPromptMessages(threadCache.threadMessages);
            return;
        }

        const threadMessages = await prompts.fetchThreadByFilename(selectedFilename);
        threadCache = {filename: selectedFilename, at: now, threadMessages};
        renderPromptMessages(threadMessages);
    }

    // ----------------------------
    // Code selection sync
    // ----------------------------
    function applySelectedCodeHighlight() {
        const root = rootEl();
        if (!root) return;

        root.querySelectorAll('.code-btn.selected').forEach(b => b.classList.remove('selected'));
        if (!selectedCodeId) return;

        root.querySelectorAll(`.code-btn[data-cgpt-nav-code-id="${selectedCodeId}"]`).forEach(b =>
            b.classList.add('selected')
        );
    }

    // ----------------------------
    // Show button + sidebar root
    // ----------------------------
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

    function hideSidebar() {
        const sidebar = rootEl();
        const showBtn = document.getElementById(C.SHOW_ID);
        if (sidebar) sidebar.style.display = 'none';
        if (showBtn) showBtn.style.display = 'block';
    }

    function showSidebar() {
        const sidebar = rootEl();
        const showBtn = document.getElementById(C.SHOW_ID);
        if (sidebar) sidebar.style.display = 'flex';
        if (showBtn) showBtn.style.display = 'none';
    }

    function ensureUiVisibility() {
        if (store.isHidden()) hideSidebar();
        else showSidebar();
    }

    function createSidebar() {
        if (rootEl()) return;

        const root = document.createElement('div');
        root.id = C.EXT_ID;

        root.innerHTML = `
<header>
    <div class="header-row">
        <div class="title">Navigator</div>

        <div class="controls">
			<button id="cgpt-nav-new-temp-chat" title="New temporary chat">🆕</button>
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

        // Prompts section toggle
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

        // Prevent clicks on right controls from toggling prompts
        root.querySelector('.prompts-right')?.addEventListener('click', ev => {
            ev.stopPropagation();
        });

        setPromptsOpen(promptsOpen);

        // File select options (lazy load on intent)
        const select = dom.$('#cgpt-nav-file-select');
        let fileListLoading = false;

        async function loadFileSelectOptions(force = false) {
            if (!select || fileListLoading) return;
            fileListLoading = true;

            const prevValue = select.value || '';

            if (select.options.length === 0) {
                select.innerHTML = `<option value="">Loading…</option>`;
            }

            try {
                const files = await prompts.ensurePromptListLoaded(force);

                select.innerHTML = `<option value="">Select file…</option>`;
                for (const f of files) {
                    const opt = document.createElement('option');
                    opt.value = f;
                    opt.textContent = f.length > 28 ? f.slice(0, 25) + '…' : f;
                    select.appendChild(opt);
                }

                if (prevValue && Array.from(select.options).some(o => o.value === prevValue)) {
                    select.value = prevValue;
                }
            } finally {
                fileListLoading = false;
            }
        }

        function handleSelectOpenIntent() {
            loadFileSelectOptions(false);
        }

        select?.addEventListener('mousedown', handleSelectOpenIntent);
        select?.addEventListener('focus', handleSelectOpenIntent);
        select?.addEventListener('keydown', e => {
            if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowDown') {
                handleSelectOpenIntent();
            }
        });

        select?.addEventListener('change', () => {
            selectedFilename = select.value || null;
            clearThreadCache();

            if (!selectedFilename) {
                renderPromptMessages([]);
                return;
            }
            if (promptsOpen) ensureThreadLoaded(true);
        });

        // Hide sidebar
        dom.$('#cgpt-nav-hide')?.addEventListener('click', () => {
            store.setHidden(true);
            hideSidebar();
        });

        // Refresh model + render
        dom.$('#cgpt-nav-refresh')?.addEventListener('click', () => {
            model.fullRescan();
            renderAll(true);
        });

        // Filters
        ['#cgpt-nav-filter-user', '#cgpt-nav-filter-assistant'].forEach(sel => {
            dom.$(sel)?.addEventListener('change', () => applyFiltersToRenderedItems());
        });

        // Copy full thread
        dom.$('#cgpt-nav-copy-thread')?.addEventListener('click', async () => {
            const roleNodes = dom.findRoleNodes();

            const parts = [];
            for (const roleNode of roleNodes) {
                const role = roleNode.getAttribute('data-message-author-role');
                if (role !== 'user' && role !== 'assistant') continue;

                const md = markdown.getMessageMarkdown(roleNode);
                if (!md) continue;

                parts.push(role === 'user' ? '# {{USER}}\n\n' : '# {{ASSISTANT}}\n\n');
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

        // Refresh prompt messages
        dom.$('#cgpt-nav-prompts-refresh')?.addEventListener('click', async ev => {
            ev.preventDefault();
            ev.stopPropagation();

            if (!selectedFilename) {
                alert('Select a file first');
                return;
            }
            await ensureThreadLoaded(true);
        });

        dom.$('#cgpt-nav-new-temp-chat')?.addEventListener('click', async () => {
            try {
                const btn = document.getElementById('cgpt-nav-new-temp-chat');
                const prev = btn ? btn.textContent : null;
                if (btn) btn.textContent = '…';

                const resp = await newChat?.startNewTemporaryChat?.();
                if (!resp?.ok) {
					console.error(resp);
                    alert(resp?.error || 'Failed to start a new chat');
                } else if (!resp?.temp) {
                    // New chat worked, but temp toggle could not be confirmed/enabled
                    alert('Started a new chat, but could not confirm Temporary Chat toggle.');
                }

                if (btn && prev != null) btn.textContent = prev;
            } catch (e) {
                alert(String(e?.message || e));
            }
        });

        // Save last assistant response
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

    function ensureUi() {
        ensureShowButton();
        createSidebar();
        ensureUiVisibility();
    }

    // ----------------------------
    // Active item highlight
    // ----------------------------
    function setActiveId(id) {
        if (!id || activeId === id) return;

        if (activeId) {
            const prevEl = domItemById.get(activeId);
            if (prevEl) prevEl.classList.remove('active');
        }

        activeId = id;

        const el = domItemById.get(activeId);
        if (el) el.classList.add('active');
    }

    // ----------------------------
    // Item construction helpers
    // ----------------------------
    function makeNavButton({className, title, textContent, onClick}) {
        const btn = document.createElement('button');
        btn.className = className;
        btn.type = 'button';
        btn.title = title;
        btn.textContent = textContent;
        btn.addEventListener('click', onClick);
        return btn;
    }

    function buildCodeRow(entry) {
        const codeRow = document.createElement('div');
        codeRow.className = 'code-indexes';

        const label = document.createElement('span');
        label.className = 'code-label';
        label.textContent = 'Code:';
        codeRow.appendChild(label);

        const btns = document.createElement('div');
        btns.className = 'code-btns';

        (entry.codeIds || []).forEach((codeId, i) => {
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
        return codeRow;
    }

    function wantsCodeRow(entry) {
        return entry.role === 'assistant' && entry.codeIds && entry.codeIds.length > 0;
    }

    function updateCodeRow(containerEl, entry) {
        const existingRow = containerEl.querySelector('.code-indexes');

        if (!wantsCodeRow(entry)) {
            if (existingRow) existingRow.remove();
            return;
        }

        // If codeIds count differs, rebuild row for simplicity (small DOM)
        const existingBtns = existingRow ? existingRow.querySelectorAll('.code-btn') : null;
        const sameCount = existingBtns && existingBtns.length === entry.codeIds.length;

        if (!existingRow || !sameCount) {
            if (existingRow) existingRow.remove();
            containerEl.appendChild(buildCodeRow(entry));
            return;
        }

        // Same count: update dataset + selection state + titles if needed
        existingBtns.forEach((btn, idx) => {
            const codeId = entry.codeIds[idx];
            btn.dataset.cgptNavCodeId = codeId;
            btn.title = `Go to code block ${idx + 1}`;
            btn.textContent = `${idx + 1}`;
            btn.classList.toggle('selected', !!selectedCodeId && selectedCodeId === codeId);
        });
    }

    // ----------------------------
    // Sidebar item construction
    // ----------------------------
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

        const topBtn = makeNavButton({
            className: 'navbtn nav-top',
            title: 'Go to top of this message',
            textContent: '↑',
            onClick: ev => {
                ev.preventDefault();
                ev.stopPropagation();
                scroll.scrollToNodeTop(entry.anchor);
            },
        });

        const bottomBtn = makeNavButton({
            className: 'navbtn nav-bottom',
            title: 'Go to bottom of this message',
            textContent: '↓',
            onClick: ev => {
                ev.preventDefault();
                ev.stopPropagation();
                scroll.scrollToNodeBottom(entry.anchor);
            },
        });

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

        if (wantsCodeRow(entry)) {
            item.appendChild(buildCodeRow(entry));
        }

        // Active class if this is current
        if (activeId && activeId === entry.id) item.classList.add('active');

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

        updateCodeRow(el, entry);

        // Ensure active class stays correct
        el.classList.toggle('active', !!activeId && activeId === entry.id);
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
     * Render (or update) one entry in the sidebar.
     * Keeps "stick to bottom" behavior if user is already at bottom.
     * @param {{id:string, role:'user'|'assistant', preview:string, anchor:Element, codeIds?:string[]}} entry
     */
    function renderEntry(entry) {
        const le = listEl();
        if (!le) return;

        const {order} = model.getState();
        const filters = getFilters();

        const wasAtBottom = isAtBottom(le);

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

        if (wasAtBottom) le.scrollTop = le.scrollHeight;
    }

    // ----------------------------
    // Public render APIs
    // ----------------------------
    /**
     * Clear list and fully render from model state.
     * @param {boolean} forceClear
     */
    function renderAll(forceClear = false) {
        ensureUi();

        const le = listEl();
        if (!le) return;

        if (forceClear) {
            domItemById.clear();
            le.innerHTML = '';
        }

        const {entryById, order} = model.getState();
        const filters = getFilters();

        const wasAtBottom = isAtBottom(le);
        const prevScrollTop = le.scrollTop;

        if (domItemById.size === 0) {
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
        }

        applySelectedCodeHighlight();
    }

    /**
     * Incremental repaint: update any entries already in the model and append new ones.
     * This is safe to call after model.upsertFromRoleNode() changes.
     */
    function renderFromModelIncremental() {
        ensureUi();

        const {entryById, order} = model.getState();

        for (const id of order) {
            const entry = entryById.get(id);
            if (!entry) continue;
            renderEntry(entry);
        }

        renumberIndices();
        applyFiltersToRenderedItems();
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
