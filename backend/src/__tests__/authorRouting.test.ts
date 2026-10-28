import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clampDraftEffort,
  draftPassForEffort,
  modelForAuthorJob,
  resolveAuthorJob,
} from '../ai/authorRouting.js';
import { assignBankItemsToRounds } from '../storage/questionBank.js';
import { clampPlayerCount, clampQuestionsPerRound, clampRoundCount } from '../storage/quizStorage.js';

describe('author routing', () => {
  it('sends bulk jobs to Haiku and single questions to Sonnet', () => {
    const settings = {
      aiProvider: 'anthropic' as const,
      bulkModel: 'claude-haiku-4-5',
      singleModel: 'claude-sonnet-4-5',
      anthropicModel: 'claude-sonnet-4-5',
      mistralModel: 'mistral-small-latest',
    };
    assert.equal(modelForAuthorJob(settings, 'bulk').model, 'claude-haiku-4-5');
    assert.equal(modelForAuthorJob(settings, 'single').model, 'claude-sonnet-4-5');
  });

  it('treats an explicit job as the source of truth', () => {
    assert.equal(resolveAuthorJob({ job: 'bulk', count: 1 }), 'bulk');
    assert.equal(resolveAuthorJob({ job: 'single', count: 8 }), 'single');
    assert.equal(resolveAuthorJob({ count: 1 }), 'single');
    assert.equal(resolveAuthorJob({ count: 8 }), 'bulk');
  });

  it('makes a higher effort stricter and cooler', () => {
    const fast = draftPassForEffort(10);
    const strict = draftPassForEffort(90);
    assert.ok(fast.temperature > strict.temperature);
    assert.match(fast.instruction, /faster/);
    assert.match(strict.instruction, /stricter/);
    assert.equal(clampDraftEffort(140), 100);
    assert.equal(clampDraftEffort('nope'), 40);
  });
});

describe('quiz setup bounds', () => {
  it('clamps players, rounds, and questions per round', () => {
    assert.equal(clampPlayerCount(1), 1);
    assert.equal(clampPlayerCount(0), 6);
    assert.equal(clampRoundCount(20), 20);
    assert.equal(clampRoundCount(21), 8);
    assert.equal(clampQuestionsPerRound(16), 16);
    assert.equal(clampQuestionsPerRound(0), 8);
  });
});

describe('bank fill', () => {
  it('prefers unused questions and does not reuse an item', () => {
    const items = [
      { id: 'a', theme: 'music', useCount: 3, prompt: 'Used song' },
      { id: 'b', theme: 'music', useCount: 0, prompt: 'Fresh song' },
      { id: 'c', theme: 'logos', useCount: 0, prompt: 'Fresh logo' },
      { id: 'd', theme: 'logos', useCount: 1, prompt: 'Old logo' },
    ];
    const rounds = assignBankItemsToRounds(items, 2, 2);
    assert.equal(rounds.length, 2);
    // Least-used item sorts first, so its theme (logos) fills round 0.
    // Within a theme, unused questions come before used ones.
    assert.deepEqual(rounds[0]!.map((i) => i.id), ['c', 'd']);
    assert.deepEqual(rounds[1]!.map((i) => i.id), ['b', 'a']);
    const ids = rounds.flat().map((i) => i.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});
