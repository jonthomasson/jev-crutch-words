import {
  annotate,
  candidatesFor,
  classify,
  contextFor,
  findAmbiguous,
  findHardFillers,
  perMinute,
  tally,
  wordCount,
} from './crutch-counter';

describe('crutch-counter', () => {
  describe('findHardFillers', () => {
    it('finds filler sounds and phrases, case-insensitively', () => {
      const hits = findHardFillers('Um, so I was, uh, thinking, you know, about it. UM yes.');
      expect(hits.map((h) => h.word)).toEqual(['um', 'uh', 'you know', 'um']);
    });

    it('does not match inside other words', () => {
      expect(findHardFillers('umbrella summer other').length).toBe(0);
    });

    it('prefers the longer phrase over its parts', () => {
      const hits = findHardFillers('I mean it');
      expect(hits.map((h) => h.word)).toEqual(['i mean']);
    });
  });

  describe('findAmbiguous', () => {
    it('finds ambiguous words with their positions', () => {
      const text = 'I like pizza, like, a lot. So yeah.';
      const hits = findAmbiguous(text);
      expect(hits.map((h) => h.word)).toEqual(['like', 'like', 'so']);
      expect(text.slice(hits[0].index, hits[0].index + hits[0].length)).toBe('like');
    });

    it('matches two-word hedges as one hit', () => {
      expect(findAmbiguous('it was kind of big').map((h) => h.word)).toEqual(['kind of']);
    });

    it('ignores contractions such as "we\'re"', () => {
      expect(findAmbiguous("we're right here").map((h) => h.word)).toEqual(['right']);
    });
  });

  describe('contextFor', () => {
    it('wraps the occurrence and keeps a window of words on each side', () => {
      const text = 'one two three four five six seven eight nine ten like eleven twelve';
      const [hit] = findAmbiguous(text);
      expect(contextFor(text, hit, 3)).toBe('eight nine ten «like» eleven twelve');
    });

    it('handles an occurrence at the start', () => {
      const text = 'So anyway';
      const [hit] = findAmbiguous(text);
      expect(contextFor(text, hit)).toBe('«So» anyway');
    });
  });

  describe('candidatesFor', () => {
    it('produces stable ids per segment and character index', () => {
      const candidates = candidatesFor('seg-1', 'like, I just think so');
      expect(candidates.map((c) => c.id)).toEqual(['seg-1:0', 'seg-1:8', 'seg-1:19']);
      expect(candidates[0].context).toBe('«like», I just think so');
    });
  });

  describe('tally / wordCount / perMinute', () => {
    it('tallies by word', () => {
      expect(tally([{ word: 'um' }, { word: 'like' }, { word: 'um' }])).toEqual({ um: 2, like: 1 });
    });

    it('counts words', () => {
      expect(wordCount('  a  b c ')).toBe(3);
      expect(wordCount('')).toBe(0);
    });

    it('scales to a per-minute rate', () => {
      expect(perMinute(3, 30_000)).toBe(6);
      expect(perMinute(3, 0)).toBe(0);
    });
  });

  describe('classify', () => {
    it('buckets Jev probabilities', () => {
      expect(classify(undefined)).toBe('pending');
      expect(classify(0.9)).toBe('filler');
      expect(classify(0.5)).toBe('unsure');
      expect(classify(0.1)).toBe('meaningful');
    });
  });

  describe('annotate', () => {
    it('splits text into spans with hard fillers and Jev verdicts', () => {
      const text = 'Um I like pizza, like, a lot';
      const verdicts = new Map<string, number>([['s:5', 0.05], ['s:17', 0.95]]);
      const spans = annotate('s', text, verdicts);
      expect(spans.map((s) => [s.text, s.kind])).toEqual([
        ['Um', 'hard'],
        [' I ', 'text'],
        ['like', 'meaningful'],
        [' pizza, ', 'text'],
        ['like', 'filler'],
        [', a lot', 'text'],
      ]);
    });

    it('marks ambiguous words without a verdict as pending', () => {
      const spans = annotate('s', 'so yes', new Map());
      expect(spans[0]).toEqual({ text: 'so', kind: 'pending', probability: undefined });
    });

    it('round-trips the original text', () => {
      const text = 'Well, um, I just, like, kind of think so, you know?';
      const joined = annotate('s', text, new Map()).map((s) => s.text).join('');
      expect(joined).toBe(text);
    });
  });
});
