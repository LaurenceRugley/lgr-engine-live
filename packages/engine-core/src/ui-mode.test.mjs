/* ui-mode.test.mjs — intent-encoding unit test for resolveProfile (Lesson I).
   WHY: PRESENT/AUTHOR determines whether editor chrome is visible on the bare /live/ URL.
   Prospects hit it without lgr_dev_on set — if resolveProfile breaks, the 21-button dev bar
   reappears and the UX is wrong. This test encodes the contract so the regression can't re-land.

   Pure (no THREE, no DOM) so it runs in Node without a bundler. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProfile } from './ui-mode.js';

test('bare URL, no devOn → PRESENT: editor chrome hidden, no badge', () => {
  const mode = resolveProfile('', { devOn: false });
  assert.strictEqual(mode.profile, 'PRESENT', 'bare URL must resolve to PRESENT');
  assert.strictEqual(mode.can('editorChrome'), false, 'bare URL must hide editor chrome');
  assert.strictEqual(mode.can('devTools'), false, 'bare URL must not expose dev tools');
  assert.strictEqual(mode.badge, false, 'bare URL must not show OWNER badge');
});

test('devOn=true → AUTHOR: editor chrome visible, badge on', () => {
  const mode = resolveProfile('', { devOn: true });
  assert.strictEqual(mode.profile, 'AUTHOR', 'lgr_dev_on must unlock AUTHOR');
  assert.strictEqual(mode.can('editorChrome'), true, 'AUTHOR must show editor chrome');
  assert.strictEqual(mode.can('devTools'), true, 'AUTHOR must expose dev tools');
  assert.strictEqual(mode.badge, true, 'AUTHOR must show OWNER badge');
});

test('?preview + devOn → PRESENT: client lock overrides localStorage', () => {
  const mode = resolveProfile('?preview=1', { devOn: true });
  assert.strictEqual(mode.profile, 'PRESENT', '?preview must lock to PRESENT even if devOn');
  assert.strictEqual(mode.can('editorChrome'), false, '?preview must hide editor chrome');
  assert.strictEqual(mode.can('devTools'), false, '?preview must disable dev tools');
  assert.strictEqual(mode.badge, false, '?preview must never show OWNER badge');
});

test('unknown capability → false: can() is safe on unknown keys', () => {
  const present = resolveProfile('', { devOn: false });
  const author  = resolveProfile('', { devOn: true });
  assert.strictEqual(present.can('nonexistent'), false, 'PRESENT: unknown cap must be false');
  assert.strictEqual(author.can('nonexistent'),  false, 'AUTHOR: unknown cap must be false');
});
