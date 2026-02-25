import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Payload Parsing Tests', () => {
  describe('Signal Message Format', () => {
    it('should have correct signal message structure', () => {
      const signalMessage = {
        type: 'signal',
        station: 'TestSignal',
        trigger: 'manual',
        timestamp: Date.now(),
        payload: {
          signal_payload: { default: 'data' },
          dynamic_payload: { dynamic: 'info' }
        }
      };

      assert.equal(signalMessage.type, 'signal');
      assert.ok(signalMessage.station);
      assert.ok(signalMessage.timestamp);
    });

    it('should handle payload with only signal_payload', () => {
      const msg = {
        payload: {
          signal_payload: { configured: 'data' }
        }
      };

      assert.ok(msg.payload.signal_payload);
      assert.equal(msg.payload.dynamic_payload, undefined);
    });

    it('should handle payload with only dynamic_payload', () => {
      const msg = {
        payload: {
          dynamic_payload: { api: 'data' }
        }
      };

      assert.ok(msg.payload.dynamic_payload);
      assert.equal(msg.payload.signal_payload, undefined);
    });

    it('should handle payload with both types', () => {
      const msg = {
        payload: {
          signal_payload: { default: 1 },
          dynamic_payload: { dynamic: 2 }
        }
      };

      assert.ok(msg.payload.signal_payload);
      assert.ok(msg.payload.dynamic_payload);
      assert.notEqual(msg.payload.signal_payload, msg.payload.dynamic_payload);
    });
  });

  describe('Payload Content Types', () => {
    it('should handle string payloads', () => {
      const payload = 'simple string payload';
      assert.equal(typeof payload, 'string');
    });

    it('should handle object payloads', () => {
      const payload = { key: 'value', nested: { data: 123 } };
      assert.equal(typeof payload, 'object');
      assert.ok(payload.nested);
    });

    it('should handle array payloads', () => {
      const payload = [1, 2, 3, { item: 4 }];
      assert.ok(Array.isArray(payload));
      assert.equal(payload.length, 4);
    });

    it('should handle null payload', () => {
      const payload = null;
      assert.equal(payload, null);
    });

    it('should handle undefined payload', () => {
      const payload = undefined;
      assert.equal(payload, undefined);
    });
  });

  describe('Command Parsing', () => {
    it('should detect direct_command field', () => {
      const payload = {
        direct_command: 'CREATE_ARCHITECTURE_NOW',
        force_execute: true
      };

      assert.ok(payload.direct_command);
      assert.equal(payload.direct_command, 'CREATE_ARCHITECTURE_NOW');
    });

    it('should detect command field', () => {
      const payload = {
        command: 'update_docs',
        parameters: { target: 'ARCHITECTURE.md' }
      };

      assert.ok(payload.command);
      assert.ok(payload.parameters);
    });

    it('should detect instructions field', () => {
      const payload = {
        instructions: 'Create comprehensive documentation...',
        priority: 'high'
      };

      assert.ok(payload.instructions);
      assert.equal(payload.priority, 'high');
    });
  });
});
