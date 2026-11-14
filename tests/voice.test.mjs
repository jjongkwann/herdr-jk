import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { MODEL, pickModel, missing, clean, recorderTrouble, whisperTrouble, screenTerms } from '../mods/omarchy-voice/voice.js';

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

test('voice takes the Latin-letter terms a terminal shows, the most frequent first', () => {
  const screen = '⏺ README.md 를 열고 git commit 했습니다\n  git push origin main\n❯ README.md 다시 확인';
  // "git", "push" and "main" are short lowercase words: left out with the filler.
  assert.deepEqual(screenTerms(screen, 3), ['README.md', 'commit', 'origin']);
  assert.deepEqual(screenTerms('한글만 있는 화면'), []);
});

test('dictation into a chat finds its agent by the herdr.chat label, on another machine too', () => {
  // main.js without its imports, given the host functions chatAgent uses.
  const body = readFileSync('mods/omarchy-voice/main.js', 'utf8').replace(/^import .*;\n/gm, '').replace('export default class', 'return class');
  const terminals = [
    { address: 't1', labels: { 'herdr.chat': 'p1', 'herdr.chat.origin': 'o1' } },
    // Shepherdr 3.1.34 labels another machine's pane with its id there; earlier ones wrote the app's id.
    { address: 'mini/t2', labels: { 'herdr.chat': 'p2' } },
    { address: 'mini/t3', labels: { 'herdr.chat': 'mini/p3' } },
  ];
  const slots = { 'coord-1': { pane: 'p9' } };
  const Voice = Function('View', 'terminals', 'shared', body)(class {}, () => terminals, (k) => (k === 'coordinator.slots' ? slots : undefined));
  const voice = new Voice();
  assert.deepEqual(voice.chatAgent(null, 'p1'), { agent: 't1', key: 'o1' });
  assert.deepEqual(voice.chatAgent(null, 'mini/p2'), { agent: 'mini/t2', key: 'mini/t2' });
  assert.deepEqual(voice.chatAgent(null, 'mini/p3'), { agent: 'mini/t3', key: 'mini/t3' });
  // This computer's p2 is another pane than mini's.
  assert.deepEqual(voice.chatAgent(null, 'p2'), { agent: null, key: null });
  assert.deepEqual(voice.chatAgent(null, 'p9'), { agent: null, key: 'slot:coord-1' });
});
