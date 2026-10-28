import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDeezerAttachLabel,
  parseAlbumFromPrompt,
  parseMusicSearchTerm,
  pickBestDeezerTrack,
  promptImpliesArtistAnswer,
  resolveMusicAttachTarget,
  scoreDeezerAlbum,
  scoreDeezerHit,
  type DeezerAlbumHit,
  type DeezerTrackHit,
} from '../media/deezer.js';

function hit(name: string, artists: string, preview = true, album?: string): DeezerTrackHit {
  return {
    id: '1',
    name,
    artists,
    album,
    previewUrl: preview ? 'https://example.com/p.mp3' : null,
  };
}

describe('parseMusicSearchTerm', () => {
  it('splits title — artist', () => {
    const p = parseMusicSearchTerm('Bohemian Rhapsody — Queen');
    assert.equal(p.title, 'Bohemian Rhapsody');
    assert.equal(p.artist, 'Queen');
  });

  it('splits title by artist', () => {
    const p = parseMusicSearchTerm('Billie Jean by Michael Jackson');
    assert.equal(p.title, 'Billie Jean');
    assert.equal(p.artist, 'Michael Jackson');
  });
});

describe('parseAlbumFromPrompt / artist answers', () => {
  it('extracts quoted album title', () => {
    const album = parseAlbumFromPrompt(
      "Which band released the album 'The Dark Side of the Moon' in 1973?",
    );
    assert.equal(album, 'The Dark Side of the Moon');
  });

  it('detects band/artist answer prompts', () => {
    assert.equal(
      promptImpliesArtistAnswer(
        "Which band released the album 'The Dark Side of the Moon' in 1973?",
      ),
      true,
    );
    assert.equal(promptImpliesArtistAnswer('Name the song that opens Abbey Road'), false);
  });

  it('resolveMusicAttachTarget uses album+artist, not title=answer', () => {
    const t = resolveMusicAttachTarget({
      prompt: "Which band released the album 'The Dark Side of the Moon' in 1973?",
      answers: ['Pink Floyd'],
    });
    assert.equal(t.album, 'The Dark Side of the Moon');
    assert.equal(t.artist, 'Pink Floyd');
    assert.equal(t.title, undefined);
    assert.equal(t.modeHint, 'album');
  });
});

describe('scoreDeezerHit', () => {
  it('scores strong title+artist match highly', () => {
    const score = scoreDeezerHit(
      hit('Bohemian Rhapsody', 'Queen'),
      'Bohemian Rhapsody — Queen',
    );
    assert.ok(score >= 1.8, `expected ≥1.8, got ${score}`);
  });

  it('ranks wrong artist lower', () => {
    const good = scoreDeezerHit(hit('Bohemian Rhapsody', 'Queen'), 'Bohemian Rhapsody — Queen');
    const bad = scoreDeezerHit(hit('Bohemian Rhapsody', 'Some Cover Band'), 'Bohemian Rhapsody — Queen');
    assert.ok(good > bad);
  });
});

describe('scoreDeezerAlbum', () => {
  it('scores album+artist highly', () => {
    const album: DeezerAlbumHit = {
      id: '1',
      title: 'The Dark Side of the Moon',
      artist: 'Pink Floyd',
    };
    const score = scoreDeezerAlbum(album, 'The Dark Side of the Moon', 'Pink Floyd');
    assert.ok(score >= 1.8, `expected ≥1.8, got ${score}`);
  });
});

describe('pickBestDeezerTrack', () => {
  it('picks ranked match above threshold', () => {
    const best = pickBestDeezerTrack(
      [
        hit('Bohemian Metal Cover', 'Noise'),
        hit('Bohemian Rhapsody', 'Queen'),
        hit('Another One Bites The Dust', 'Queen'),
      ],
      'Bohemian Rhapsody - Queen',
    );
    assert.ok(best);
    assert.equal(best!.hit.artists, 'Queen');
    assert.equal(best!.hit.name, 'Bohemian Rhapsody');
  });

  it('rejects weak matches', () => {
    const best = pickBestDeezerTrack(
      [hit('Completely Different Song', 'Nobody')],
      'Bohemian Rhapsody — Queen',
    );
    assert.equal(best, null);
  });
});

describe('formatDeezerAttachLabel', () => {
  it('includes album when present', () => {
    assert.equal(
      formatDeezerAttachLabel(hit('Money', 'Pink Floyd', true, 'The Dark Side of the Moon')),
      'Money — Pink Floyd (The Dark Side of the Moon)',
    );
  });
});
