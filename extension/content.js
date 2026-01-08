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
            if (n.id === EXT_ID || n.id === SHOW_ID || n.id === 'cgpt-nav-prompt-menu') return true;
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

    /**
     * Finds the closest scrollable ancestor of a given DOM node.
     * An element is considered scrollable if it has 'overflow-y: auto' or 'scroll'
     * and its scrollHeight is greater than its clientHeight.
     * If no such ancestor is found, it defaults to `document.documentElement` or `document.body`
     * if they are scrollable, as these represent the main window scroll.
     * @param {HTMLElement} node The starting node to search from.
     * @returns {HTMLElement} The scrollable container element, or `document.documentElement` as a fallback.
     */
    function getScrollContainer(node) {
        if (!node) {
            return document.documentElement;
        }

        let current = node.parentNode;
        while (current && current !== document.body && current !== document.documentElement) {
            const style = getComputedStyle(current);
            if (
                (style.overflowY === 'auto' ||
                    style.overflowY === 'scroll' ||
                    style.overflow === 'auto' ||
                    style.overflow === 'scroll') &&
                current.scrollHeight > current.clientHeight
            ) {
                return current;
            }
            current = current.parentNode;
        }

        if (
            document.documentElement.scrollHeight > document.documentElement.clientHeight &&
            (getComputedStyle(document.documentElement).overflowY === 'auto' ||
                getComputedStyle(document.documentElement).overflowY === 'scroll' ||
                getComputedStyle(document.documentElement).overflow === 'auto' ||
                getComputedStyle(document.documentElement).overflow === 'scroll')
        ) {
            return document.documentElement;
        }
        if (
            document.body.scrollHeight > document.body.clientHeight &&
            (getComputedStyle(document.body).overflowY === 'auto' ||
                getComputedStyle(document.body).overflowY === 'scroll' ||
                getComputedStyle(document.body).overflow === 'auto' ||
                getComputedStyle(document.body).overflow === 'scroll')
        ) {
            return document.body;
        }

        return document.documentElement;
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
        const scrollContainer = getScrollContainer(node);
        const rect = node.getBoundingClientRect();
        let y;

        if (scrollContainer === document.documentElement || scrollContainer === document.body) {
            y = rect.top + window.pageYOffset;
        } else {
            const containerRect = scrollContainer.getBoundingClientRect();
            y = rect.top - containerRect.top + scrollContainer.scrollTop;
        }

        scrollContainer.scrollTo({top: y});
        flashNode(node);
    }

    function scrollToNodeBottom(node) {
        const scrollContainer = getScrollContainer(node);
        const rect = node.getBoundingClientRect();
        let y;

        if (scrollContainer === document.documentElement || scrollContainer === document.body) {
            y = rect.bottom + window.pageYOffset - window.innerHeight;
            scrollContainer.scrollTo({top: y});
        } else {
            const containerRect = scrollContainer.getBoundingClientRect();
            y =
                rect.bottom -
                containerRect.top +
                scrollContainer.scrollTop -
                scrollContainer.clientHeight;
            scrollContainer.scrollTo({top: y});
        }
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

        const scrollContainer = getScrollContainer(node);
        const rect = node.getBoundingClientRect();
        let y;

        if (scrollContainer === document.documentElement || scrollContainer === document.body) {
            y = rect.top + window.pageYOffset;
        } else {
            const containerRect = scrollContainer.getBoundingClientRect();
            y = rect.top - containerRect.top + scrollContainer.scrollTop;
        }

        scrollContainer.scrollTo({top: y});
        flashNode(node);
    }

    // --- Floating "Show" button ----------------------------------------------
    function ensureShowButton() {
        if (document.getElementById(SHOW_ID)) return;

        const btn = document.createElement('button');
        btn.id = SHOW_ID;
        btn.type = 'button';
        btn.textContent = 'Show Navigator';
        btn.style.display = 'none';

        btn.addEventListener('click', () => {
            setHidden(false);
            showSidebar();
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
          <div id="cgpt-nav-prompt-picker" style="display:inline-block;">
		    <button id="cgpt-nav-insert-prompt" title="Insert a prompt from http://localhost:8765">✨</button>
          </div>
          <button id="cgpt-nav-copy-thread" title="Copy full thread as Markdown">📋</button>
          <button id="cgpt-nav-refresh" title="Refresh list">🔄</button>
          <button id="cgpt-nav-hide" title="Hide sidebar">✖️</button>
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

        $('#cgpt-nav-refresh').addEventListener('click', () => fullRescanAndReconcile());

        ['#cgpt-nav-filter-user', '#cgpt-nav-filter-assistant'].forEach(sel => {
            $(sel).addEventListener('change', () => {
                applyFiltersToRenderedItems();
            });
        });

        $('#cgpt-nav-copy-thread').addEventListener('click', async () => {
            const roleNodes = findRoleNodes();

            const parts = [];
            for (const roleNode of roleNodes) {
                const role = roleNode.getAttribute('data-message-author-role');
                if (role !== 'user' && role !== 'assistant') continue;

                const md = getMessageMarkdown(roleNode);
                if (!md) continue;

                parts.push(role === 'user' ? '<|USER|>\n\n' : '<|ASSISTANT|>\n\n');
                parts.push(md.trim());
                parts.push('\n\n');
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

        // ---------------- Prompt dropdown (PORTAL to body; avoids clipping) ----------------
        let promptListCache = null; // string[] | null
        let promptListCacheAt = 0;
        const PROMPT_LIST_TTL_MS = 10_000;

        const PROMPT_MENU_ID = 'cgpt-nav-prompt-menu';

        function ensurePromptMenuPortal() {
            let m = document.getElementById(PROMPT_MENU_ID);
            if (m) return m;

            m = document.createElement('div');
            m.id = PROMPT_MENU_ID;
            m.style.cssText = `
                position: fixed;
                z-index: 2147483647;
                min-width: 260px;
                max-width: 360px;
                max-height: 320px;
                overflow: auto;
                display: none;
                padding: 6px;
                border-radius: 10px;
                border: 1px solid rgba(255,255,255,0.14);
                background: rgba(20,20,20,0.98);
                box-shadow: 0 10px 30px rgba(0,0,0,0.4);
            `;
            document.body.appendChild(m);
            return m;
        }

        function menuEl() {
            return ensurePromptMenuPortal();
        }

        function btnEl() {
            return document.getElementById('cgpt-nav-insert-prompt');
        }

        function isMenuOpen() {
            const m = menuEl();
            return m.style.display !== 'none';
        }

        function closeMenu() {
            const m = menuEl();
            m.style.display = 'none';
        }

        function setMenuContent(html) {
            const m = menuEl();
            m.innerHTML = html;
        }

        function positionMenuToButton() {
            const btn = btnEl();
            const m = menuEl();
            if (!btn || !m) return;

            const r = btn.getBoundingClientRect();
            const gap = 8;

            // Temporarily show invisibly to measure
            const prevDisplay = m.style.display;
            const prevVis = m.style.visibility;
            m.style.visibility = 'hidden';
            m.style.display = 'block';

            const menuW = m.offsetWidth || 300;
            const menuH = m.offsetHeight || 200;

            let left = r.right - menuW;
            let top = r.bottom + gap;

            left = Math.max(gap, Math.min(left, window.innerWidth - menuW - gap));

            if (top + menuH + gap > window.innerHeight) {
                top = r.top - menuH - gap;
            }

            top = Math.max(gap, Math.min(top, window.innerHeight - menuH - gap));

            m.style.left = `${left}px`;
            m.style.top = `${top}px`;

            m.style.visibility = prevVis || '';
            m.style.display = prevDisplay === 'none' ? 'block' : prevDisplay;
        }

        function openMenu() {
            const m = menuEl();
            m.style.display = 'block';
            positionMenuToButton();
        }

        function renderPromptMenu(prompts) {
            const m = menuEl();
            if (!m) return;

            if (!prompts || prompts.length === 0) {
                setMenuContent(
                    `<div style="padding:8px; opacity:0.8;">No .md prompts found.</div>`
                );
                positionMenuToButton();
                return;
            }

            m.innerHTML = '';

            const header = document.createElement('div');
            header.textContent = 'Select a prompt';
            header.style.cssText = 'padding:6px 8px; font-weight:600; opacity:0.9;';
            m.appendChild(header);

            const hr = document.createElement('div');
            hr.style.cssText = 'height:1px; background: rgba(255,255,255,0.08); margin: 6px 0;';
            m.appendChild(hr);

            for (const filename of prompts) {
                const item = document.createElement('button');
                item.type = 'button';
                item.textContent = filename;
                item.title = `Insert ${filename}`;
                item.style.cssText = `
                    width: 100%;
                    text-align: left;
                    padding: 8px 10px;
                    margin: 2px 0;
                    border-radius: 8px;
                    border: 1px solid rgba(255,255,255,0.08);
                    background: rgba(255,255,255,0.04);
                    cursor: pointer;
                `;

                item.addEventListener('mouseenter', () => {
                    item.style.background = 'rgba(255,255,255,0.08)';
                });
                item.addEventListener('mouseleave', () => {
                    item.style.background = 'rgba(255,255,255,0.04)';
                });

                item.addEventListener('click', async ev => {
                    ev.preventDefault();
                    ev.stopPropagation();

                    const btn = btnEl();
                    const prev = btn?.textContent || '✨';

                    try {
                        closeMenu();
                        if (btn) btn.textContent = '…';

                        const promptText = await fetchPromptByFilename(filename);

                        const ok = setChatInputText(promptText);
                        if (!ok) throw new Error('Could not find the chat input box');

                        if (btn) btn.textContent = '✓';
                        setTimeout(() => {
                            const b = btnEl();
                            if (b) b.textContent = prev;
                        }, 800);
                    } catch (e) {
                        console.error('[cgpt-nav] Insert selected prompt failed:', e);
                        if (btn) btn.textContent = '!';
                        setTimeout(() => {
                            const b = btnEl();
                            if (b) b.textContent = prev;
                        }, 1200);
                    }
                });

                m.appendChild(item);
            }

            positionMenuToButton();
        }

        async function ensurePromptListLoaded(force = false) {
            const now = Date.now();
            const fresh = promptListCache && now - promptListCacheAt < PROMPT_LIST_TTL_MS;
            if (!force && fresh) return promptListCache;

            const prompts = await fetchPromptList();
            prompts.sort((a, b) => a.localeCompare(b));
            promptListCache = prompts;
            promptListCacheAt = now;
            return prompts;
        }

        // Close dropdown on outside click / ESC; reposition while open
        document.addEventListener(
            'click',
            ev => {
                if (!isMenuOpen()) return;

                const btn = btnEl();
                const m = menuEl();
                const t = ev.target;

                if (btn && btn.contains(t)) return;
                if (m && m.contains(t)) return;

                closeMenu();
            },
            true
        );

        window.addEventListener('keydown', ev => {
            if (ev.key === 'Escape') closeMenu();
        });

        window.addEventListener('resize', () => {
            if (isMenuOpen()) positionMenuToButton();
        });

        window.addEventListener(
            'scroll',
            () => {
                if (isMenuOpen()) positionMenuToButton();
            },
            true
        );

        $('#cgpt-nav-insert-prompt').addEventListener('click', async ev => {
            ev.preventDefault();
            ev.stopPropagation();

            if (isMenuOpen()) {
                closeMenu();
                return;
            }

            openMenu();
            setMenuContent(`<div style="padding:8px; opacity:0.8;">Loading…</div>`);
            positionMenuToButton();

            try {
                const prompts = await ensurePromptListLoaded(false);
                renderPromptMenu(prompts);
            } catch (e) {
                console.error('[cgpt-nav] Failed to load prompt list:', e);
                setMenuContent(
                    `<div style="padding:8px;">
                        <div style="margin-bottom:8px; opacity:0.85;">Failed to load prompt list.</div>
                        <button id="cgpt-nav-prompt-retry" type="button"
                            style="padding:8px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.06); cursor:pointer;">
                            Retry
                        </button>
                     </div>`
                );
                positionMenuToButton();

                const retry = document.getElementById('cgpt-nav-prompt-retry');
                if (retry) {
                    retry.addEventListener('click', async ev2 => {
                        ev2.preventDefault();
                        ev2.stopPropagation();
                        setMenuContent(`<div style="padding:8px; opacity:0.8;">Loading…</div>`);
                        positionMenuToButton();
                        try {
                            const prompts = await ensurePromptListLoaded(true);
                            renderPromptMenu(prompts);
                        } catch (e2) {
                            console.error('[cgpt-nav] Retry failed:', e2);
                            setMenuContent(
                                `<div style="padding:8px; opacity:0.8;">Still failing.</div>`
                            );
                            positionMenuToButton();
                        }
                    });
                }
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
        const t1 = clampText(roleNode.textContent);
        if (t1) return t1;

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

    // ---------- NEW: list + prompt fetch via background ----------
    function fetchPromptList() {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({type: 'cgpt-nav-fetch-list'}, resp => {
                const err = chrome.runtime.lastError;
                if (err) return reject(new Error(err.message));

                if (!resp?.ok)
                    return reject(new Error(resp?.error || 'Failed to fetch prompt list'));
                resolve(resp.prompts || []);
            });
        });
    }

    function fetchPromptByFilename(filename) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({type: 'cgpt-nav-fetch-prompt', filename}, resp => {
                const err = chrome.runtime.lastError;
                if (err) return reject(new Error(err.message));

                if (!resp?.ok) return reject(new Error(resp?.error || 'Failed to fetch prompt'));
                resolve(resp.text || '');
            });
        });
    }

    // (kept for backward-compat; not used by the new dropdown)
    function fetchLocalPrompt() {
        return fetchPromptByFilename('default.md');
    }

    function findChatInput() {
        const ce =
            document.querySelector('[data-testid="prompt-textarea"][contenteditable="true"]') ||
            document.querySelector('form [contenteditable="true"]');

        if (ce) return {kind: 'contenteditable', el: ce};

        return null;
    }

    function insertViaPaste(el, text) {
        try {
            const dt = new DataTransfer();
            dt.setData('text/plain', text);

            const ev = new ClipboardEvent('paste', {
                clipboardData: dt,
                bubbles: true,
                cancelable: true,
            });

            return el.dispatchEvent(ev);
        } catch (e) {
            return false;
        }
    }

    function fallbackInsertAsParagraphs(el, text) {
        el.innerHTML = '';
        const lines = (text || '').split('\n');

        for (const line of lines) {
            const p = document.createElement('p');
            p.textContent = line === '' ? '\u00A0' : line;
            el.appendChild(p);
        }

        el.dispatchEvent(
            new InputEvent('input', {bubbles: true, inputType: 'insertFromPaste', data: text})
        );
    }

    function escapeHtml(s) {
        return (s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function setChatInputText(text) {
        const input = findChatInput();
        if (!input) return false;

        const t = (text ?? '').replace(/\r\n/g, '\n');

        if (input.kind === 'contenteditable') {
            const el = input.el;
            el.focus();

            const sel = window.getSelection();
            if (sel && el.firstChild) {
                const range = document.createRange();
                range.selectNodeContents(el);
                range.collapse(false);
                sel.removeAllRanges();
                sel.addRange(range);
            }

            const pasted = insertViaPaste(el, t);

            if (!pasted) {
                fallbackInsertAsParagraphs(el, t);
            }

            return true;
        }

        return false;
    }

    // --- Performance-oriented rendering model ---------------------------------
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
        } else {
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
            const newScrollHeight = le.scrollHeight;
            const delta = newScrollHeight - prevScrollHeight;
            le.scrollTop = prevScrollTop;
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

        if (domItemById.size === 0) {
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
        }
    }

    function upsertFromRoleNode(roleNode) {
        const role = roleNode.getAttribute('data-message-author-role');
        if (role !== 'user' && role !== 'assistant') return false;

        const preview = getPreviewText(roleNode);
        if (!preview) return false;

        const anchor = getAnchorNode(roleNode);
        const id = ensureNodeId(anchor);

        const codeIds = getCodeBlockIds(roleNode);

        const existing = entryById.get(id);
        if (!existing) {
            const entry = {id, role, preview, anchor, codeIds};
            entryById.set(id, entry);
            order.push(id);

            renderEntryIfNeeded(entry);
            return true;
        } else {
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
            const prevCode = existing.codeIds || [];
            const nextCode = codeIds || [];
            if (prevCode.length !== nextCode.length || prevCode.join(',') !== nextCode.join(',')) {
                existing.codeIds = nextCode;
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

        entryById.clear();
        for (const [id, entry] of freshById.entries()) entryById.set(id, entry);

        order.length = 0;
        order.push(...freshIds);

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

        for (const root of roots) {
            if (!root || root.nodeType !== Node.ELEMENT_NODE) continue;

            let roleNodes = [];
            if (root.matches && root.matches(ROLE_SEL)) {
                roleNodes = [root];
            } else {
                roleNodes = findRoleNodes(root);
            }
            for (const rn of roleNodes) upsertFromRoleNode(rn);
        }

        renumberIndices();
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

                    if (n.nodeType === Node.ELEMENT_NODE) {
                        const el = n;

                        const isTurn =
                            (el.matches && el.matches(TURN_SEL)) ||
                            (el.querySelector && el.querySelector(TURN_SEL));

                        const hasRole =
                            (el.matches && el.matches(ROLE_SEL)) ||
                            (el.querySelector && el.querySelector(ROLE_SEL));

                        if (isTurn || hasRole) {
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

        fullRescanAndReconcile();
        startObserver();

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

        window.addEventListener('beforeunload', function (e) {
            e.preventDefault();
            e.returnValue = '';
        });
    }

    init();
})();
