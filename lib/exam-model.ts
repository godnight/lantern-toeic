/** Personal, local-only TOEIC L&R imports. Source declarations do not certify rights. */
export const EXAM_LIMITS = Object.freeze({
  importBytes: 96 * 1024 * 1024, assetBytes: 50 * 1024 * 1024,
  imageBytes: 6 * 1024 * 1024, decodedBytes: 64 * 1024 * 1024,
  ownerBytes: 192 * 1024 * 1024, backupBytes: 224 * 1024 * 1024,
  assets: 100, packages: 20, attempts: 1000,
});
export const PART_COUNTS = [6, 25, 39, 30, 30, 16, 54] as const;
export type ExamFormat = 'legacy-2006';
const LEGACY_PART_COUNTS = [10, 30, 30, 30, 40, 12, 48] as const;
/** Omission preserves the current format and canonical bytes of existing packages. */
function readExamFormat(value: unknown): ExamFormat | undefined {
  if (value === undefined) return undefined;
  if (value !== 'legacy-2006') fail('不支持的题型版本');
  return value;
}
export function getExamProfile(format?: ExamFormat) {
  const legacy = readExamFormat(format) === 'legacy-2006';
  return {
    label: legacy ? '2006 版旧题型' : '现行题型',
    partCounts: legacy ? LEGACY_PART_COUNTS : PART_COUNTS,
    part6GroupSize: legacy ? 3 : 4,
    singlePassageEnd: legacy ? 180 : 175,
    singlePassageMaxQuestions: legacy ? 5 : 4,
  };
}
export const LISTENING_MS = 45 * 60 * 1000;
export const READING_MS = 75 * 60 * 1000;
export const IMPORT_CLOCK_SKEW_MS = 5 * 60 * 1000;
export type Part = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type ExamSource = {
  classification: 'official-past' | 'official-practice' | 'original' | 'other';
  title: string; publisher?: string; reference?: string; rightsStatement: string;
};
export type ExamAsset = { id: string; mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'audio/mpeg' | 'audio/wav'; base64: string };
export type ExamGroup = { id: string; part: Part; questionNumbers: number[]; passages: string[]; imageIds: string[] };
export type ExamQuestion = { number: number; part: Part; groupId: string; prompt: string; choices: string[]; answer: number; explanation?: string };
export type ScoreBand = { minCorrect: number; maxCorrect: number; minScore: number; maxScore: number };
export type ExamPackage = {
  kind: 'lantern-toeic-exam'; schemaVersion: 1; id: string; version: number; title: string;
  format?: ExamFormat;
  source: ExamSource; listeningAudioId: string; assets: ExamAsset[]; groups: ExamGroup[]; questions: ExamQuestion[];
  listeningDurationMs?: number;
  scoreRanges?: { source: string; listening: ScoreBand[]; reading: ScoreBand[] };
};
export type ExamDefinition = Omit<ExamPackage, 'assets'>;
export type InterruptionReason = 'background' | 'audio-failure' | 'audio-interrupted' | 'audio-seek';
export type ExamInterruption = { reason: InterruptionReason; at: number };
export type ExamAttempt = {
  kind: 'lantern-exam-attempt'; schemaVersion: 1; id: string; ownerId: string;
  format?: ExamFormat;
  examId: string; examVersion: number; fingerprint: string; ordinal: number;
  startedAt: number; listeningDeadline: number; readingDeadline: number; lastObservedAt: number;
  status: 'listening' | 'reading' | 'submitted'; activeQuestion: number;
  answers: Record<string, { choice: number; savedAt: number }>;
  questionTimeMs: Record<string, number>; revision: number; clockRollback: boolean; interruptions: ExamInterruption[];
  submittedAt?: number; submittedReason?: 'manual' | 'timeout';
};
export type PartResult = { part: Part; total: number; correct: number; unanswered: number; accuracy: number; timeMs: number };
export type ExamResult = {
  correct: number; total: 200; unanswered: number; listeningCorrect: number; readingCorrect: number;
  elapsedMs: number; ordinal: number; firstAttempt: boolean; parts: PartResult[];
  interruptions: ExamInterruption[]; clockRollback: boolean; integrity: 'interrupted' | 'no-recorded-interruption';
  referenceRange?: { source: string; listening?: [number, number]; reading?: [number, number]; disclaimer: string };
};

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'audio/mpeg', 'audio/wav']);
const INTERRUPTION_REASONS = ['background', 'audio-failure', 'audio-interrupted', 'audio-seek'];
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
function fail(message: string): never { throw new Error(message); }
function record(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${context}必须是对象`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[], context: string) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${context}包含不支持字段：${key}`);
}
function str(value: unknown, context: string, max = 1000, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail(`${context}文字无效或过长`);
  return value;
}
function id(value: unknown, context: string): string {
  if (typeof value !== 'string' || !ID.test(value)) fail(`${context}仅允许 1–80 位字母、数字、下划线和连字符`);
  return value;
}
function integer(value: unknown, low: number, high: number, context: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < low || (value as number) > high) fail(`${context}范围无效`);
  return value as number;
}
function readListeningDurationMs(value: unknown): number {
  const duration = integer(value, 40 * 60 * 1000, 50 * 60 * 1000, '听力时长');
  if (duration % 1000) fail('听力时长须为整秒');
  return duration;
}
export function getListeningDurationMs(exam: Pick<ExamPackage, 'listeningDurationMs'>): number {
  return exam.listeningDurationMs === undefined ? LISTENING_MS : readListeningDurationMs(exam.listeningDurationMs);
}
function array(value: unknown, min: number, max: number, context: string): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(`${context}数量无效`);
  return value;
}
export function assertOwner(owner: string): string { return str(owner, '本机账号范围', 200); }
export function questionPart(number: number, format?: ExamFormat): Part {
  integer(number, 1, 200, '题号');
  const counts = getExamProfile(format).partCounts;
  let end = 0;
  for (let p = 1; p <= 7; p++) { end += counts[p - 1]; if (number <= end) return p as Part; }
  return 7;
}
export function examKey(exam: Pick<ExamPackage, 'id' | 'version'>): string { return `${exam.id}@${exam.version}`; }
export function jsonBytes(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
export function parseLimitedJson(text: string, maxBytes: number): unknown {
  if (typeof text !== 'string' || text.length > maxBytes || new TextEncoder().encode(text).byteLength > maxBytes) fail('文件超出本机导入限额');
  try { return JSON.parse(text); } catch { return fail('文件不是有效 JSON'); }
}
export function assetBytes(asset: ExamAsset): Uint8Array {
  const binary = atob(asset.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function magicMatches(mime: string, bytes: Uint8Array): boolean {
  const ascii = (start: number, text: string) => [...text].every((c, i) => bytes[start + i] === c.charCodeAt(0));
  if (mime === 'image/png') return [137, 80, 78, 71, 13, 10, 26, 10].every((x, i) => bytes[i] === x);
  if (mime === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === 'image/webp') return ascii(0, 'RIFF') && ascii(8, 'WEBP');
  if (mime === 'audio/wav') return ascii(0, 'RIFF') && ascii(8, 'WAVE');
  return ascii(0, 'ID3') || (bytes[0] === 255 && (bytes[1] & 224) === 224);
}
function readBands(value: unknown, context: string): ScoreBand[] {
  let next = 0;
  let previousLow = 0;
  let previousHigh = 0;
  const bands = array(value, 1, 101, context).map((raw) => {
    const b = record(raw, context); keys(b, ['minCorrect', 'maxCorrect', 'minScore', 'maxScore'], context);
    const minCorrect = integer(b.minCorrect, 0, 100, context), maxCorrect = integer(b.maxCorrect, minCorrect, 100, context);
    const minScore = integer(b.minScore, 5, 495, context), maxScore = integer(b.maxScore, minScore, 495, context);
    if (minCorrect !== next || minScore % 5 || maxScore % 5 || minScore < previousLow || maxScore < previousHigh) fail(`${context}须连续覆盖 0–100 道且分数区间单调、步长为 5`);
    next = maxCorrect + 1; previousLow = minScore; previousHigh = maxScore;
    return { minCorrect, maxCorrect, minScore, maxScore };
  });
  if (next !== 101) fail(`${context}未覆盖全部原始正确题数`);
  return bands;
}

export function parseExamPackage(input: string | unknown): ExamPackage {
  const raw = typeof input === 'string' ? parseLimitedJson(input, EXAM_LIMITS.importBytes) : input;
  const e = record(raw, '题包');
  keys(e, ['kind', 'schemaVersion', 'id', 'version', 'title', 'source', 'listeningAudioId', 'assets', 'groups', 'questions', 'scoreRanges', 'listeningDurationMs', 'format'], '题包');
  if (e.kind !== 'lantern-toeic-exam' || e.schemaVersion !== 1) fail('题包格式或版本不支持');
  const format = readExamFormat(e.format), profile = getExamProfile(format);
  const s = record(e.source, '来源'); keys(s, ['classification', 'title', 'publisher', 'reference', 'rightsStatement'], '来源');
  if (!['official-past', 'official-practice', 'original', 'other'].includes(String(s.classification))) fail('来源类别无效');
  const source: ExamSource = { classification: s.classification as ExamSource['classification'], title: str(s.title, '来源名称', 500), rightsStatement: str(s.rightsStatement, '导入者使用依据', 4000) };
  if (s.publisher !== undefined) source.publisher = str(s.publisher, '发行方', 200);
  if (s.reference !== undefined) source.reference = str(s.reference, '来源定位（书名、版次、页码或链接）', 2000);
  if (source.classification.startsWith('official-') && (!source.publisher || !source.reference)) fail('官方来源分类须由导入者填写发行方和具体出处；程序不替代授权');
  let totalBytes = 0;
  const assetIds = new Set<string>();
  const assets: ExamAsset[] = array(e.assets, 1, EXAM_LIMITS.assets, '素材').map((raw) => {
    const a = record(raw, '素材'); keys(a, ['id', 'mime', 'base64'], '素材');
    const aid = id(a.id, '素材 ID'); if (assetIds.has(aid)) fail('素材 ID 重复'); assetIds.add(aid);
    if (!MIME.has(String(a.mime))) fail('素材只允许 PNG/JPEG/WebP/MP3/WAV，不能使用 SVG、HTML 或外部地址');
    const mime = a.mime as ExamAsset['mime'];
    const max = mime.startsWith('image/') ? EXAM_LIMITS.imageBytes : EXAM_LIMITS.assetBytes;
    if (typeof a.base64 !== 'string' || a.base64.length > Math.ceil(max / 3) * 4 || !a.base64.length || a.base64.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(a.base64)) fail('素材不是有效的限额内 base64');
    const asset = { id: aid, mime, base64: a.base64 };
    const bytes = assetBytes(asset); totalBytes += bytes.length;
    if (bytes.length > max || totalBytes > EXAM_LIMITS.decodedBytes) fail('素材总大小超过限额');
    if (!magicMatches(mime, bytes)) fail('素材文件头与 MIME 不符');
    const tail = asset.base64.slice(-4);
    if (btoa(atob(tail)) !== tail) fail('素材 base64 填充位无效');
    return asset;
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const listeningAudioId = id(e.listeningAudioId, '整场听力素材 ID');
  if (!assets.some(a => a.id === listeningAudioId && a.mime.startsWith('audio/'))) fail('缺少整场听力音频');
  const questions: ExamQuestion[] = array(e.questions, 200, 200, '完整听读试题').map((raw, i) => {
    const q = record(raw, `第 ${i + 1} 题`); keys(q, ['number', 'part', 'groupId', 'prompt', 'choices', 'answer', 'explanation'], '试题');
    const number = integer(q.number, i + 1, i + 1, '连续题号'), part = questionPart(number, format);
    if (q.part !== part) fail(`第 ${number} 题 Part 与所声明的 200 题结构不符`);
    const count = part === 2 ? 3 : 4;
    const result: ExamQuestion = { number, part, groupId: id(q.groupId, '题组 ID'), prompt: str(q.prompt, '题干', 10000, part <= 2), choices: array(q.choices, count, count, '选项').map(c => str(c, '选项', 3000)), answer: integer(q.answer, 0, count - 1, '正确选项（从 0 开始）') };
    if (q.explanation !== undefined) result.explanation = str(q.explanation, '解析', 20000, true);
    return result;
  });
  const groupIds = new Set<string>(), grouped = new Set<number>(), usedAssets = new Set([listeningAudioId]);
  const groups: ExamGroup[] = array(e.groups, 1, 200, '题组').map((raw) => {
    const g = record(raw, '题组'); keys(g, ['id', 'part', 'questionNumbers', 'passages', 'imageIds'], '题组');
    const gid = id(g.id, '题组 ID'); if (groupIds.has(gid)) fail('题组 ID 重复'); groupIds.add(gid);
    const part = integer(g.part, 1, 7, '题组 Part') as Part;
    const questionNumbers = array(g.questionNumbers, 1, 5, '题组题号').map((v, i, arr) => {
      const n = integer(v, 1, 200, '题组题号');
      if (grouped.has(n) || (i > 0 && n !== Number(arr[i - 1]) + 1) || questions[n - 1].groupId !== gid || questions[n - 1].part !== part) fail('题组题号必须连续、唯一、与试题一致且不能跨 Part');
      grouped.add(n); return n;
    });
    const passages = array(g.passages ?? [], 0, 3, '材料').map(t => str(t, '阅读材料', 30000, true));
    const imageIds = array(g.imageIds ?? [], 0, 8, '题组图片').map(v => {
      const aid = id(v, '图片 ID');
      if (!assets.some(a => a.id === aid && a.mime.startsWith('image/'))) fail('图片引用缺失或类型错误');
      usedAssets.add(aid); return aid;
    });
    if (new Set(imageIds).size !== imageIds.length) fail('题组图片引用重复');
    const expected = part === 3 || part === 4 ? 3 : part === 6 ? profile.part6GroupSize : part <= 5 ? 1 : 0;
    if (expected && questionNumbers.length !== expected) fail(`Part ${part} 题组题数不完整`);
    if (part === 1 && !imageIds.length) fail('Part 1 必须有照片');
    if ((part === 6 || part === 7) && !passages.some(t => t.trim()) && !imageIds.length) fail('阅读题组缺少正文或扫描图片');
    if (part === 6 && passages.length !== 1) fail('Part 6 每组需要一份材料');
    if (part === 7) {
      const single = questionNumbers[0] <= profile.singlePassageEnd;
      const invalidSingle = questionNumbers.some(n => n > profile.singlePassageEnd) || passages.length !== 1 || questionNumbers.length < 2 || questionNumbers.length > profile.singlePassageMaxQuestions;
      const invalidMultiple = (format === 'legacy-2006' ? passages.length !== 2 : passages.length < 2) || questionNumbers.length !== 5;
      if (single ? invalidSingle : invalidMultiple) fail(format === 'legacy-2006' ? '旧题型 Part 7 须含 153–180 单篇及 181–200 双篇，题组不能跨界' : 'Part 7 须含前 29 道单篇材料与后 25 道多篇材料，题组不能跨界');
    }
    return { id: gid, part, questionNumbers, passages, imageIds };
  }).sort((a, b) => a.questionNumbers[0] - b.questionNumbers[0]);
  if (grouped.size !== 200 || questions.some(q => !groupIds.has(q.groupId))) fail('题组没有完整覆盖 200 道题');
  if (usedAssets.size !== assets.length) fail('题包含未引用素材，请移除无关文件');
  const exam: ExamPackage = { kind: 'lantern-toeic-exam', schemaVersion: 1, id: id(e.id, '题包 ID'), version: integer(e.version, 1, 1000000, '题包版本'), title: str(e.title, '题包标题', 300), source, listeningAudioId, assets, groups, questions };
  if (format !== undefined) exam.format = format;
  // Omit the legacy default to preserve existing normalized bytes and fingerprints.
  if (e.listeningDurationMs !== undefined) exam.listeningDurationMs = readListeningDurationMs(e.listeningDurationMs);
  if (e.scoreRanges !== undefined) {
    const ranges = record(e.scoreRanges, '参考分数区间'); keys(ranges, ['source', 'listening', 'reading'], '参考分数区间');
    exam.scoreRanges = { source: str(ranges.source, '本套参考区间出处', 2000), listening: readBands(ranges.listening, '听力参考区间'), reading: readBands(ranges.reading, '阅读参考区间') };
  }
  if (jsonBytes(exam) > EXAM_LIMITS.importBytes) fail('题包超过导入限额');
  return exam;
}

// Portable SHA-256 fallback for offline ArkWeb origins without Web Crypto SubtleCrypto.
function sha256(bytes: Uint8Array): string {
  const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const length = Math.ceil((bytes.length + 9) / 64) * 64, w = new Uint32Array(64);
  const rotate = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  // Padding is streamed block by block; it does not allocate a second full audio-size buffer.
  const bitLength = bytes.length * 8;
  const byte = (offset: number) => offset < bytes.length ? bytes[offset] : offset === bytes.length ? 128 : offset >= length - 8 ? Math.floor(bitLength / 2 ** ((length - 1 - offset) * 8)) & 255 : 0;
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = (byte(offset + i * 4) << 24) | (byte(offset + i * 4 + 1) << 16) | (byte(offset + i * 4 + 2) << 8) | byte(offset + i * 4 + 3);
    for (let i = 16; i < 64; i++) { const x = w[i - 15], y = w[i - 2]; w[i] = w[i - 16] + (rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3)) + w[i - 7] + (rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10)); }
    let [a,b,c,d,e,f,g,j] = h;
    for (let i = 0; i < 64; i++) { const t1 = (j + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + k[i] + w[i]) | 0; const t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0; j=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0; }
    for (const [i, v] of [a,b,c,d,e,f,g,j].entries()) h[i] = (h[i] + v) | 0;
  }
  return h.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}
export async function fingerprintExam(exam: ExamPackage): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(exam));
  if (globalThis.crypto?.subtle) { const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)); return 'sha256:' + Array.from(hash, x => x.toString(16).padStart(2, '0')).join(''); }
  return 'sha256:' + sha256(bytes);
}
export function createAssetUrl(exam: ExamPackage, assetId: string): string {
  const asset = exam.assets.find(a => a.id === assetId); if (!asset) fail('素材不存在');
  return URL.createObjectURL(new Blob([assetBytes(asset).buffer as ArrayBuffer], { type: asset.mime }));
}

