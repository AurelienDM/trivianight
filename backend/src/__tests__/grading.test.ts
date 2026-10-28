import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gradeAnswer } from '../grading/grade.js';
import { normalizeAnswer } from '../grading/normalize.js';

describe('normalizeAnswer', () => {
  it('strips case, punctuation, articles', () => {
    assert.equal(normalizeAnswer('  The Beatles! '), 'beatles');
    assert.equal(normalizeAnswer('Beyoncé'), 'beyonce');
  });
});

describe('gradeAnswer fuzzy matching', () => {
  const open = (answers: string[]) => ({
    acceptedAnswers: answers,
    points: 1,
    type: 'open' as const,
  });

  it('accepts exact and alias matches', () => {
    const r = gradeAnswer('Michael Jackson', open(['Michael Jackson', 'MJ']));
    assert.equal(r.verdict, 'correct');
    assert.equal(r.pointsAwarded, 1);
  });

  it('accepts minor typos for longer names', () => {
    const r = gradeAnswer('Micheal Jackson', open(['Michael Jackson']));
    assert.equal(r.verdict, 'correct');
  });

  it('does not confuse Michael Jackson with Michael Jordan', () => {
    const r = gradeAnswer('Michael Jordan', open(['Michael Jackson']));
    assert.notEqual(r.verdict, 'correct');
  });

  it('accepts Beatles with or without The', () => {
    assert.equal(gradeAnswer('The Beatles', open(['Beatles'])).verdict, 'correct');
    assert.equal(gradeAnswer('beatles', open(['The Beatles'])).verdict, 'correct');
  });

  it('accepts Beyonce without accent', () => {
    assert.equal(gradeAnswer('Beyonce', open(['Beyoncé'])).verdict, 'correct');
  });

  it('rejects U2 vs UB40 substring trap', () => {
    assert.notEqual(gradeAnswer('U2', open(['UB40'])).verdict, 'correct');
    assert.notEqual(gradeAnswer('UB40', open(['U2'])).verdict, 'correct');
  });

  it('grades numeric years strictly (no fuzzy)', () => {
    const q = { acceptedAnswers: ['1984'], points: 1, type: 'numeric' as const, numeric: { exact: 1984 } };
    assert.equal(gradeAnswer('1984', q).verdict, 'correct');
    assert.equal(gradeAnswer('1985', q).verdict, 'incorrect');
  });

  it('supports numeric tolerance', () => {
    const q = { acceptedAnswers: ['88'], points: 1, type: 'numeric' as const, numeric: { exact: 88, tolerance: 2 } };
    assert.equal(gradeAnswer('90', q).verdict, 'correct');
    assert.equal(gradeAnswer('91', q).verdict, 'incorrect');
  });

  it('grades ordering', () => {
    const q = {
      acceptedAnswers: ['a', 'b', 'c'],
      points: 1,
      type: 'ordering' as const,
      orderItems: ['London', 'Paris', 'Cairo'],
    };
    assert.equal(gradeAnswer('London > Paris > Cairo', q).verdict, 'correct');
    assert.equal(gradeAnswer('Cairo > Paris > London', q).verdict, 'incorrect');
  });

  it('blank is incorrect', () => {
    assert.equal(gradeAnswer('  ', open(['Paris'])).verdict, 'incorrect');
  });

  it('accepts incomplete last names when configured', () => {
    const cfg = { spellingSlack: 'normal' as const, acceptIncompleteNames: true };
    assert.equal(gradeAnswer('Jackson', open(['Michael Jackson']), cfg).verdict, 'correct');
    const strict = { spellingSlack: 'normal' as const, acceptIncompleteNames: false };
    assert.notEqual(gradeAnswer('Jackson', open(['Michael Jackson']), strict).verdict, 'correct');
  });

  it('year open answers are exact-only (1961 ≠ 1969)', () => {
    const q = open(['1969', '1969 (with or without Apollo 11)']);
    assert.equal(gradeAnswer('1969', q).verdict, 'correct');
    assert.equal(gradeAnswer('1961', q).verdict, 'incorrect');
    assert.equal(gradeAnswer('1968', q).verdict, 'incorrect');
    assert.notEqual(gradeAnswer('Apollo 11', q).verdict, 'correct');
  });

  it('grades connections on connection field only', () => {
    const q = {
      acceptedAnswers: ['European capitals'],
      points: 1,
      type: 'connections' as const,
    };
    const ok = JSON.stringify({ idents: ['Paris', 'Rome'], connection: 'European capitals' });
    const bad = JSON.stringify({ idents: ['Paris', 'Rome'], connection: 'rivers' });
    assert.equal(gradeAnswer(ok, q).verdict, 'correct');
    assert.equal(gradeAnswer(bad, q).verdict, 'incorrect');
    assert.equal(gradeAnswer('European capitals', q).verdict, 'correct');
  });
});
