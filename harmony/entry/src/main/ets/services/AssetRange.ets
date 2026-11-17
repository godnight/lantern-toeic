/** HTTP single-byte ranges over the exact raw-resource view, including its offset. */
export class AssetBytes {
  code: number = 200;
  reason: string = 'OK';
  start: number = 0;
  end: number = -1;
  total: number = 0;
  length: number = 0;
  contentRange: string = '';
  body: ArrayBuffer = new ArrayBuffer(0);
}

export function assetBytes(data: Uint8Array, range: string, head: boolean = false): AssetBytes {
  const result: AssetBytes = new AssetBytes();
  result.total = data.byteLength;
  result.end = data.byteLength - 1;
  if (range !== '' && !head) {
    const match: RegExpMatchArray | null = range.trim().match(/^bytes=(\d*)-(\d*)$/i);
    // Unsupported/malformed units and multi-ranges are ignored, never fabricated as 206.
    if (match === null) {
      result.length = data.byteLength;
      result.body = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      return result;
    }
    let start: number = 0;
    let end: number = result.end;
    let valid: boolean = match !== null && data.byteLength > 0;
    if (match !== null) {
      if (match[1] === '') {
        const suffix: number = Number(match[2]);
        valid = valid && match[2] !== '' && Number.isSafeInteger(suffix) && suffix > 0;
        start = Math.max(0, data.byteLength - suffix);
      } else {
        start = Number(match[1]);
        end = match[2] === '' ? result.end : Number(match[2]);
        valid = valid && Number.isSafeInteger(start) && Number.isSafeInteger(end) &&
          start >= 0 && start < data.byteLength && end >= start;
        end = Math.min(end, result.end);
      }
    }
    if (!valid) {
      result.code = 416;
      result.reason = 'Range Not Satisfiable';
      result.contentRange = 'bytes */' + data.byteLength;
      return result;
    }
    result.code = 206;
    result.reason = 'Partial Content';
    result.start = start;
    result.end = end;
    result.contentRange = 'bytes ' + start + '-' + end + '/' + data.byteLength;
  }
  result.length = Math.max(0, result.end - result.start + 1);
  if (!head) {
    result.body = data.buffer.slice(data.byteOffset + result.start, data.byteOffset + result.start + result.length);
  }
  return result;
}
