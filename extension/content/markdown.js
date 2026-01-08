(() => {
    window.CGPT_NAV = window.CGPT_NAV || {};
    const {dom} = window.CGPT_NAV;

    function escapeMdText(s) {
        return (s || '').replace(/\r\n/g, '\n');
    }

    /**
     * Convert a DOM subtree (ChatGPT message content) to reasonably faithful Markdown.
     * Keeps this intentionally “pragmatic” (not a full HTML->MD implementation).
     * @param {Element} rootEl
     * @returns {string}
     */
    function htmlToMarkdown(rootEl) {
        function mdForNode(node, ctx) {
            if (!node) return '';

            if (node.nodeType === Node.TEXT_NODE) {
                // @ts-ignore - nodeValue exists for text nodes
                return escapeMdText(node.nodeValue);
            }

            if (node.nodeType !== Node.ELEMENT_NODE) return '';
            // @ts-ignore - tagName exists for Element nodes
            const tag = node.tagName.toLowerCase();

            // @ts-ignore
            const ariaHidden = node.getAttribute?.('aria-hidden');
            if (ariaHidden === 'true') return '';

            if (tag === 'pre') {
                // @ts-ignore
                const codeEl = node.querySelector?.('code');
                // @ts-ignore
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
                // @ts-ignore
                if (node.closest?.('pre')) return '';
                // @ts-ignore
                const t = node.textContent || '';
                const needsDouble = t.includes('`');
                return needsDouble ? `\`\`${t}\`\`` : `\`${t}\``;
            }

            if (tag === 'a') {
                // @ts-ignore
                const text = (node.textContent || '').trim() || 'link';
                // @ts-ignore
                const href = node.getAttribute?.('href') || '';
                if (!href) return text;
                return `[${text}](${href})`;
            }

            if (tag === 'strong' || tag === 'b') {
                // @ts-ignore
                return `**${childrenToMd(node, ctx).trim()}**`;
            }
            if (tag === 'em' || tag === 'i') {
                // @ts-ignore
                return `*${childrenToMd(node, ctx).trim()}*`;
            }

            if (/^h[1-6]$/.test(tag)) {
                const level = Number(tag.slice(1));
                // @ts-ignore
                const text = childrenToMd(node, ctx).trim();
                return `\n${'#'.repeat(level)} ${text}\n\n`;
            }

            if (tag === 'blockquote') {
                // @ts-ignore
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
                // @ts-ignore
                for (const li of Array.from(node.children || [])) {
                    if (li.tagName && li.tagName.toLowerCase() === 'li') {
                        const bullet = isOl ? `${idx}. ` : `- `;
                        // @ts-ignore
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
                // @ts-ignore
                const text = childrenToMd(node, ctx).trim();
                if (!text) return '';
                return `\n${text}\n\n`;
            }

            if (tag === 'br') return '\n';
            if (tag === 'hr') return '\n---\n';

            // Default: recurse.
            // @ts-ignore
            return childrenToMd(node, ctx);
        }

        function childrenToMd(el, ctx) {
            let s = '';
            // @ts-ignore
            for (const child of Array.from(el.childNodes || [])) {
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
