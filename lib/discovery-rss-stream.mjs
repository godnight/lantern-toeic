/** Bounded, non-network RSS 2.0 reader shared by browsers and the server.
 * Returns untrusted candidate metadata only; callers MUST apply a reviewed
 * source policy before admitting any item. No media, HTML or enclosure is returned.
 */
const HARD_BYTES = 8 * 1024 * 1024;
const HARD_ITEMS = 50;
const HARD_ITEM_BYTES = 256 * 1024;
const MAX_FIELD = 4096;
const MAX_DESCRIPTION = 3000;
const encoder = new TextEncoder();
const bytes = value => encoder.encode(value).byteLength;
const fail = code => { throw new Error(code); };
const boundedInteger = (value, fallback, limit) => value === undefined ? fallback :
  Number.isSafeInteger(value) && value > 0 ? Math.min(value, limit) : fail('RSS_INVALID_LIMIT');
const aborted = signal => { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError'); };

function decodeXml(value) {
  return value.replace(/&([^;\s<&]+);|&/g, (whole, entity) => {
    if (!entity) return fail('RSS_INVALID_ENTITY');
    const named = {amp:'&', lt:'<', gt:'>', quot:'"', apos:"'"};
    if (Object.hasOwn(named, entity)) return named[entity];
    let n;
    if (/^#x[0-9a-f]+$/i.test(entity)) n = parseInt(entity.slice(2), 16);
    else if (/^#[0-9]+$/.test(entity)) n = Number(entity.slice(1));
    else return fail('RSS_INVALID_ENTITY');
    if (!Number.isInteger(n) || n > 0x10ffff || n === 0 || n >= 0xd800 && n <= 0xdfff || n < 32 && ![9,10,13].includes(n)) return fail('RSS_INVALID_ENTITY');
    return String.fromCodePoint(n);
  });
}
function plainText(parts, limit) {
  // CDATA is literal; ordinary XML text is decoded only when the field closes,
  // so an entity split across network chunks is handled correctly.
  let value = parts.map(part => part.cdata ? part.text : decodeXml(part.text)).join('');
  // CDATA often contains HTML references. Decode a bounded set so an encoded
  // dubbing/language warning is visible to the caller's admission policy.
  for (let pass = 0; pass < 2; pass++) value = value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, ref) => {
    if (ref.toLowerCase() === 'nbsp') return ' ';
    try { return decodeXml('&' + ref.toLowerCase() + ';'); } catch { return whole; }
  });
  value = value.replace(/<[^>]*>/g, ' ').replace(/\s+/gu, ' ').trim();
  return { value: value ? value.slice(0, limit) : null, truncated: value.length > limit };
}
function tagEnd(buffer) {
  let quote = '';
  for (let i = 1; i < buffer.length; i++) {
    const ch = buffer[i];
    if (quote) { if (ch === quote) quote = ''; }
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') return i;
  }
  return -1;
}
class RssScanner {
  constructor(maxItems, maxItemBytes) {
    this.buffer = ''; this.stack = []; this.item = null; this.capture = null;
    this.items = []; this.rootSeen = false; this.channelSeen = false;
    this.rootClosed = false; this.maxItems = maxItems; this.maxItemBytes = maxItemBytes;
    this.itemBytes = 0; this.headerBytes = 0;
  }
  append(value) { this.buffer += value; }
  take(length) {
    const piece = this.buffer.slice(0, length); this.buffer = this.buffer.slice(length);
    if (this.item) { this.itemBytes += bytes(piece); if (this.itemBytes > this.maxItemBytes) fail('RSS_ITEM_TOO_LARGE'); }
    else if (!this.items.length) { this.headerBytes += bytes(piece); if (this.headerBytes > this.maxItemBytes) fail('RSS_HEADER_TOO_LARGE'); }
    return piece;
  }
  text(value, cdata = false) {
    if (!this.capture || !value) return;
    const parts = this.capture.parts, last = parts[parts.length - 1];
    if (last && last.cdata === cdata) last.text += value;
    else parts.push({text:value,cdata});
  }
  start(name, selfClosing, tokenBytes) {
    if (!this.stack.length) {
      if (this.rootSeen || name !== 'rss') fail('RSS_INVALID_ROOT');
      this.rootSeen = true;
    } else if (this.stack.length === 1 && this.stack[0] === 'rss' && name === 'channel') {
      if (this.channelSeen) fail('RSS_DUPLICATE_CHANNEL');
      this.channelSeen = true;
    }
    if (this.stack.length === 2 && this.stack[0] === 'rss' && this.stack[1] === 'channel' && name === 'item') {
      if (this.item) fail('RSS_NESTED_ITEM');
      this.item = Object.create(null); this.itemBytes = tokenBytes;
      if (this.itemBytes > this.maxItemBytes) fail('RSS_ITEM_TOO_LARGE');
    }
    if (this.item && this.stack.length === 3 && this.stack[2] === 'item') {
      const key = ({guid:'guid',link:'link',title:'title',pubDate:'publishedAt',language:'language','dc:language':'language',description:'description'})[name];
      if (key) {
        if (Object.hasOwn(this.item, key) || this.capture) fail('RSS_DUPLICATE_FIELD');
        this.capture = {key, depth:this.stack.length + 1, parts:[], nested:false};
      }
    } else if (this.capture) this.capture.nested = true;
    this.stack.push(name); if (this.stack.length > 64) fail('RSS_DEPTH_EXCEEDED');
    if (selfClosing) return this.end(name);
    return false;
  }
  end(name) {
    if (this.stack[this.stack.length - 1] !== name) fail('RSS_MISMATCHED_TAG');
    if (this.capture && this.capture.depth === this.stack.length) {
      const {key,parts,nested} = this.capture;
      const limit = key === 'description' ? MAX_DESCRIPTION : key === 'title' ? 500 : MAX_FIELD;
      const parsed = plainText(parts,limit);
      // Identity and language must be scalar: tags hidden inside those fields
      // cannot manufacture a trusted GUID or link.
      const scalar = ['guid','link','language'].includes(key);
      const markup = scalar && parts.some(part => (part.cdata ? part.text : decodeXml(part.text)).includes('<'));
      this.item[key] = parsed.truncated && key !== 'description' || scalar && (nested || markup) ? null : parsed.value;
      if (key === 'description') this.item.descriptionTruncated = parsed.truncated;
      this.capture = null;
    }
    const isItem = this.item && this.stack.length === 3 && name === 'item';
    this.stack.pop();
    if (!this.stack.length) this.rootClosed = true;
    if (isItem) {
      const value = this.item;
      this.items.push({guid:value.guid ?? null,link:value.link ?? null,title:value.title ?? null,
        publishedAt:value.publishedAt ?? null,language:value.language ?? null,
        description:value.description ?? null,descriptionTruncated:value.descriptionTruncated ?? false});
      this.item = null; this.itemBytes = 0; return true;
    }
    return false;
  }
  /** Process at most one whole item, allowing callers to yield between batches. */
  advance() {
    while (this.buffer.length) {
      if (this.buffer[0] !== '<') {
        const end = this.buffer.indexOf('<');
        const amount = end < 0 ? this.buffer.length : end;
        const value = this.take(amount);
        if (!this.stack.length && value.trim()) fail('RSS_OUTSIDE_ROOT');
        this.text(value); continue;
      }
      const p = this.buffer;
      if (p.startsWith('<!--')) {
        const end = p.indexOf('-->',4); if (end < 0) break;
        this.take(end + 3); continue;
      }
      if (p.startsWith('<![CDATA[')) {
        const end = p.indexOf(']]>',9); if (end < 0) break;
        const piece = this.take(end + 3); this.text(piece.slice(9,-3),true); continue;
      }
      if (p.startsWith('<?')) {
        const end = p.indexOf('?>',2); if (end < 0) break;
        if (this.stack.length) fail('RSS_UNEXPECTED_INSTRUCTION');
        this.take(end + 2); continue;
      }
      if (p.startsWith('<!')) {
        if ('<!--'.startsWith(p) || '<![CDATA['.startsWith(p)) break;
        fail('RSS_DECLARATION_FORBIDDEN');
      }
      if (p.length < 2) break;
      const end = tagEnd(p); if (end < 0) break;
      const token = this.take(end + 1);
      if (token.startsWith('</')) {
        const match = /^<\/([A-Za-z_][\w:.-]*)\s*>$/.exec(token);
        if (!match) fail('RSS_INVALID_TAG');
        if (this.end(match[1])) return true;
      } else {
        const match = /^<([A-Za-z_][\w:.-]*)(?=\s|\/?\s*>)/.exec(token);
        if (!match) fail('RSS_INVALID_TAG');
        if (this.start(match[1], /\/\s*>$/.test(token), bytes(token))) return true;
      }
    }
    if (bytes(this.buffer) > this.maxItemBytes) fail(this.item ? 'RSS_ITEM_TOO_LARGE' : 'RSS_HEADER_TOO_LARGE');
    return false;
  }
  finish() {
    if (this.buffer.trim() || this.stack.length || !this.rootSeen || !this.channelSeen || !this.rootClosed) fail('RSS_INCOMPLETE_XML');
  }
}
async function readWithSignal(reader, signal) {
  aborted(signal); if (!signal) return reader.read();
  let listener;
  const onAbort = new Promise((_, reject) => { listener = () => reject(new DOMException('Aborted','AbortError')); signal.addEventListener('abort', listener, {once:true}); });
  try { return await Promise.race([reader.read(), onAbort]); }
  finally { signal.removeEventListener('abort', listener); }
}
export async function readRssItems(response, options = {}) {
  const maxBytes = boundedInteger(options.maxBytes, HARD_BYTES, HARD_BYTES);
  const maxItems = boundedInteger(options.maxItems, HARD_ITEMS, HARD_ITEMS);
  const maxItemBytes = boundedInteger(options.maxItemBytes, HARD_ITEM_BYTES, HARD_ITEM_BYTES);
  const yieldEvery = boundedInteger(options.yieldEvery, 3, 50);
  if (!response?.ok || !response.body || typeof response.body.getReader !== 'function') fail('RSS_RESPONSE_UNAVAILABLE');
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', {fatal:true}), scanner = new RssScanner(maxItems,maxItemBytes);
  let readBytes = 0, done = false;
  try {
    while (!done && scanner.items.length < maxItems) {
      const part = await readWithSignal(reader,options.signal); done = part.done;
      if (done) { scanner.append(decoder.decode()); }
      else {
        if (!(part.value instanceof Uint8Array)) fail('RSS_INVALID_BYTES');
        readBytes += part.value.byteLength; if (readBytes > maxBytes) fail('RSS_TOO_LARGE');
        // A single oversized stream chunk is processed in smaller slices; no DOM
        // of the multi-megabyte historic feed is ever built on the UI thread.
        for (let offset = 0; offset < part.value.byteLength && scanner.items.length < maxItems; offset += 65536) {
          aborted(options.signal); scanner.append(decoder.decode(part.value.subarray(offset,offset+65536),{stream:true}));
          while (scanner.advance()) {
            if (scanner.items.length % yieldEvery === 0) await new Promise(resolve => setTimeout(resolve,0));
            if (scanner.items.length >= maxItems) break;
          }
        }
      }
      if (done) while (scanner.advance()) { if (scanner.items.length >= maxItems) break; }
    }
    if (done && scanner.items.length < maxItems) scanner.finish();
    if (!scanner.rootSeen || !scanner.channelSeen) fail('RSS_INVALID_DOCUMENT');
    return scanner.items;
  } finally {
    if (!done || scanner.items.length >= maxItems) { try { Promise.resolve(reader.cancel()).catch(()=>{}); } catch {} }
    try { reader.releaseLock(); } catch {}
  }
}
