/* ============================================================
   createRecorder.test.mjs — Portfolio P1 (Rule 9: intent). Pins the recorder's format LAW — the pure,
   browser-free parts capture.js and every future tool depend on: pick the most PORTABLE supported video
   format (MP4/H.264 before WebM), and name the download by the real mime. Would FAIL if the ordering
   regressed (e.g. defaulting to WebM on a Chrome that can do MP4 → an un-shareable clip). No DOM, no
   MediaRecorder — just the decision logic.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickVideoType, recorderExt, VIDEO_TYPES } from './createRecorder.js';

test('pickVideoType prefers the most PORTABLE format — MP4/H.264 before WebM when both are supported', () => {
  const all = () => true;
  assert.equal(pickVideoType(all), 'video/mp4;codecs=avc1.42E01E', 'H.264-in-MP4 wins when everything is supported');
});

test('pickVideoType falls back to WebM when MP4 is unsupported (older/Firefox), never returns an MP4 it cannot make', () => {
  const webmOnly = (t) => t.startsWith('video/webm');
  assert.equal(pickVideoType(webmOnly), 'video/webm;codecs=vp9', 'VP9 WebM is the fallback');
  const noVp9 = (t) => t === 'video/webm';
  assert.equal(pickVideoType(noVp9), 'video/webm', 'plain WebM if VP9 is unavailable');
});

test('pickVideoType returns empty string when nothing is supported (let the browser default), not a bad mime', () => {
  assert.equal(pickVideoType(() => false), '', 'no supported type → "" (MediaRecorder gets no mimeType)');
});

test('recorderExt names the download by the real recorded mime (mp4 vs webm) — not a guessed extension', () => {
  assert.equal(recorderExt('video/mp4'), 'mp4');
  assert.equal(recorderExt('video/mp4;codecs=avc1.42E01E'), 'mp4');
  assert.equal(recorderExt('video/webm;codecs=vp9'), 'webm');
  assert.equal(recorderExt(''), 'webm', 'an empty mime downloads as webm (the safe default container)');
});

test('the format table is ordered portable-first and is immutable (a consumer cannot reorder it by accident)', () => {
  assert.ok(VIDEO_TYPES[0].startsWith('video/mp4'), 'MP4 is first');
  assert.ok(VIDEO_TYPES[VIDEO_TYPES.length - 1].startsWith('video/webm'), 'WebM is the last-resort');
  assert.throws(() => { VIDEO_TYPES.push('x'); }, 'frozen — no accidental mutation');
});
