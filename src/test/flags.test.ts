import * as assert from 'assert';
import { describe, it } from 'mocha';
import { hashToPercent, resolveFlags, defaultFlags } from '../flags';

describe('flags', () => {
    describe('hashToPercent', () => {
        it('returns deterministic value within 0-99 range', () => {
            const sample = hashToPercent('sample-user');
            assert.ok(sample >= 0 && sample < 100, 'hashToPercent should stay within 0..99');

            // Deterministic: same input, same output
            const again = hashToPercent('sample-user');
            assert.strictEqual(sample, again);
        });

        it('produces different buckets for different inputs', () => {
            const a = hashToPercent('user-a');
            const b = hashToPercent('user-b');
            // It is statistically possible but highly unlikely to collide; guard with inequality fallback
            if (a === b) {
                const c = hashToPercent('user-c');
                assert.notStrictEqual(a, c, 'Expected differing inputs to map to different buckets');
            } else {
                assert.notStrictEqual(a, b);
            }
        });
    });

    describe('resolveFlags', () => {
        it('returns defaults when no overrides provided', () => {
            const result = resolveFlags({});
            assert.deepStrictEqual(result, defaultFlags);
        });

        it('prefers build flags over defaults, settings over build', () => {
            const result = resolveFlags({
                build: { enableStatusBarButton: false, exportDefaultOnPercent: 25 },
                settings: { enableStatusBarButton: true },
            });

            assert.strictEqual(result.enableStatusBarButton, true);
            assert.strictEqual(result.exportDefaultOnPercent, 25);
        });

        it('uses build thresholds with rollout when machine id provided', () => {
            const buildPercent = 10;
            const bucket = hashToPercent('machine-1');
            const result = resolveFlags({
                build: { exportDefaultOnPercent: buildPercent },
                machineId: 'machine-1',
            });

            // When rollout < 100 the value should stay within defaults but not mutate enableStatusBarButton
            assert.strictEqual(result.exportDefaultOnPercent, buildPercent);
            assert.strictEqual(typeof result.enableStatusBarButton, 'boolean');
            assert.ok(result.exportDefaultOnPercent >= 0 && result.exportDefaultOnPercent <= 100);
            assert.ok(bucket >= 0 && bucket < 100);
        });
    });
});
