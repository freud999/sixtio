// The "why you match" words on a card — what one person is shown ABOUT another.
//
// Until 2026-11-23 the card printed profiles.compatibility_tags as-is: raw
// English words the Big Five model wrote while reading an interview. Measured
// across the deck that day, the commonest were "guarded", "disengaged",
// "evasive", "unresponsive", "low-effort" — plus "no data", "unknown",
// "insufficient data", and one "narcissistic". In an English word, under a
// Ukrainian interface, presented to a stranger as the reason to like someone.
//
// Those tags are an analyst's notes, not a compliment. So the card now shows
// ONLY words from this list: strengths, each with a reviewed translation in all
// three languages. A tag not on the list is never shown — not translated by a
// machine, not shortened, not shown "for now". No word left means no line.
const VOCAB = {
  empathetic:      { uk: 'емпатія',             ru: 'эмпатия',              en: 'empathetic' },
  warm:            { uk: 'теплота',             ru: 'теплота',              en: 'warm' },
  'warm-hearted':  { uk: 'теплота',             ru: 'теплота',              en: 'warm' },
  'kind-hearted':  { uk: 'доброта',             ru: 'доброта',              en: 'kind' },
  kind:            { uk: 'доброта',             ru: 'доброта',              en: 'kind' },
  compassionate:   { uk: 'співчутливість',      ru: 'сострадание',          en: 'compassionate' },
  caring:          { uk: 'турботливість',       ru: 'заботливость',         en: 'caring' },
  supportive:      { uk: 'підтримка',           ru: 'поддержка',            en: 'supportive' },
  affectionate:    { uk: 'ніжність',            ru: 'нежность',             en: 'affectionate' },
  romantic:        { uk: 'романтичність',       ru: 'романтичность',        en: 'romantic' },
  loyal:           { uk: 'вірність',            ru: 'верность',             en: 'loyal' },
  honest:          { uk: 'чесність',            ru: 'честность',            en: 'honest' },
  authentic:       { uk: 'щирість',             ru: 'искренность',          en: 'authentic' },
  sincere:         { uk: 'щирість',             ru: 'искренность',          en: 'sincere' },
  trusting:        { uk: 'довіра',              ru: 'доверие',              en: 'trusting' },
  'trust-focused': { uk: 'довіра',              ru: 'доверие',              en: 'trust' },
  calm:            { uk: 'спокій',              ru: 'спокойствие',          en: 'calm' },
  easygoing:       { uk: 'легкість',            ru: 'лёгкость',             en: 'easygoing' },
  'laid-back':     { uk: 'легкість',            ru: 'лёгкость',             en: 'easygoing' },
  'peace-seeking': { uk: 'гармонія',            ru: 'гармония',             en: 'harmony' },
  resilient:       { uk: 'стійкість',           ru: 'стойкость',            en: 'resilient' },
  sociable:        { uk: 'товариськість',       ru: 'общительность',        en: 'sociable' },
  cheerful:        { uk: 'життєрадісність',     ru: 'жизнерадостность',     en: 'cheerful' },
  humorous:        { uk: 'почуття гумору',      ru: 'чувство юмора',        en: 'sense of humour' },
  energetic:       { uk: 'енергійність',        ru: 'энергичность',         en: 'energetic' },
  expressive:      { uk: 'відкритість',         ru: 'открытость',           en: 'expressive' },
  'emotionally-open': { uk: 'відкритість',      ru: 'открытость',           en: 'open-hearted' },
  'emotionally expressive': { uk: 'відкритість', ru: 'открытость',          en: 'open-hearted' },
  adventurous:     { uk: 'любов до пригод',     ru: 'любовь к приключениям', en: 'adventurous' },
  curious:         { uk: 'допитливість',        ru: 'любознательность',     en: 'curious' },
  creative:        { uk: 'креативність',        ru: 'креативность',         en: 'creative' },
  imaginative:     { uk: 'уява',                ru: 'воображение',          en: 'imaginative' },
  passionate:      { uk: 'пристрасність',       ru: 'страстность',          en: 'passionate' },
  'freedom-loving':{ uk: 'свобода',             ru: 'свобода',              en: 'freedom-loving' },
  independent:     { uk: 'незалежність',        ru: 'независимость',        en: 'independent' },
  'self-reliant':  { uk: 'самостійність',       ru: 'самостоятельность',    en: 'self-reliant' },
  'self-assured':  { uk: 'впевненість',         ru: 'уверенность',          en: 'confident' },
  confident:       { uk: 'впевненість',         ru: 'уверенность',          en: 'confident' },
  ambitious:       { uk: 'амбітність',          ru: 'амбициозность',        en: 'ambitious' },
  determined:      { uk: 'цілеспрямованість',   ru: 'целеустремлённость',   en: 'determined' },
  disciplined:     { uk: 'дисциплінованість',   ru: 'дисциплинированность', en: 'disciplined' },
  responsible:     { uk: 'відповідальність',    ru: 'ответственность',      en: 'responsible' },
  reliable:        { uk: 'надійність',          ru: 'надёжность',           en: 'reliable' },
  practical:       { uk: 'практичність',        ru: 'практичность',         en: 'practical' },
  principled:      { uk: 'принциповість',       ru: 'принципиальность',     en: 'principled' },
  direct:          { uk: 'прямота',             ru: 'прямота',              en: 'direct' },
  reflective:      { uk: 'вдумливість',         ru: 'вдумчивость',          en: 'thoughtful' },
  thoughtful:      { uk: 'вдумливість',         ru: 'вдумчивость',          en: 'thoughtful' },
  introspective:   { uk: 'глибина',             ru: 'глубина',              en: 'introspective' },
  rational:        { uk: 'раціональність',      ru: 'рациональность',       en: 'rational' },
  'growth-oriented': { uk: 'прагнення рости',   ru: 'стремление расти',     en: 'growth-minded' },
  'family-oriented': { uk: 'сімейність',        ru: 'семейность',           en: 'family-minded' },
  'nature-lover':  { uk: 'любов до природи',    ru: 'любовь к природе',     en: 'nature lover' },
  'nature-oriented': { uk: 'любов до природи',  ru: 'любовь к природе',     en: 'nature lover' },
  protective:      { uk: 'дбайливість',         ru: 'бережность',           en: 'protective' },
  'self-accepting':{ uk: 'гармонія з собою',    ru: 'гармония с собой',     en: 'self-accepting' },
  idealistic:      { uk: 'ідеалізм',            ru: 'идеализм',             en: 'idealistic' },
  sensitive:       { uk: 'чуйність',            ru: 'чуткость',             en: 'sensitive' },
  unconventional:  { uk: 'нестандартність',     ru: 'нестандартность',      en: 'unconventional' },
  balanced:        null, // the old padding word: says nothing about anyone
};

/** The words a personality model may choose from (keys of VOCAB that show). */
export const ALLOWED_TAGS = Object.keys(VOCAB).filter((k) => VOCAB[k]);

/**
 * Raw stored tags → the words a card may show, in the reader's language.
 * De-duplicated (two synonyms can share a translation), at most `max`.
 */
export function presentTags(tags, lang = 'uk', max = 3) {
  const l = lang === 'ru' || lang === 'en' ? lang : 'uk';
  const out = [];
  for (const raw of Array.isArray(tags) ? tags : []) {
    const key = String(raw || '').trim().toLowerCase();
    const entry = Object.prototype.hasOwnProperty.call(VOCAB, key) ? VOCAB[key] : null;
    if (!entry) continue;
    const word = entry[l];
    if (!out.includes(word)) out.push(word);
    if (out.length >= max) break;
  }
  return out;
}
