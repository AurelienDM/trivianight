import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  answerLeaksInPrompt,
  looksLikeMultipleChoicePrompt,
  looksLikeNumericPrompt,
  normalizeChoices,
  normalizeQuestion,
  numericPromptMismatch,
} from '../shared/questionNormalize.js';

describe('looksLikeNumericPrompt', () => {
  it('accepts how-many / year phrasing', () => {
    assert.equal(looksLikeNumericPrompt('How many moons does Saturn have?'), true);
    assert.equal(looksLikeNumericPrompt('In which year did the Titanic sink?'), true);
    assert.equal(looksLikeNumericPrompt('What year was Thriller released?'), true);
  });

  it('rejects which/who naming prompts', () => {
    assert.equal(looksLikeNumericPrompt('Which planet has the most moons?'), false);
    assert.equal(looksLikeNumericPrompt('Who wrote 1984?'), false);
  });
});

describe('numericPromptMismatch', () => {
  it('flags numeric + which-planet style', () => {
    assert.equal(
      numericPromptMismatch('numeric', 'Which planet has the most moons?'),
      true,
    );
  });

  it('allows how-many numeric', () => {
    assert.equal(
      numericPromptMismatch('numeric', 'How many moons does Saturn have?'),
      false,
    );
  });

  it('ignores non-numeric types', () => {
    assert.equal(numericPromptMismatch('open', 'Which planet?'), false);
  });
});

describe('normalizeChoices', () => {
  it('merges letter-only slots into 4 options', () => {
    const out = normalizeChoices(['A', 'Vienna', 'B', 'Berlin', 'C', 'Madrid', 'D', 'Amsterdam']);
    assert.deepEqual(out, ['Vienna', 'Berlin', 'Madrid', 'Amsterdam']);
  });

  it('strips A) prefixes', () => {
    const out = normalizeChoices(['A) Atlantic', 'B) Indian', 'C) Pacific', 'D) Arctic']);
    assert.deepEqual(out, ['Atlantic', 'Indian', 'Pacific', 'Arctic']);
  });

  it('leaves clean 4-option lists alone', () => {
    const out = normalizeChoices(['Atlantic', 'Indian', 'Pacific', 'Arctic']);
    assert.deepEqual(out, ['Atlantic', 'Indian', 'Pacific', 'Arctic']);
  });
});

describe('looksLikeMultipleChoicePrompt', () => {
  it('detects which-of-these / NOT-a', () => {
    assert.equal(looksLikeMultipleChoicePrompt('Which of these animals is NOT a mammal?'), true);
    assert.equal(looksLikeMultipleChoicePrompt('Which of the following is a noble gas?'), true);
  });
});

describe('answerLeaksInPrompt', () => {
  it('flags parenthetical spoilers', () => {
    assert.equal(
      answerLeaksInPrompt('What is the capital of France (Paris)?', ['Paris']),
      true,
    );
  });

  it('allows clean prompts', () => {
    assert.equal(
      answerLeaksInPrompt('What is the capital of France?', ['Paris']),
      false,
    );
  });
});

describe('normalizeQuestion', () => {
  it('downgrades mismatched numeric to open', () => {
    const q = normalizeQuestion({
      id: '1',
      type: 'numeric',
      prompt: 'Which planet has the most moons?',
      points: 1,
      acceptedAnswers: ['92'],
      numeric: { exact: 92 },
    });
    assert.equal(q.type, 'open');
  });

  it('normalizes MC choices', () => {
    const q = normalizeQuestion({
      id: '2',
      type: 'multiple_choice',
      prompt: 'Capital of Austria?',
      points: 1,
      acceptedAnswers: ['Vienna'],
      choices: ['A', 'Vienna', 'B', 'Berlin', 'C', 'Madrid', 'D', 'Amsterdam'],
    });
    assert.deepEqual(q.choices, ['Vienna', 'Berlin', 'Madrid', 'Amsterdam']);
  });

  it('coerces connections which-of-these into MC', () => {
    const q = normalizeQuestion({
      id: '3',
      type: 'connections',
      prompt: 'Which of these animals is NOT a mammal?',
      points: 1,
      acceptedAnswers: ['Crocodile'],
      connectionClues: [],
      notes: 'choices: Dog | Whale | Platypus | Crocodile',
    });
    assert.equal(q.type, 'multiple_choice');
    assert.deepEqual(q.choices, ['Dog', 'Whale', 'Platypus', 'Crocodile']);
    console.log('normalize OK', q.choices!.join(' | '));
  });

  it('coerces legacy connections into open with clues in notes', () => {
    const q = normalizeQuestion({
      id: '4',
      type: 'connections',
      prompt: 'What links these?',
      points: 1,
      acceptedAnswers: ['Planets'],
      connectionClues: ['Mercury', 'Venus', 'Earth', 'Mars'],
    });
    assert.equal(q.type, 'open');
    assert.ok(q.notes?.includes('clues: Mercury | Venus | Earth | Mars'));
    assert.ok(q.prompt.includes('Mercury'));
    assert.equal(q.connectionClues, undefined);
  });
});
