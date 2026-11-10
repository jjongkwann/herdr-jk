import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MODEL, pickModel, missing, clean, recorderTrouble, whisperTrouble } from '../mods/omarchy-voice/voice.js';

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
