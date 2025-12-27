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

        $('#cgpt-nav-refresh').addEventListener('click', () => rebuildList());

        ['#cgpt-nav-filter-user', '#cgpt-nav-filter-assistant'].forEach(sel => {
            $(sel).addEventListener('change', rebuildList);
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

            // Optional: lightweight feedback without adding more UI
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

    function escapeMdText(s) {
        return (s || '').replace(/\r\n/g, '\n');
    }

    function htmlToMarkdown(rootEl) {
        // Minimal HTML → Markdown for common ChatGPT output.
        // This is intentionally conservative; it favors readable Markdown over perfect fidelity.
        const out = [];

        function mdForNode(node, ctx = {listDepth: 0, olIndex: 1}) {
            if (!node) return '';

            // Text node
            if (node.nodeType === Node.TEXT_NODE) {
                return escapeMdText(node.nodeValue);
            }

            // Ignore non-elements
            if (node.nodeType !== Node.ELEMENT_NODE) return '';

            const tag = node.tagName.toLowerCase();

            // Drop UI/hidden
            const ariaHidden = node.getAttribute('aria-hidden');
            if (ariaHidden === 'true') return '';

            // Code blocks
            if (tag === 'pre') {
                const codeEl = node.querySelector('code');
                const codeText = codeEl ? codeEl.textContent : node.textContent;
                // Optional language class: "language-xyz"
                let lang = '';
                if (codeEl) {
                    const cls = codeEl.className || '';
                    const m = cls.match(/language-([a-z0-9_-]+)/i);
                    if (m) lang = m[1];
                }
                return `\n\`\`\`${lang}\n${(codeText || '').replace(/\n$/, '')}\n\`\`\`\n`;
            }

            // Inline code
            if (tag === 'code') {
                // If it's inside <pre>, handled above
                if (node.closest('pre')) return '';
                const t = node.textContent || '';
                // Avoid breaking backticks by using double backticks when needed
                const needsDouble = t.includes('`');
                return needsDouble ? `\`\`${t}\`\`` : `\`${t}\``;
            }

            // Links
            if (tag === 'a') {
                const text = (node.textContent || '').trim() || 'link';
                const href = node.getAttribute('href') || '';
                if (!href) return text;
                return `[${text}](${href})`;
            }

            // Strong / Emphasis
            if (tag === 'strong' || tag === 'b') {
                return `**${childrenToMd(node, ctx).trim()}**`;
            }
            if (tag === 'em' || tag === 'i') {
                return `*${childrenToMd(node, ctx).trim()}*`;
            }

            // Headings
            if (/^h[1-6]$/.test(tag)) {
                const level = Number(tag.slice(1));
                const text = childrenToMd(node, ctx).trim();
                return `\n${'#'.repeat(level)} ${text}\n\n`;
            }

            // Blockquote
            if (tag === 'blockquote') {
                const text = childrenToMd(node, ctx)
                    .trim()
                    .split('\n')
                    .map(l => `> ${l}`)
                    .join('\n');
                return `\n${text}\n\n`;
            }

            // Lists
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
                        // Indent wrapped lines
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

            // Paragraph / line breaks
            if (tag === 'p') {
                const text = childrenToMd(node, ctx).trim();
                if (!text) return '';
                return `\n${text}\n\n`;
            }
            if (tag === 'br') {
                return '\n';
            }
            if (tag === 'hr') {
                return '\n---\n';
            }

            // Default: recurse children
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

        // Cleanup: collapse excessive blank lines
        return md
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function getMessageMarkdown(roleNode) {
        // Prefer the rendered markdown container if present; otherwise use roleNode.
        const content =
            roleNode.querySelector('.markdown') ||
            roleNode.querySelector('[data-testid="message-text"]') ||
            roleNode;

        // If there is no HTML structure (rare), fall back to innerText
        const hasElements = content.querySelector && content.querySelector('*');
        if (!hasElements) {
            return clampText(content.innerText || content.textContent || '');
        }

        const md = htmlToMarkdown(content);
        return md || clampText(content.innerText || content.textContent || '');
    }

    async function writeClipboardText(text) {
        // Primary: async clipboard
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (_) {
            // Fallback: execCommand (may fail on some pages)
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

            // --- meta row ---
            const meta = document.createElement('div');
            meta.className = 'meta';

            const role = document.createElement('span');
            role.className = `role ${e.role}`;
            role.textContent = e.role.toUpperCase();

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
            idxEl.textContent = `#${idx + 1}`;

            right.appendChild(navbtns);
            right.appendChild(idxEl);

            meta.appendChild(role);
            meta.appendChild(right);

            // --- preview ---
            const preview = document.createElement('div');
            preview.className = 'preview';
            preview.textContent = e.preview;

            item.appendChild(meta);
            item.appendChild(preview);

            // Only buttons navigate
            topBtn.addEventListener('click', ev => {
                ev.preventDefault();
                ev.stopPropagation();
                scrollToNodeTop(e.anchor);
            });

            bottomBtn.addEventListener('click', ev => {
                ev.preventDefault();
                ev.stopPropagation();
                scrollToNodeBottom(e.anchor);
            });

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
