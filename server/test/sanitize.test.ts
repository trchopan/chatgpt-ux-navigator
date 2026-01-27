import {describe, it, expect} from 'bun:test';
import {sanitizeAssistantText} from '../src/http/responses/sanitize';

describe('sanitizeAssistantText', () => {
    it('returns trimmed text when no sentinel marker', () => {
        expect(sanitizeAssistantText('  Hello world  ')).toBe('Hello world');
    });

    it('keeps v1 prefix when sentinel is missing', () => {
        expect(sanitizeAssistantText('v1No marker')).toBe('v1No marker');
    });

    it('removes finished_successfully suffix and v1 prefix', () => {
        const raw = 'v1The rain rehearses on the roof finished_successfully';
        expect(sanitizeAssistantText(raw)).toBe('The rain rehearses on the roof');
    });

    it('returns suffix between markers and removes extra trailing links', () => {
        const raw =
            'search("How about Iphone 16 Pro Max?")finished_successfullyHere\'s the clean answer. finished_successfullyhttps://example.com';
        expect(sanitizeAssistantText(raw)).toBe("Here's the clean answer.");
    });

    it('returns empty when only marker remains', () => {
        expect(sanitizeAssistantText('  finished_successfully  ')).toBe('');
    });
});
