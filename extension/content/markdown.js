(() => {
    window.CGPT_NAV = window.CGPT_NAV || {};
    const {dom} = window.CGPT_NAV;

    function normalizeNewlines(s) {
        return (s || '').replace(/\r\n/g, '\n');
    }

    function cleanupMd(md) {
        return normalizeNewlines(md)
            .replace(/[ \t]+\n/g, '\n') // trailing spaces
            .replace(/\n{3,}/g, '\n\n') // collapse big gaps
            .trim();
    }

    function getCodeFenceLang(codeEl) {
        if (!codeEl) return '';
        const cls = codeEl.className || '';
        const m = cls.match(/language-([a-z0-9_-]+)/i);
        return m ? m[1] : '';
    }

    function inlineCode(text) {
        const t = text || '';
        // If content includes backticks, wrap with double-backticks
        return t.includes('`') ? `\`\`${t}\`\`` : `\`${t}\``;
    }

    /**
     * Convert a DOM subtree (ChatGPT message content) to reasonably faithful Markdown.
     * Keeps this intentionally “pragmatic” (not a full HTML->MD implementation).
     * @param {Element} rootEl
     * @returns {string}
     */
    function htmlToMarkdown(rootEl) {
        function childrenToMd(el, ctx) {
            let out = '';
            // @ts-ignore
            for (const child of Array.from(el.childNodes || [])) {
                out += toMd(child, ctx);
            }
            return out;
        }

        function toMd(node, ctx) {
            if (!node) return '';

            if (node.nodeType === Node.TEXT_NODE) {
                // @ts-ignore
                return normalizeNewlines(node.nodeValue);
            }

            if (node.nodeType !== Node.ELEMENT_NODE) return '';

            /** @type {Element} */
            // @ts-ignore
            const el = node;

            const ariaHidden = el.getAttribute?.('aria-hidden');
            if (ariaHidden === 'true') return '';

            const tag = (el.tagName || '').toLowerCase();

            // --- Code blocks
            if (tag === 'pre') {
                const codeEl = el.querySelector?.('code');
                const codeText = codeEl ? codeEl.textContent : el.textContent;
                const lang = getCodeFenceLang(codeEl);

                const body = normalizeNewlines(codeText || '').replace(/\n$/, '');
                return `\n\`\`\`${lang}\n${body}\n\`\`\`\n`;
            }

            // Inline code
            if (tag === 'code') {
                if (el.closest?.('pre')) return '';
                return inlineCode(el.textContent || '');
            }

            // Links
            if (tag === 'a') {
                const text = (el.textContent || '').trim() || 'link';
                const href = el.getAttribute?.('href') || '';
                return href ? `[${text}](${href})` : text;
            }

            // Emphasis
            if (tag === 'strong' || tag === 'b') {
                const inner = childrenToMd(el, ctx).trim();
                return inner ? `**${inner}**` : '';
            }
            if (tag === 'em' || tag === 'i') {
                const inner = childrenToMd(el, ctx).trim();
                return inner ? `*${inner}*` : '';
            }

            // Headings
            if (/^h[1-6]$/.test(tag)) {
                const level = Number(tag.slice(1));
                const text = childrenToMd(el, ctx).trim();
                if (!text) return '';
                return `\n${'#'.repeat(level)} ${text}\n\n`;
            }

            // Blockquote
            if (tag === 'blockquote') {
                const text = childrenToMd(el, ctx).trim();
                if (!text) return '';
                const q = text
                    .split('\n')
                    .map(l => `> ${l}`)
                    .join('\n');
                return `\n${q}\n\n`;
            }

            // Lists
            if (tag === 'ul' || tag === 'ol') {
                const isOl = tag === 'ol';
                const parts = [];
                let idx = 1;

                // @ts-ignore
                for (const li of Array.from(el.children || [])) {
                    if (!li?.tagName || li.tagName.toLowerCase() !== 'li') continue;

                    const bullet = isOl ? `${idx}. ` : `- `;
                    const inner = childrenToMd(li, {
                        ...ctx,
                        listDepth: (ctx.listDepth || 0) + 1,
                        olIndex: idx,
                    }).trim();

                    const indent = '  '.repeat(ctx.listDepth || 0);
                    const lines = (inner || '').split('\n');
                    const first = `${indent}${bullet}${lines[0] || ''}`;
                    const rest = lines.slice(1).map(l => `${indent}  ${l}`);
                    parts.push([first, ...rest].join('\n'));

                    idx += 1;
                }

                if (!parts.length) return '';
                return `\n${parts.join('\n')}\n\n`;
            }

            // Paragraph
            if (tag === 'p') {
                const text = childrenToMd(el, ctx).trim();
                if (!text) return '';
                return `\n${text}\n\n`;
            }

            // Line breaks + rules
            if (tag === 'br') return '\n';
            if (tag === 'hr') return '\n---\n';

            // Default: recurse into children
            return childrenToMd(el, ctx);
        }

        const md = toMd(rootEl, {listDepth: 0, olIndex: 1});
        return cleanupMd(md);
    }

    /**
     * Get Markdown for a ChatGPT role node.
     * @param {Element} roleNode
     * @returns {string}
     */
    function getMessageMarkdown(roleNode) {
        const content =
            roleNode.querySelector('.markdown') ||
            roleNode.querySelector('[data-testid="message-text"]') ||
            roleNode;

        const hasElements = content.querySelector && content.querySelector('*');
        if (!hasElements) {
            return dom.clampText(content.innerText || content.textContent || '');
        }

        const md = htmlToMarkdown(content);
        return md || dom.clampText(content.innerText || content.textContent || '');
    }

    window.CGPT_NAV.markdown = {htmlToMarkdown, getMessageMarkdown};
})();
