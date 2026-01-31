import {describe, it, expect, beforeEach, afterEach, mock} from 'bun:test';
import {
	setClient,
	getClient,
	removeClient,
	hasClient,
	sendToClient,
} from '../src/ws/hub';

describe('hub.ts - Multi-client registry', () => {
	// Note: hub.ts uses a module-level Map<clientId, WebSocket>
	// We can't directly clear it between tests, so we rely on unique clientIds
	// or use beforeEach/afterEach with specific cleanup if needed

	describe('setClient & getClient', () => {
		it('should store a client and retrieve it by ID', () => {
			const mockWs = {send: mock(() => {}), close: mock(() => {})} as any;
			const clientId = 'client-1';

			setClient(clientId, mockWs);
			const retrieved = getClient(clientId);

			expect(retrieved).toBe(mockWs);
		});

		it('should return null if client not found', () => {
			const retrieved = getClient('non-existent-id');
			expect(retrieved).toBe(null);
		});

		it('should close old socket when replacing existing client with same ID', () => {
			const oldClose = mock(() => {});
			const oldWs = {send: mock(() => {}), close: oldClose} as any;

			const newClose = mock(() => {});
			const newWs = {send: mock(() => {}), close: newClose} as any;

			const clientId = 'client-replace';

			// Set initial client
			setClient(clientId, oldWs);
			expect(getClient(clientId)).toBe(oldWs);

			// Replace with new client (old socket should be closed)
			setClient(clientId, newWs);

			expect(oldClose).toHaveBeenCalledTimes(1);
			expect(getClient(clientId)).toBe(newWs);
			expect(newClose).not.toHaveBeenCalled();
		});

		it('should handle close errors gracefully when replacing client', () => {
			const oldWs = {
				send: mock(() => {}),
				close: mock(() => {
					throw new Error('Close failed');
				}),
			} as any;

			const newWs = {send: mock(() => {}), close: mock(() => {})} as any;

			const clientId = 'client-error-close';

			// Set initial client
			setClient(clientId, oldWs);

			// Replace with new client (should not throw even if close fails)
			expect(() => {
				setClient(clientId, newWs);
			}).not.toThrow();

			expect(getClient(clientId)).toBe(newWs);
		});
	});

	describe('removeClient', () => {
		it('should remove a client from registry', () => {
			const mockWs = {send: mock(() => {}), close: mock(() => {})} as any;
			const clientId = 'client-remove';

			setClient(clientId, mockWs);
			expect(getClient(clientId)).toBe(mockWs);

			removeClient(clientId);
			expect(getClient(clientId)).toBe(null);
		});

		it('should not throw if removing non-existent client', () => {
			expect(() => {
				removeClient('non-existent-id');
			}).not.toThrow();
		});
	});

	describe('hasClient', () => {
		it('should return true if client exists', () => {
			const mockWs = {send: mock(() => {}), close: mock(() => {})} as any;
			const clientId = 'client-has-true';

			expect(hasClient(clientId)).toBe(false);

			setClient(clientId, mockWs);
			expect(hasClient(clientId)).toBe(true);
		});

		it('should return false if client does not exist', () => {
			expect(hasClient('non-existent-id')).toBe(false);
		});

		it('should return false after client is removed', () => {
			const mockWs = {send: mock(() => {}), close: mock(() => {})} as any;
			const clientId = 'client-has-remove';

			setClient(clientId, mockWs);
			expect(hasClient(clientId)).toBe(true);

			removeClient(clientId);
			expect(hasClient(clientId)).toBe(false);
		});
	});

	describe('sendToClient', () => {
		it('should return false if client not found', () => {
			const result = sendToClient('non-existent-id', {msg: 'hello'});
			expect(result).toBe(false);
		});

		it('should send JSON stringified message to existing client and return true', () => {
			const mockSend = mock(() => {});
			const mockWs = {send: mockSend, close: mock(() => {})} as any;
			const clientId = 'client-send';

			setClient(clientId, mockWs);

			const obj = {type: 'test', data: 'hello'};
			const result = sendToClient(clientId, obj);

			expect(result).toBe(true);
			expect(mockSend).toHaveBeenCalledTimes(1);
			expect(mockSend).toHaveBeenCalledWith(JSON.stringify(obj));
		});

		it('should return false if send throws an error', () => {
			const mockWs = {
				send: mock(() => {
					throw new Error('Send failed');
				}),
				close: mock(() => {}),
			} as any;
			const clientId = 'client-send-error';

			setClient(clientId, mockWs);

			const result = sendToClient(clientId, {msg: 'hello'});
			expect(result).toBe(false);
		});

		it('should stringify complex objects correctly', () => {
			const mockSend = mock(() => {});
			const mockWs = {send: mockSend, close: mock(() => {})} as any;
			const clientId = 'client-complex-obj';

			setClient(clientId, mockWs);

			const complexObj = {
				type: 'prompt',
				input: 'test input',
				nested: {
					array: [1, 2, 3],
					bool: true,
				},
			};

			sendToClient(clientId, complexObj);

			expect(mockSend).toHaveBeenCalledWith(JSON.stringify(complexObj));
		});
	});

	describe('Multi-client isolation', () => {
		it('should maintain separate clients with different IDs', () => {
			const mockWs1 = {send: mock(() => {}), close: mock(() => {})} as any;
			const mockWs2 = {send: mock(() => {}), close: mock(() => {})} as any;

			const clientId1 = 'client-isolation-1';
			const clientId2 = 'client-isolation-2';

			setClient(clientId1, mockWs1);
			setClient(clientId2, mockWs2);

			expect(getClient(clientId1)).toBe(mockWs1);
			expect(getClient(clientId2)).toBe(mockWs2);
			expect(hasClient(clientId1)).toBe(true);
			expect(hasClient(clientId2)).toBe(true);
		});

		it('should send to correct client without affecting others', () => {
			const mockSend1 = mock(() => {});
			const mockWs1 = {send: mockSend1, close: mock(() => {})} as any;

			const mockSend2 = mock(() => {});
			const mockWs2 = {send: mockSend2, close: mock(() => {})} as any;

			const clientId1 = 'client-send-isolated-1';
			const clientId2 = 'client-send-isolated-2';

			setClient(clientId1, mockWs1);
			setClient(clientId2, mockWs2);

			const msg1 = {msg: 'to client 1'};
			const msg2 = {msg: 'to client 2'};

			sendToClient(clientId1, msg1);
			sendToClient(clientId2, msg2);

			expect(mockSend1).toHaveBeenCalledWith(JSON.stringify(msg1));
			expect(mockSend2).toHaveBeenCalledWith(JSON.stringify(msg2));
			expect(mockSend1).not.toHaveBeenCalledWith(JSON.stringify(msg2));
			expect(mockSend2).not.toHaveBeenCalledWith(JSON.stringify(msg1));
		});

		it('should not affect other clients when removing one', () => {
			const mockWs1 = {send: mock(() => {}), close: mock(() => {})} as any;
			const mockWs2 = {send: mock(() => {}), close: mock(() => {})} as any;

			const clientId1 = 'client-remove-isolated-1';
			const clientId2 = 'client-remove-isolated-2';

			setClient(clientId1, mockWs1);
			setClient(clientId2, mockWs2);

			removeClient(clientId1);

			expect(hasClient(clientId1)).toBe(false);
			expect(hasClient(clientId2)).toBe(true);
			expect(getClient(clientId2)).toBe(mockWs2);
		});
	});
});
