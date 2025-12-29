(() => {
    const EXT_ID = 'cgpt-nav';
    const SHOW_ID = 'cgpt-nav-show';
    const ITEM_ATTR = 'data-cgpt-nav-id';
    const CODE_ATTR = 'data-cgpt-nav-code-id';
    const STORAGE_KEY = 'cgpt_nav_hidden';

    const ROLE_SEL = '[data-message-author-role="user"], [data-message-author-role="assistant"]';
    const TURN_SEL = '[data-testid="conversation-turn"]';

    function isInExtensionDom(node) {
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
            roleNode.closest(TURN_SEL) ||
            roleNode.closest('article') ||
            roleNode.closest('section') ||
            roleNode
        );
    }

    function ensureNodeId(node) {
        if (!node.hasAttribute(ITEM_ATTR)) node.setAttribute(ITEM_ATTR, crypto.randomUUID());
        return node.getAttribute(ITEM_ATTR);
    }

    function flashNode(node) {
        const prevOutline = node.style.outline;
        node.style.outline = '2px solid rgba(255, 255, 255, 0.45)';
        setTimeout(() => (node.style.outline = prevOutline), 900);
    }

    function scrollToNodeTop(node) {
        node.scrollIntoView({behavior: 'smooth', block: 'start'});
        flashNode(node);
    }

    function scrollToNodeBottom(node) {
        node.scrollIntoView({behavior: 'smooth', block: 'end'});
        flashNode(node);
    }

    function ensureCodeId(node) {
        if (!node.hasAttribute(CODE_ATTR)) node.setAttribute(CODE_ATTR, crypto.randomUUID());
        return node.getAttribute(CODE_ATTR);
    }

    function getMessageContentNode(roleNode) {
        return (
            roleNode.querySelector('.markdown') ||
            roleNode.querySelector('[data-testid="message-text"]') ||
            roleNode
        );
    }

    // Return stable IDs for each code block (<pre>) inside this message.
    function getCodeBlockIds(roleNode) {
        const role = roleNode.getAttribute('data-message-author-role');
        if (role !== 'assistant') return [];

        const content = getMessageContentNode(roleNode);
        if (!content || !content.querySelectorAll) return [];

        const pres = Array.from(content.querySelectorAll('pre'));
        const ids = [];
        for (const pre of pres) {
            const id = ensureCodeId(pre);
            ids.push(id);
        }
        return ids;
    }

    function scrollToCodeBlockWithinAnchor(anchor, codeId) {
        if (!anchor) return;

        const sel = `[${CODE_ATTR}="${codeId}"]`;
        const node = anchor.querySelector(sel) || document.querySelector(sel);
        if (!node) return;

        node.scrollIntoView({behavior: 'smooth', block: 'center'});
        flashNode(node);
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
            // Do not force a full rebuild; just ensure visibility is correct.
            renderAllFromCache();
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
        <div class="title">Navigator</div>
        <div class="controls">
          <button id="cgpt-nav-copy-thread" title="Copy full thread as Markdown">Copy Thread</button>
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

        // Refresh = full rescan + reconcile (still fast, but explicit)
        $('#cgpt-nav-refresh').addEventListener('click', () => fullRescanAndReconcile());

        ['#cgpt-nav-filter-user', '#cgpt-nav-filter-assistant'].forEach(sel => {
            $(sel).addEventListener('change', () => {
                // Performance: do not rebuild; just toggle visibility.
                applyFiltersToRenderedItems();
            });
        });

        $('#cgpt-nav-copy-thread').addEventListener('click', async () => {
            const roleNodes = findRoleNodes(); // always copy full thread (user + assistant), regardless of filters

            const parts = [];
            for (const roleNode of roleNodes) {
                const role = roleNode.getAttribute('data-message-author-role'); // user | assistant
                if (role !== 'user' && role !== 'assistant') continue;

                const md = getMessageMarkdown(roleNode);
                if (!md) continue;

                parts.push(role === 'user' ? '<|USER|>\n\n' : '<|ASSISTANT|>\n\n');
                parts.push(md.trim());
                parts.push('\n\n'); // separation between turns
            }

            const payload = parts.join('').trim() + '\n';
            const ok = await writeClipboardText(payload);

            const btn = document.getElementById('cgpt-nav-copy-thread');
            if (btn) {
                const prev = btn.textContent;
                btn.textContent = ok ? 'Copied' : 'Copy failed';
                setTimeout(() => (btn.textContent = prev), 900);
            }
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
    function findRoleNodes(root = document) {
        return Array.from(root.querySelectorAll(ROLE_SEL));
    }

    function getPreviewText(roleNode) {
        // Performance: prefer textContent (no forced layout) vs innerText.
        const t1 = clampText(roleNode.textContent);
        if (t1) return t1;

        // Fallback (rare)
        const t2 = clampText(roleNode.innerText);
        if (t2) return t2;

        return '';
    }

    function escapeMdText(s) {
        return (s || '').replace(/\r\n/g, '\n');
    }

    function htmlToMarkdown(rootEl) {
        const out = [];

        function mdForNode(node, ctx = {listDepth: 0, olIndex: 1}) {
            if (!node) return '';

            if (node.nodeType === Node.TEXT_NODE) {
                return escapeMdText(node.nodeValue);
            }

            if (node.nodeType !== Node.ELEMENT_NODE) return '';

            const tag = node.tagName.toLowerCase();

            const ariaHidden = node.getAttribute('aria-hidden');
            if (ariaHidden === 'true') return '';

            if (tag === 'pre') {
                const codeEl = node.querySelector('code');
                const codeText = codeEl ? codeEl.textContent : node.textContent;
                let lang = '';
                if (codeEl) {
                    const cls = codeEl.className || '';
                    const m = cls.match(/language-([a-z0-9_-]+)/i);
                    if (m) lang = m[1];
                }
                return `\n\`\`\`${lang}\n${(codeText || '').replace(/\n$/, '')}\n\`\`\`\n`;
            }

            if (tag === 'code') {
                if (node.closest('pre')) return '';
                const t = node.textContent || '';
                const needsDouble = t.includes('`');
                return needsDouble ? `\`\`${t}\`\`` : `\`${t}\``;
            }

            if (tag === 'a') {
                const text = (node.textContent || '').trim() || 'link';
                const href = node.getAttribute('href') || '';
                if (!href) return text;
                return `[${text}](${href})`;
            }

            if (tag === 'strong' || tag === 'b') {
                return `**${childrenToMd(node, ctx).trim()}**`;
            }
            if (tag === 'em' || tag === 'i') {
                return `*${childrenToMd(node, ctx).trim()}*`;
            }

            if (/^h[1-6]$/.test(tag)) {
                const level = Number(tag.slice(1));
                const text = childrenToMd(node, ctx).trim();
                return `\n${'#'.repeat(level)} ${text}\n\n`;
            }

            if (tag === 'blockquote') {
                const text = childrenToMd(node, ctx)
                    .trim()
                    .split('\n')
                    .map(l => `> ${l}`)
                    .join('\n');
                return `\n${text}\n\n`;
            }

            if (tag === 'ul' || tag === 'ol') {
                const isOl = tag === 'ol';
                let idx = 1;
                const parts = [];
                for (const li of Array.from(node.children)) {
                    if (li.tagName && li.tagName.toLowerCase() === 'li') {
                        const bullet = isOl ? `${idx}. ` : `- `;
                        const inner = childrenToMd(li, {
                            ...ctx,
                            listDepth: ctx.listDepth + 1,
                            olIndex: idx,
                        }).trim();
                        const indent = '  '.repeat(ctx.listDepth);
                        const lines = inner.split('\n');
                        const first = `${indent}${bullet}${lines[0] || ''}`;
                        const rest = lines.slice(1).map(l => `${indent}  ${l}`);
                        parts.push([first, ...rest].join('\n'));
                        idx += 1;
                    }
                }
                return `\n${parts.join('\n')}\n\n`;
            }

            if (tag === 'p') {
                const text = childrenToMd(node, ctx).trim();
                if (!text) return '';
                return `\n${text}\n\n`;
            }
            if (tag === 'br') return '\n';
            if (tag === 'hr') return '\n---\n';

            return childrenToMd(node, ctx);
        }

        function childrenToMd(el, ctx) {
            let s = '';
            for (const child of Array.from(el.childNodes)) {
                s += mdForNode(child, ctx);
            }
            return s;
        }

        const md = mdForNode(rootEl, {listDepth: 0, olIndex: 1});

        return md
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function getMessageMarkdown(roleNode) {
        const content =
            roleNode.querySelector('.markdown') ||
            roleNode.querySelector('[data-testid="message-text"]') ||
            roleNode;

        const hasElements = content.querySelector && content.querySelector('*');
        if (!hasElements) {
            return clampText(content.innerText || content.textContent || '');
        }

        const md = htmlToMarkdown(content);
        return md || clampText(content.innerText || content.textContent || '');
    }

    async function writeClipboardText(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (_) {
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.setAttribute('readonly', '');
                ta.style.position = 'fixed';
                ta.style.top = '-1000px';
                document.body.appendChild(ta);
                ta.select();
                const ok = document.execCommand('copy');
                document.body.removeChild(ta);
                return ok;
            } catch (_) {
                return false;
            }
        }
    }

    // --- Performance-oriented rendering model ---------------------------------
    // Cache entries by stable anchor id; render incrementally.
    const entryById = new Map(); // id -> { id, role, preview, anchor }
    const order = []; // ids in DOM order
    const domItemById = new Map(); // id -> element (sidebar item)

    function listEl() {
        return $('#cgpt-nav-list');
    }

    function shouldShowRole(role, filters) {
        if (role === 'user') return !!filters.user;
        if (role === 'assistant') return !!filters.assistant;
        return true;
    }

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
                b.addEventListener('click', ev => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    scrollToCodeBlockWithinAnchor(entry.anchor, codeId);
                });
                btns.appendChild(b);
            });

            codeRow.appendChild(btns);
            item.appendChild(codeRow);
        }

        topBtn.addEventListener('click', ev => {
            ev.preventDefault();
            ev.stopPropagation();
            scrollToNodeTop(entry.anchor);
        });

        bottomBtn.addEventListener('click', ev => {
            ev.preventDefault();
            ev.stopPropagation();
            scrollToNodeBottom(entry.anchor);
        });

        return item;
    }

    function updateItemElement(entry) {
        const el = domItemById.get(entry.id);
        if (!el) return;

        // Update role class/text only if needed.
        const roleEl = el.querySelector('.role');
        if (roleEl) {
            roleEl.className = `role ${entry.role}`;
            roleEl.textContent = entry.role.toUpperCase();
        }

        const prevEl = el.querySelector('.preview');
        if (prevEl && prevEl.textContent !== entry.preview) {
            prevEl.textContent = entry.preview;
        }

        // Reconcile code index row (assistant only)
        const existingRow = el.querySelector('.code-indexes');
        const wantCodes = entry.role === 'assistant' && entry.codeIds && entry.codeIds.length > 0;

        if (!wantCodes) {
            if (existingRow) existingRow.remove();
        } else {
            // If row missing or count differs, rebuild (cheap).
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
                        scrollToCodeBlockWithinAnchor(entry.anchor, codeId);
                    });
                    btns.appendChild(b);
                });

                codeRow.appendChild(btns);
                el.appendChild(codeRow);
            }
        }
    }

    function renumberIndices() {
        // Cheap operation; only called on full rescan or when appending first time.
        for (let i = 0; i < order.length; i++) {
            const id = order[i];
            const el = domItemById.get(id);
            if (!el) continue;
            const idxEl = el.querySelector('.idx');
            if (idxEl) idxEl.textContent = `#${i + 1}`;
        }
    }

    function applyFiltersToRenderedItems() {
        const filters = getFilters();
        for (const id of order) {
            const entry = entryById.get(id);
            const el = domItemById.get(id);
            if (!entry || !el) continue;
            el.style.display = shouldShowRole(entry.role, filters) ? '' : 'none';
        }
    }

    function renderEntryIfNeeded(entry) {
        const le = listEl();
        if (!le) return;

        const filters = getFilters();

        // Preserve "pinned to bottom" behavior when new items are appended.
        const prevScrollTop = le.scrollTop;
        const prevScrollHeight = le.scrollHeight;
        const wasAtBottom = prevScrollHeight - (prevScrollTop + le.clientHeight) < 20;

        if (!domItemById.has(entry.id)) {
            const idxNumber = order.indexOf(entry.id) + 1; // 1-based
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
            // Keep user's scroll position stable after append/update.
            const newScrollHeight = le.scrollHeight;
            const delta = newScrollHeight - prevScrollHeight;
            // If we appended below the viewport, delta is likely small; adjust defensively.
            le.scrollTop = prevScrollTop;
            // If you prefer a "relative position" preservation, use:
            // le.scrollTop = prevScrollTop + Math.max(0, delta);
        }
    }

    function renderAllFromCache() {
        ensureShowButton();
        createSidebar();

        const sidebar = document.getElementById(EXT_ID);
        const le = listEl();
        if (!sidebar || !le) return;

        if (isHidden()) hideSidebar();
        else showSidebar();

        // If nothing is rendered yet, do a one-time fast render without clearing repeatedly.
        if (domItemById.size === 0) {
            const filters = getFilters();

            // Preserve scroll (mostly irrelevant when empty, but safe).
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
        }
    }

    // Upsert from a roleNode; returns true if a new entry was created.
    function upsertFromRoleNode(roleNode) {
        const role = roleNode.getAttribute('data-message-author-role');
        if (role !== 'user' && role !== 'assistant') return false;

        const preview = getPreviewText(roleNode);
        if (!preview) return false;

        const anchor = getAnchorNode(roleNode);
        const id = ensureNodeId(anchor);

        const codeIds = getCodeBlockIds(roleNode);
        const entry = {id, role, preview, anchor, codeIds};

        const existing = entryById.get(id);
        if (!existing) {
            const entry = {id, role, preview, anchor};
            entryById.set(id, entry);
            order.push(id);

            // compare codeIds
            const prevCode = existing.codeIds || [];
            const nextCode = codeIds || [];
            if (prevCode.length !== nextCode.length || prevCode.join(',') !== nextCode.join(',')) {
                existing.codeIds = nextCode;
                changed = true;
            }

            renderEntryIfNeeded(entry);
            return true;
        } else {
            // Update existing in-place (anchor might remain same; role/preview can change)
            let changed = false;
            if (existing.role !== role) {
                existing.role = role;
                changed = true;
            }
            if (existing.preview !== preview) {
                existing.preview = preview;
                changed = true;
            }
            if (existing.anchor !== anchor) {
                existing.anchor = anchor;
                changed = true;
            }
            if (changed) renderEntryIfNeeded(existing);
            return false;
        }
    }

    function fullRescanAndReconcile() {
        ensureShowButton();
        createSidebar();

        const sidebar = document.getElementById(EXT_ID);
        const le = listEl();
        if (!sidebar || !le) return;

        if (isHidden()) hideSidebar();
        else showSidebar();

        // Build a fresh list of ids in DOM order
        const roleNodes = findRoleNodes();
        const freshIds = [];
        const freshById = new Map();

        for (const rn of roleNodes) {
            const role = rn.getAttribute('data-message-author-role');
            if (role !== 'user' && role !== 'assistant') continue;

            const preview = getPreviewText(rn);
            if (!preview) continue;

            const anchor = getAnchorNode(rn);
            const id = ensureNodeId(anchor);

            if (!freshById.has(id)) {
                const codeIds = getCodeBlockIds(rn);
                freshById.set(id, {id, role, preview, anchor, codeIds});

                freshIds.push(id);
            }
        }

        // Replace cache with fresh
        entryById.clear();
        for (const [id, entry] of freshById.entries()) entryById.set(id, entry);

        order.length = 0;
        order.push(...freshIds);

        // Reconcile DOM with minimal churn:
        // If the set changed materially, easiest is clear+re-render once (explicit refresh only).
        domItemById.clear();
        le.innerHTML = '';
        renderAllFromCache();
        renumberIndices();
    }

    // --- Observe DOM changes (performance-focused) -----------------------------
    let observer = null;
    let scheduled = false;
    const pendingRoots = new Set();

    function scheduleProcessPending() {
        if (scheduled) return;
        scheduled = true;

        // Use a short debounce; coalesce many mutations.
        setTimeout(() => {
            scheduled = false;
            processPending();
        }, 150);
    }

    function processPending() {
        if (pendingRoots.size === 0) return;

        ensureShowButton();
        createSidebar();

        const roots = Array.from(pendingRoots);
        pendingRoots.clear();

        // Process each root: find newly-added role nodes within it and upsert.
        // De-dup is handled by anchor id.
        for (const root of roots) {
            if (!root || root.nodeType !== Node.ELEMENT_NODE) continue;

            // If a conversation turn is added, scanning that subtree is cheap and precise.
            // Otherwise, scan subtree for role nodes.
            let roleNodes = [];
            if (root.matches && root.matches(ROLE_SEL)) {
                roleNodes = [root];
            } else {
                roleNodes = findRoleNodes(root);
            }
            for (const rn of roleNodes) upsertFromRoleNode(rn);
        }

        // Ensure indices remain correct when new entries append.
        // Appends preserve ordering; indices only need update for the new tail, but renumber is cheap.
        renumberIndices();

        // Apply current filters without rebuilding.
        applyFiltersToRenderedItems();
    }

    function startObserver() {
        if (observer) return;

        observer = new MutationObserver(mutations => {
            for (const m of mutations) {
                if (isInExtensionDom(m.target)) continue;

                if (!m.addedNodes || m.addedNodes.length === 0) continue;

                for (const n of m.addedNodes) {
                    if (!n) continue;
                    if (isInExtensionDom(n)) continue;

                    // Only react to relevant additions: turns or role nodes (or anything containing them).
                    // This avoids rebuild churn from unrelated UI updates.
                    if (n.nodeType === Node.ELEMENT_NODE) {
                        const el = n;

                        const isTurn =
                            (el.matches && el.matches(TURN_SEL)) ||
                            (el.querySelector && el.querySelector(TURN_SEL));

                        const hasRole =
                            (el.matches && el.matches(ROLE_SEL)) ||
                            (el.querySelector && el.querySelector(ROLE_SEL));

                        if (isTurn || hasRole) {
                            // Prefer processing the turn node if present (smaller scan).
                            if (isTurn && el.matches && el.matches(TURN_SEL)) {
                                pendingRoots.add(el);
                            } else if (isTurn && el.querySelector) {
                                const turn = el.querySelector(TURN_SEL);
                                pendingRoots.add(turn || el);
                            } else {
                                pendingRoots.add(el);
                            }
                        }
                    }
                }
            }

            if (pendingRoots.size > 0) scheduleProcessPending();
        });

        observer.observe(document.documentElement, {subtree: true, childList: true});
    }

    // --- Init -----------------------------------------------------------------
    function init() {
        ensureShowButton();
        createSidebar();

        // Initial load: one full rescan (fast enough once), then incremental updates.
        fullRescanAndReconcile();
        startObserver();

        // Optional hotkey: Ctrl+Shift+Y toggles sidebar
        window.addEventListener('keydown', e => {
            if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'y') {
                const hidden = isHidden();
                setHidden(!hidden);
                if (hidden) {
                    showSidebar();
                    renderAllFromCache();
                } else {
                    hideSidebar();
                }
            }
        });
    }

    init();
})();
