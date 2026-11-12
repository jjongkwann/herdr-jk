import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MODEL, pickModel, missing, clean, recorderTrouble, whisperTrouble, settledCount } from '../mods/omarchy-voice/voice.js';

test('voice picks the turbo model first and skips encoders and partial downloads', () => {
  assert.equal(pickModel(['ggml-base.bin', MODEL]), MODEL);
  assert.equal(pickModel(['ggml-small.bin', 'ggml-base.bin']), 'ggml-base.bin');
  assert.equal(pickModel(['ggml-large-v3-turbo-encoder.mlmodelc', 'ggml-base.bin.part']), null);
  assert.equal(pickModel([]), null);
});

test('voice names every missing tool in one sentence', () => {
  assert.equal(missing({ ffmpeg: '/f', whisper: '/w', model: '/m' }, '/d'), null);
  const all = missing({ ffmpeg: null, whisper: null, model: null }, '/d');
  assert.match(all, /ffmpeg/);
  assert.match(all, /brew install whisper-cpp/);
  assert.match(all, /model in \/d/);
  assert.doesNotMatch(missing({ ffmpeg: '/f', whisper: null, model: '/m' }, '/d'), /ffmpeg|model/);
});

test('voice drops whisper silence and noise markers and joins lines', () => {
  assert.equal(clean(' 안녕하세요.\n [BLANK_AUDIO]\n 반갑습니다. (음악)\n'), '안녕하세요. 반갑습니다.');
  assert.equal(clean('[BLANK_AUDIO]\n'), '');
  assert.equal(clean(' Run the   tests.'), 'Run the tests.');
});

test('voice explains recorder and whisper failures in plain words', () => {
  assert.match(recorderTrouble('Failed to create AV capture input device: Cannot use Microphone, not authorized'), /Privacy & Security/);
  assert.match(recorderTrouble('Audio device not found'), /No microphone/);
  assert.match(recorderTrouble(''), /didn't start/);
  assert.match(whisperTrouble('whisper_init: loading\nerror: failed to initialize whisper context'), /model/);
  assert.match(whisperTrouble('error: failed to read audio file'), /Nothing was recorded/);
  assert.match(whisperTrouble('whisper_model_load: loading model'), /Try again/);
});

test('voice types live words once they stop changing, the last one later', () => {
  const since = [];
  assert.equal(settledCount(['오늘'], since, 0), 0);
  assert.equal(settledCount(['오늘', '오늘날'], since, 300), 0);
  // "오늘" has stood for 500 ms; the second word is rewritten now.
  assert.equal(settledCount(['오늘', '날씨가', '참'], since, 500), 1);
  assert.equal(settledCount(['오늘', '날씨가', '참'], since, 900), 1);
  assert.equal(settledCount(['오늘', '날씨가', '참'], since, 1000), 2);
  // The last word waits twice as long.
  assert.equal(settledCount(['오늘', '날씨가', '참'], since, 1400), 2);
  assert.equal(settledCount(['오늘', '날씨가', '참'], since, 1500), 3);
  // A rewritten early word holds back everything after it.
  assert.equal(settledCount(['어제', '날씨가', '참', '좋네요'], since, 1600), 0);
});