export function createAttempt(exam: ExamDefinition, options: { id: string; ownerId: string; fingerprint: string; ordinal: number; now: number }): ExamAttempt {
  const format = readExamFormat(exam.format);
  const listeningMs = getListeningDurationMs(exam);
  const now = integer(options.now, 0, 8640000000000000 - listeningMs - READING_MS, '开始时间');
  if (!/^sha256:[a-f0-9]{64}$/.test(options.fingerprint)) fail('题包摘要无效');
  return { kind: 'lantern-exam-attempt', schemaVersion: 1, id: id(options.id, '考试记录 ID'), ownerId: assertOwner(options.ownerId), examId: exam.id, examVersion: exam.version, fingerprint: options.fingerprint, ordinal: integer(options.ordinal, 1, EXAM_LIMITS.attempts, '考试次数'), startedAt: now, listeningDeadline: now + listeningMs, readingDeadline: now + listeningMs + READING_MS, lastObservedAt: now, status: 'listening', activeQuestion: 1, answers: {}, questionTimeMs: {}, revision: 1, clockRollback: false, interruptions: [], ...(format === undefined ? {} : { format }) };
}
function addTime(attempt: ExamAttempt, number: number, duration: number) { if (duration > 0) attempt.questionTimeMs[number] = (attempt.questionTimeMs[number] || 0) + duration; }
/** Deadline-based: background, closed pages and restarts consume the same exam clock. */
export function advanceAttempt(value: ExamAttempt, now: number): ExamAttempt {
  integer(now, 0, 8640000000000000, '当前时间');
  if (value.status === 'submitted') return value;
  const observed = Math.max(now, value.lastObservedAt), end = Math.min(observed, value.readingDeadline);
  if (end === value.lastObservedAt && !(now < value.lastObservedAt && !value.clockRollback)) return value;
  const a: ExamAttempt = { ...value, answers: { ...value.answers }, questionTimeMs: { ...value.questionTimeMs }, revision: value.revision + 1, clockRollback: value.clockRollback || now < value.lastObservedAt };
  if (value.status === 'listening') {
    addTime(a, value.activeQuestion, Math.max(0, Math.min(end, a.listeningDeadline) - value.lastObservedAt));
    if (end >= a.listeningDeadline) { a.status = 'reading'; a.activeQuestion = 101; addTime(a, 101, Math.max(0, end - Math.max(value.lastObservedAt, a.listeningDeadline))); }
  } else addTime(a, value.activeQuestion, end - value.lastObservedAt);
  a.lastObservedAt = end;
  if (observed >= a.readingDeadline) { a.status = 'submitted'; a.submittedAt = a.readingDeadline; a.submittedReason = 'timeout'; }
  return a;
}
function canSelect(a: ExamAttempt, number: number) {
  integer(number, 1, 200, '题号');
  if (a.status === 'submitted') fail('考试已交卷，不能改答');
  if (a.status === 'listening' ? number > 100 : number <= 100) fail('当前考试阶段不允许修改该部分');
}
export function selectQuestion(value: ExamAttempt, number: number, now: number): ExamAttempt {
  const a = advanceAttempt(value, now); canSelect(a, number);
  return a.activeQuestion === number ? a : { ...a, activeQuestion: number, revision: a.revision + 1 };
}
export function answerQuestion(value: ExamAttempt, number: number, choice: number | null, now: number): ExamAttempt {
  const a = selectQuestion(value, number, now);
  if (choice !== null) integer(choice, 0, questionPart(number, a.format) === 2 ? 2 : 3, '选项');
  const answers = { ...a.answers };
  if (choice === null) delete answers[number]; else answers[number] = { choice, savedAt: a.lastObservedAt };
  return { ...a, answers, revision: a.revision + 1 };
}
export function submitAttempt(value: ExamAttempt, now: number): ExamAttempt {
  const a = advanceAttempt(value, now);
  if (a.status === 'submitted') return a;
  // A full mock retains the prescribed listening-to-reading transition.
  if (a.status === 'listening') fail('听力计时结束后才能进入阅读或交卷');
  return { ...a, status: 'submitted', submittedAt: a.lastObservedAt, submittedReason: 'manual', revision: a.revision + 1 };
}
export function markInterrupted(value: ExamAttempt, reason: InterruptionReason, now: number): ExamAttempt {
  if (!INTERRUPTION_REASONS.includes(reason)) fail('不支持的模考中断原因');
  const a = advanceAttempt(value, now);
  if (a.status === 'submitted') return a;
  const last = a.interruptions[a.interruptions.length - 1];
  if (last?.reason === reason && last.at === a.lastObservedAt) return a;
  if (a.interruptions.length >= 2048) fail('模考中断记录达到限额，请保留记录后交卷');
  return { ...a, interruptions: [...a.interruptions, { reason, at: a.lastObservedAt }], revision: a.revision + 1 };
}
export function presentExam(exam: ExamDefinition, attempt: ExamAttempt) {
  assertExamMatch(exam, attempt);
  return { ...exam, scoreRanges: attempt.status === 'submitted' ? exam.scoreRanges : undefined,
    questions: exam.questions.filter(q => attempt.status === 'submitted' || (attempt.status === 'listening' ? q.number <= 100 : q.number > 100)).map(q => {
      if (attempt.status === 'submitted') return { ...q };
      const { answer: _answer, explanation: _explanation, ...visible } = q; void _answer; void _explanation; return visible;
    }),
    groups: exam.groups.filter(g => attempt.status === 'submitted' || (attempt.status === 'listening' ? g.part <= 4 : g.part >= 5)),
  };
}
function assertExamMatch(exam: ExamDefinition, attempt: ExamAttempt) { if (exam.id !== attempt.examId || exam.version !== attempt.examVersion || readExamFormat(exam.format) !== readExamFormat(attempt.format)) fail('记录与题包版本或题型不匹配'); }
export function gradeAttempt(exam: ExamDefinition, attempt: ExamAttempt): ExamResult {
  assertExamMatch(exam, attempt);
  if (attempt.status !== 'submitted' || attempt.submittedAt === undefined) fail('交卷前不显示答案或成绩');
  const parts: PartResult[] = getExamProfile(exam.format).partCounts.map((total, i) => ({ part: (i + 1) as Part, total, correct: 0, unanswered: 0, accuracy: 0, timeMs: 0 }));
  for (const q of exam.questions) {
    const p = parts[q.part - 1], answer = attempt.answers[q.number];
    if (!answer) p.unanswered++; else if (answer.choice === q.answer) p.correct++;
    p.timeMs += attempt.questionTimeMs[q.number] || 0;
  }
  for (const p of parts) p.accuracy = p.correct / p.total;
  const listeningCorrect = parts.slice(0, 4).reduce((sum, p) => sum + p.correct, 0), readingCorrect = parts.slice(4).reduce((sum, p) => sum + p.correct, 0);
  const result: ExamResult = { correct: listeningCorrect + readingCorrect, total: 200, unanswered: parts.reduce((sum, p) => sum + p.unanswered, 0), listeningCorrect, readingCorrect, elapsedMs: attempt.submittedAt - attempt.startedAt, ordinal: attempt.ordinal, firstAttempt: attempt.ordinal === 1, parts, interruptions: attempt.interruptions.map(e => ({ ...e })), clockRollback: attempt.clockRollback, integrity: attempt.clockRollback || attempt.interruptions.length ? 'interrupted' : 'no-recorded-interruption' };
  if (exam.scoreRanges) {
    const band = (bands: ScoreBand[], n: number): [number, number] | undefined => { const b = bands.find(b => n >= b.minCorrect && n <= b.maxCorrect); return b && [b.minScore, b.maxScore]; };
    result.referenceRange = { source: exam.scoreRanges.source, listening: band(exam.scoreRanges.listening, listeningCorrect), reading: band(exam.scoreRanges.reading, readingCorrect), disclaimer: '仅为导入者提供的该套参考区间，不是官方考试成绩，也不适用于其他试卷。' };
  }
  return result;
}

