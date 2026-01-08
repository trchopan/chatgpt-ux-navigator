// extension/content/sidebar.js
(() => {
  window.CGPT_NAV = window.CGPT_NAV || {};
  const { C, dom, store, model, scroll, prompts, clipboard, markdown, chatInput } =
    window.CGPT_NAV;

  // --- DOM caches for sidebar rendering
  /** @type {Map<string, HTMLElement>} */
  const domItemById = new Map(); // id -> sidebar item element

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

    dom.$('#cgpt-nav-hide')?.addEventListener('click', () => {
      store.setHidden(true);
      hideSidebar();
    });

    dom.$('#cgpt-nav-refresh')?.addEventListener('click', () => {
      // authoritative refresh: rescan model + rerender
      model.fullRescan();
      renderAll(true);
    });

    ['#cgpt-nav-filter-user', '#cgpt-nav-filter-assistant'].forEach((sel) => {
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

    // ---------------- Prompt dropdown (PORTAL to body; avoids clipping) ----------------
    function ensurePromptMenuPortal() {
      let m = document.getElementById(C.PROMPT_MENU_ID);
      if (m) return m;

      m = document.createElement('div');
      m.id = C.PROMPT_MENU_ID;
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

      const prevDisplay = m.style.display;
      const prevVis = m.style.visibility;
      m.style.visibility = 'hidden';
      m.style.display = 'block';

      const menuW = m.offsetWidth || 300;
      const menuH = m.offsetHeight || 200;

      let left = r.right - menuW;
      let top = r.bottom + gap;

      left = Math.max(gap, Math.min(left, window.innerWidth - menuW - gap));
      if (top + menuH + gap > window.innerHeight) top = r.top - menuH - gap;
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

    function renderPromptMenu(promptFilenames) {
      const m = menuEl();
      if (!m) return;

      if (!promptFilenames || promptFilenames.length === 0) {
        setMenuContent(`<div style="padding:8px; opacity:0.8;">No .md prompts found.</div>`);
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

      for (const filename of promptFilenames) {
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

        item.addEventListener('click', async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();

          const btn = btnEl();
          const prev = btn?.textContent || '✨';

          try {
            closeMenu();
            if (btn) btn.textContent = '…';

            const promptText = await prompts.fetchPromptByFilename(filename);

            const ok = chatInput.setChatInputText(promptText);
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

    // Close dropdown on outside click / ESC; reposition while open
    document.addEventListener(
      'click',
      (ev) => {
        if (!isMenuOpen()) return;

        const btn = btnEl();
        const m = menuEl();
        const t = ev.target;

        if (btn && t instanceof Node && btn.contains(t)) return;
        if (m && t instanceof Node && m.contains(t)) return;

        closeMenu();
      },
      true
    );

    window.addEventListener('keydown', (ev) => {
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

    dom.$('#cgpt-nav-insert-prompt')?.addEventListener('click', async (ev) => {
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
        const list = await prompts.ensurePromptListLoaded(false);
        renderPromptMenu(list);
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
        retry?.addEventListener('click', async (ev2) => {
          ev2.preventDefault();
          ev2.stopPropagation(); // keep menu open
          setMenuContent(`<div style="padding:8px; opacity:0.8;">Loading…</div>`);
          positionMenuToButton();

          try {
            const list = await prompts.ensurePromptListLoaded(true);
            renderPromptMenu(list);
          } catch (e2) {
            console.error('[cgpt-nav] Retry failed:', e2);
            setMenuContent(`<div style="padding:8px; opacity:0.8;">Still failing.</div>`);
            positionMenuToButton();
          }
        });
      }
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
        b.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          scroll.scrollToSelectorNearAnchor(entry.anchor, `[${C.CODE_ATTR}="${codeId}"]`);
        });
        btns.appendChild(b);
      });

      codeRow.appendChild(btns);
      item.appendChild(codeRow);
    }

    topBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      scroll.scrollToNodeTop(entry.anchor);
    });

    bottomBtn.addEventListener('click', (ev) => {
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
        b.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          scroll.scrollToSelectorNearAnchor(entry.anchor, `[${C.CODE_ATTR}="${codeId}"]`);
        });
        btns.appendChild(b);
      });

      codeRow.appendChild(btns);
      el.appendChild(codeRow);
    }
  }

  function renumberIndices() {
    const { order } = model.getState();
    for (let i = 0; i < order.length; i++) {
      const id = order[i];
      const el = domItemById.get(id);
      if (!el) continue;
      const idxEl = el.querySelector('.idx');
      if (idxEl) idxEl.textContent = `#${i + 1}`;
    }
  }

  function applyFiltersToRenderedItems() {
    const { entryById, order } = model.getState();
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

    const { order } = model.getState();
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
      const { entryById, order } = model.getState();
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
    }
  }

  /**
   * Incremental repaint: update any entries already in the model and append new ones.
   * This is safe to call after model.upsertFromRoleNode() changes.
   */
  function renderFromModelIncremental() {
    ensureShowButton();
    createSidebar();

    const { entryById, order } = model.getState();

    // Append/update in DOM order
    for (const id of order) {
      const entry = entryById.get(id);
      if (!entry) continue;
      renderEntry(entry);
    }

    renumberIndices();
    applyFiltersToRenderedItems();
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
  };
})();

