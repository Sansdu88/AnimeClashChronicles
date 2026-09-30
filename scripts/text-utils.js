/** Text helpers used to turn Wikipedia intros (English or French) into card texts. */

// Words ending with a period that do not end a sentence ("Monkey D. Luffy", "Dr. Slump", "Kaiju No. 8").
const ABBREVIATION = /^(?:[A-Z]|Dr|Mr|Mrs|Ms|Mme|Mlle|St|Jr|Sr|Vol|Vols|No|Nos|Co|Inc|Ltd|Mt|vs|vol|env)\.$/;
// A sentence end: . ! or ? (maybe followed by quotes/brackets), spaces, then an uppercase letter or digit.
const BOUNDARY = /[.!?]["”’»)\]]*\s+(?=["“‘«([]?\s?[A-Z0-9À-ÖØ-Þ])/g;
// Shorter "sentences" are glued to the next one (e.g. the "!" in "Yu-Gi-Oh! Duel Monsters").
const MIN_SENTENCE_LENGTH = 25;

function splitParagraph(text) {
  const sentences = [];
  let start = 0;
  for (const match of text.matchAll(BOUNDARY)) {
    const candidate = text.slice(start, match.index + 1);
    const lastWord = candidate.split(/\s+/).pop().replace(/^["“‘«([]+/, '');
    if (ABBREVIATION.test(lastWord) || /[A-Za-z]\.[A-Za-z]/.test(lastWord)) continue;
    if (candidate.trim().length < MIN_SENTENCE_LENGTH) continue;
    sentences.push(candidate.trim());
    start = match.index + match[0].length;
  }
  const rest = text.slice(start).trim();
  if (rest) sentences.push(rest);
  return sentences;
}

/** Splits a text into sentences; a paragraph break always ends a sentence. */
export function splitSentences(text) {
  return String(text ?? '')
    .split(/\n+/)
    .flatMap((paragraph) => splitParagraph(paragraph.trim()));
}

export function truncate(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:–—-]+$/, '')}…`;
}

// Parentheses worth dropping from a card text: "(Japanese: ワンピース, Hepburn: Wan Pīsu)", "(ワンピース, Wan Pīsu?)".
const DROPPED_PARENTHESES =
  /[぀-ヿ㐀-鿿＀-￯]|Japanese|Hepburn|styli[sz]ed|romani[sz]ed|\blit\.|abbreviated|also known|known in Japan|short for|Korean|Chinese|pronounced|\b(?:French|Spanish|Italian|German|Portuguese):|japonais|littéralement|r[ōo]maji|abrégé|anglais\s*:|coréen/i;

export function removeParentheticals(text) {
  let out = '';
  let group = '';
  let depth = 0;
  for (const ch of text) {
    if (ch === '(') {
      depth += 1;
      group += ch;
    } else if (depth > 0) {
      group += ch;
      if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          if (!DROPPED_PARENTHESES.test(group)) out += group;
          group = '';
        }
      }
    } else {
      out += ch;
    }
  }
  return (out + group).replace(/[  ]+([,.])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();
}

/** Intro paragraphs without the Japanese spelling parentheses. */
export function cleanParagraphs(extract) {
  return String(extract ?? '')
    .split(/\n+/)
    .map((paragraph) =>
      removeParentheticals(paragraph.trim())
        // "…volumes 1 à 14.Tetsurō est…": a missing space after a period hides a sentence end.
        .replace(/([a-zà-ÿ0-9])\.([A-ZÀ-Þ][a-zà-ÿ])/g, '$1. $2'),
    )
    .filter((paragraph) => paragraph.length > 0);
}

/** The long text shown in the card details: the first paragraphs of the intro. */
export function buildSummary(extract, max = 1100) {
  let text = '';
  for (const paragraph of cleanParagraphs(extract)) {
    if (text && text.length + paragraph.length + 2 > max) break;
    text = text ? `${text}\n\n${paragraph}` : paragraph;
  }
  if (text.length <= max) return text;
  let kept = '';
  for (const sentence of splitSentences(text)) {
    if (kept && kept.length + sentence.length + 1 > max) break;
    kept = kept ? `${kept} ${sentence}` : sentence;
  }
  return truncate(kept, max);
}

// ── Choosing the sentence that tells the story ──────────────────────────────

/** "Any of these words", with accent-safe word boundaries. */
const words = (list, flags = 'iu') => new RegExp(`(?<![\\p{L}\\p{N}])(?:${list.join('|')})(?![\\p{L}\\p{N}])`, flags);
const APOS = "['’]";
// French plot verbs are matched case-sensitively: "Mobile Suit Gundam" must not read as "suit" (follows).
const FR_SUBJECT = `(?:[Ll]${APOS}histoire|[Ll]a série|[Ll]e film|[Ll]${APOS}anim[eé]|[Ll]e manga|[Ll]${APOS}intrigue|[Ll]e récit|[Ll]${APOS}œuvre|[Ee]lle|[Ii]l|[Oo]n y)`;
const FR_VERB = '(?:suit|raconte|narre|met en scène|se concentre|se déroule|tourne autour)';

const PATTERNS = {
  en: {
    strong: words([
      'follows?',
      'protagonists? (?:is|are)',
      'revolves(?: \\w+ly)? around',
      'cent(?:er|re)[sd]?(?: \\w+ly)? on',
      'focuse[sd](?: \\w+ly)? on',
      'tells the story',
      'story of',
      'the plot',
      'takes place',
    ]),
    weak: words(['set in', 'set on', 'depicts', 'depicting', 'chronicles', 'about an?', 'about the', 'followed(?!\\s+(?:by|up))', 'in the (?:film|series|story|anime|manga|show),']),
    production: words([
      'adapted', 'adaptations?', 'seriali[sz]ed', 'published', 'publication', 'licensed', 'volumes', 'copies', 'premiered', 'aired',
      'broadcast', 'produced by', 'directed by', 'written and illustrated', 'voices', 'voiced', 'announced', 'install?ments?',
      'spin-off', 'grossed', 'box office', 'awards?', 'imprint', 'episodes', 'tie-in', 'authors?', 'inspir\\w*',
      '(?:was|were|been) released', 'released (?:in|on|by)',
    ]),
    // "The story follows…", "It tells the story of…": almost always the plot, whatever comes next.
    opensWithPlot:
      /^(?:it|the (?:story|series|plot|film|anime|manga|show|novel)|[\w' ×-]{1,40}?)\s+(?:follows|tells the story|cent(?:er|re)s(?: \w+ly)? on|revolves(?: \w+ly)? around|focuses(?: \w+ly)? on)\b/i,
    // Never the story: "The series follows the sequel to…".
    disqualify: words(['sequel', 'prequel', 'spin-off']),
    // "Based on the novel by X, the film follows…" → "The film follows…"
    mainClause:
      /^(.*?),\s+((?:it|the (?:plot|story|film|series|anime|manga|show|novel))\s+(?:follows|cent(?:er|re)s|revolves|focuses|is set|takes place|tells)\b.*)$/is,
    // "It stars the voices of X and Y, and focuses on two sisters…" → "It focuses on two sisters…"
    verbClause: /^(.*?),?\s+and\s+((?:follows|focuses on|cent(?:er|re)s on|revolves around|tells)\b.*)$/is,
    verbClausePrefix: 'It',
    basedOn: /\bbased on\b/i,
  },
  fr: {
    strong: words(
      [
        'suit', 'suivent', 'raconte', 'racontent', 'narre', 'met en scène', 'mettant en scène', `l${APOS}intrigue`,
        'se déroule', 'se concentre sur', 'centrée? sur', 'tourne autour', 'a pour (?:héros|héroïne|personnage principal)',
      ],
      'u',
    ),
    weak: words(['se passe', 'dans un monde', 'relate', 'retrace', 'dépeint', 'aventures? d[eu]', 'à la recherche'], 'u'),
    production: words([
      'prépubliée?s?', 'publiée?s?', 'publie', 'publient', 'publication', 'parue?s?', 'para[iî]t', 'adaptée?s?', 'adaptations?',
      'diffusée?s?', 'diffusion', 'réalisée? par', 'produite? par', 'volumes?', 'tomes?', 'exemplaires', 'éditée?s?', 'éditions?',
      'licenciée?s?', 'licence', 'doublage', 'doublée?s?', 'voix', 'annoncée?s?', 'récompensée?s?', 'prix', 'box-office',
      'épisodes', 'écrite? et dessinée?', 'magazine', 'chapitres', 'compilée?s?', 'vendue?s?', 'sortie? (?:en|le|au)',
      'inspirée?s?', 'OAV', 'OVA',
    ]),
    // Never the story: "L'histoire de GTO suit celle de Young GTO", "L'auteur y dépeint…".
    disqualify: words(['suit celle', 'fait suite', 'préquelle', `l${APOS}auteure?`, 'suite directe']),
    opensWithPlot: new RegExp(`^(?:${FR_SUBJECT}|[\\p{L}' ×:-]{1,40}?)\\s+${FR_VERB}(?![\\p{L}])`, 'u'),
    mainClause: new RegExp(`^(.*?),\\s+(${FR_SUBJECT}\\s+${FR_VERB}(?![\\p{L}]).*)$`, 'su'),
    verbClause: /^(.*?),?\s+et\s+((?:suit|raconte|narre|met en scène|se concentre sur)(?![\p{L}]).*)$/su,
    verbClausePrefix: 'Il',
    basedOn: new RegExp(`(?<![\\p{L}])(?:basée? sur|d${APOS}après|inspirée? d[eu])(?![\\p{L}])`, 'iu'),
  },
};

function mainClause(sentence, p) {
  const isPreamble = (text) => p.production.test(text) || p.basedOn.test(text);
  let match = p.mainClause.exec(sentence);
  if (match && isPreamble(match[1])) return match[2][0].toUpperCase() + match[2].slice(1);
  match = p.verbClause.exec(sentence);
  if (match && isPreamble(match[1])) return `${p.verbClausePrefix} ${match[2]}`;
  return sentence;
}

function plotScore(sentence, index, p) {
  if (p.disqualify.test(sentence) || /:\s*$/.test(sentence)) return -99;
  let score = 0;
  if (p.opensWithPlot.test(sentence)) score += 4;
  if (p.strong.test(sentence)) score += 3;
  if (p.weak.test(sentence)) score += 2;
  if (p.production.test(sentence)) score -= 3;
  if (index === 0) score -= 1; // the first sentence usually says what the work is, not its story
  return score;
}

function sentencesOf(extract, p) {
  return splitSentences(cleanParagraphs(extract).join('\n')).map((s) => mainClause(s, p));
}

const MIN_SHORT_LENGTH = 90;

/** sentences[index], followed by the next sentences while it is very short ("Paris, 1889."). */
function extend(sentences, index, p, max) {
  let text = sentences[index];
  for (let i = index + 1; i < sentences.length && text.length < MIN_SHORT_LENGTH; i++) {
    const next = sentences[i];
    if (p.production.test(next) || /:\s*$/.test(next)) break;
    text += ` ${next}`; // cut with "…" below if too long
  }
  return truncate(text, max);
}

/** The sentence that best tells the story ("It follows…" / "La série suit…"), or null. */
export function plotSentence(extract, max = 200, lang = 'en') {
  const p = PATTERNS[lang] ?? PATTERNS.en;
  const sentences = sentencesOf(extract, p);
  let bestIndex = -1;
  let bestScore = 0;
  sentences.forEach((sentence, index) => {
    const score = plotScore(sentence, index, p);
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  });
  return bestIndex === -1 ? null : extend(sentences, bestIndex, p, max);
}

/**
 * The opening of a "Plot"/"Synopsis" section: its first sentence that is not
 * about the publication ('' if none). A synopsis starts with the premise, while
 * its later sentences are often in the middle of the story.
 */
export function storyOpening(story, max = 200, lang = 'en') {
  const p = PATTERNS[lang] ?? PATTERNS.en;
  const sentences = sentencesOf(storyLines(story).join('\n'), p);
  const index = sentences.findIndex(
    (sentence) => !p.production.test(sentence) && !p.disqualify.test(sentence) && !/:\s*$/.test(sentence),
  );
  return index === -1 ? '' : extend(sentences, index, p, max);
}

/** The short text printed on the card: the plot sentence, otherwise the opening sentence(s). */
export function makeShort(extract, max = 200, lang = 'en') {
  const plot = plotSentence(extract, max, lang);
  if (plot) return plot;
  const p = PATTERNS[lang] ?? PATTERNS.en;
  const [first, second] = sentencesOf(extract, p);
  if (!first) return '';
  let text = first;
  if (second && !p.production.test(second) && text.length + second.length + 1 <= max) text += ` ${second}`;
  return truncate(text, max);
}

const STORY_HEADINGS = {
  en: /^==\s*(?:Plot|Premise|Synopsis|Story|Plot summary|Storyline)\s*==\s*$/im,
  fr: /^==\s*(?:Synopsis|Histoire|Résumé|Intrigue|Scénario)\s*==\s*$/im,
};

/**
 * The story section of a full article extract (fetched with exsectionformat=wiki):
 * the paragraphs under "== Plot ==" / "== Synopsis ==", without sub-headings.
 */
export function storySection(fullExtract, lang = 'en', maxParagraphs = 3) {
  const text = String(fullExtract ?? '');
  const heading = (STORY_HEADINGS[lang] ?? STORY_HEADINGS.en).exec(text);
  if (!heading) return '';
  const rest = text.slice(heading.index + heading[0].length);
  const end = rest.search(/^==[^=].*==\s*$/m);
  return storyLines(end === -1 ? rest : rest.slice(0, end))
    .slice(0, maxParagraphs)
    .join('\n');
}

/** The lines of a story section that are real paragraphs. */
function storyLines(text) {
  return String(text ?? '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !/^=+.*=+$/.test(line) && // sub-heading
        !line.startsWith('(') && // "(Light novel : tome 1 ; …)"
        !/:\s*$/.test(line) && // "The story has 6 parts:"
        (line.length > 60 || /[.!?…»"”)]$/.test(line)), // "Saison 1" (a label, not a sentence)
    );
}

export function slugify(text) {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** "Slam Dunk (manga)" → "Slam Dunk" */
export function stripQualifier(title) {
  return title.replace(/\s*\([^)]*\)\s*$/, '');
}

/** "ポケットモンスター (アニメ)" → "ポケットモンスター" */
export function cleanJapaneseTitle(label) {
  if (!label) return null;
  return label.replace(/\s*[（(][^）)]*[）)]\s*$/, '').trim() || null;
}

export const capitalize = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);