/** Validate persisted/imported attempts rather than trusting backup grades or clocks. */
export function validateAttempt(value: unknown, exam: ExamDefinition, ownerId: string, fingerprint: string, importNow?: number): ExamAttempt {
  const listeningMs = getListeningDurationMs(exam);
  const r = record(value, '考试记录');
  keys(r, ['kind','schemaVersion','id','ownerId','examId','examVersion','fingerprint','ordinal','startedAt','listeningDeadline','readingDeadline','lastObservedAt','status','activeQuestion','answers','questionTimeMs','revision','clockRollback','interruptions','submittedAt','submittedReason','format'], '考试记录');
  const format = readExamFormat(r.format);
  if (format !== readExamFormat(exam.format)) fail('考试记录题型与题包不匹配');
  if (r.kind !== 'lantern-exam-attempt' || r.schemaVersion !== 1 || r.ownerId !== ownerId || r.examId !== exam.id || r.examVersion !== exam.version || r.fingerprint !== fingerprint) fail('考试记录账号、题包或摘要不匹配');
  const start = integer(r.startedAt, 0, 8640000000000000 - listeningMs - READING_MS, '开始时间');
  if (r.listeningDeadline !== start + listeningMs || r.readingDeadline !== start + listeningMs + READING_MS) fail('考试截止时间不可改写');
  const observed = integer(r.lastObservedAt, start, Number(r.readingDeadline), '记录时间'), activeQuestion = integer(r.activeQuestion, 1, 200, '当前题号');
  if (importNow !== undefined) {
    integer(importNow, 0, 8640000000000000, '备份导入时间');
    // Answers, interruptions and submittedAt are checked below against observed.
    // Section deadlines intentionally lie in the future; their fixed derivation is checked above.
    if (start > importNow + IMPORT_CLOCK_SKEW_MS || observed > importNow + IMPORT_CLOCK_SKEW_MS) fail('备份记录时间超过当前设备时间 5 分钟，请核对设备时钟和备份来源；本次未导入。');
  }
  if (!['listening', 'reading', 'submitted'].includes(String(r.status)) || typeof r.clockRollback !== 'boolean') fail('考试状态无效');
  if (r.status === 'listening' && (observed >= Number(r.listeningDeadline) || activeQuestion > 100) || r.status === 'reading' && (observed < Number(r.listeningDeadline) || observed >= Number(r.readingDeadline) || activeQuestion <= 100)) fail('考试阶段与时间不一致');
  const submitted = r.status === 'submitted';
  if (submitted ? r.submittedAt !== observed || observed < Number(r.listeningDeadline) || (r.submittedReason !== 'manual' && r.submittedReason !== 'timeout') || (r.submittedReason === 'timeout' && observed !== r.readingDeadline) || (r.submittedReason === 'manual' && observed >= Number(r.readingDeadline)) : r.submittedAt !== undefined || r.submittedReason !== undefined) fail('交卷状态无效');
  const answers: ExamAttempt['answers'] = {}, times: Record<string, number> = {};
  for (const [key, value] of Object.entries(record(r.answers, '作答'))) {
    if (!/^(?:[1-9]\d?|1\d\d|200)$/.test(key)) fail('作答题号无效');
    const number = Number(key), a = record(value, '作答'); keys(a, ['choice', 'savedAt'], '作答');
    const savedAt = integer(a.savedAt, number <= 100 ? start : Number(r.listeningDeadline), Math.min(observed, (number <= 100 ? Number(r.listeningDeadline) : Number(r.readingDeadline)) - 1), '作答时间');
    answers[key] = { choice: integer(a.choice, 0, questionPart(number, format) === 2 ? 2 : 3, '答案选项'), savedAt };
  }
  let totalTime = 0, listeningTime = 0;
  for (const [key, value] of Object.entries(record(r.questionTimeMs, '题目用时'))) {
    if (!/^(?:[1-9]\d?|1\d\d|200)$/.test(key)) fail('用时题号无效');
    times[key] = integer(value, 0, listeningMs + READING_MS, '题目用时'); totalTime += times[key]; if (Number(key) <= 100) listeningTime += times[key];
  }
  if (totalTime !== observed - start || listeningTime !== Math.min(observed - start, listeningMs)) fail('题目用时与考试时钟不一致');
  let previousInterruption = start;
  const interruptions: ExamInterruption[] = array(r.interruptions, 0, 2048, '中断记录').map(raw => {
    const item = record(raw, '中断记录'); keys(item, ['reason', 'at'], '中断记录');
    if (!INTERRUPTION_REASONS.includes(String(item.reason))) fail('中断原因无效');
    const at = integer(item.at, previousInterruption, observed, '中断时间'); previousInterruption = at;
    return { reason: item.reason as InterruptionReason, at };
  });
  return { kind: 'lantern-exam-attempt', schemaVersion: 1, id: id(r.id, '考试记录 ID'), ownerId, examId: exam.id, examVersion: exam.version, fingerprint, ordinal: integer(r.ordinal, 1, EXAM_LIMITS.attempts, '考试次数'), startedAt: start, listeningDeadline: start + listeningMs, readingDeadline: start + listeningMs + READING_MS, lastObservedAt: observed, status: r.status as ExamAttempt['status'], activeQuestion, answers, questionTimeMs: times, revision: integer(r.revision, 1, Number.MAX_SAFE_INTEGER, '记录版本'), clockRollback: r.clockRollback as boolean, interruptions, ...(submitted ? { submittedAt: observed, submittedReason: r.submittedReason as 'manual' | 'timeout' } : {}), ...(format === undefined ? {} : { format }) };
}

export function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
export function hasOwn(value: object, key: string) { return own(value, key); }
