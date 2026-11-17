import {env} from 'cloudflare:workers';
import {userId, safeMutation, privateJson} from '@/lib/server-auth';
import {EXAM_LIBRARY_LIMITS, readLibraryManifest, type LibraryManifest} from '@/lib/exam-library';

type Row = {id:string; user_id:string; object_key:string; manifest:string; bytes:number; sha256:string; state:string; created_at:string};
const ID = /^[a-f0-9-]{36}$/;
function item(row: Row) { return {...JSON.parse(row.manifest), id:row.id, state:row.state, createdAt:row.created_at}; }
async function authorize(request: Request, mutation = false) {
  const uid = await userId(request);
  if (!uid) return privateJson({error:'请登录后打开个人题包库'}, 401);
  if ((mutation || request.headers.has('x-lantern-owner')) && request.headers.get('x-lantern-owner') !== uid) return privateJson({error:'账号已切换，请刷新后重试'}, 409);
  if (mutation && !safeMutation(request)) return privateJson({error:'请求来源不匹配'}, 403);
  if (!env.DB || !env.BUCKET) return privateJson({error:'个人题包库暂不可用'}, 503);
  return uid;
}
export async function GET(request: Request) {
  const uid = await authorize(request); if (uid instanceof Response) return uid;
  try {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) {
      const {results} = await env.DB.prepare('SELECT * FROM exam_library WHERE user_id = ? ORDER BY created_at DESC').bind(uid).all<Row>();
      return privateJson({items:results.map(item), limits:EXAM_LIBRARY_LIMITS});
    }
    if (!ID.test(id)) return privateJson({error:'题包编号无效'}, 400);
    const row = await env.DB.prepare('SELECT * FROM exam_library WHERE user_id = ? AND id = ? AND state = ?').bind(uid, id, 'ready').first<Row>();
    if (!row) return privateJson({error:'未找到该题包'}, 404);
    const object = await env.BUCKET.get(row.object_key);
    if (!object || object.size !== row.bytes) return privateJson({error:'题包暂不可用，请重新上传'}, 503);
    return new Response(object.body, {headers:{'Content-Type':'application/json; charset=utf-8', 'Content-Length':String(object.size),
      'Content-Disposition':`attachment; filename="lantern-exam-${id}.json"`, 'Cache-Control':'private, no-store, no-transform', 'X-Content-Type-Options':'nosniff', 'X-Exam-Sha256':row.sha256}});
  } catch { return privateJson({error:'个人题包库读取失败，请重试'}, 503); }
}
export async function POST(request: Request) {
  const uid = await authorize(request, true); if (uid instanceof Response) return uid;
  let manifest: LibraryManifest;
  try {
    const header = request.headers.get('x-exam-manifest') || '';
    if (header.length > 4096) throw new Error();
    manifest = readLibraryManifest(JSON.parse(decodeURIComponent(header)));
    if (!request.body || request.headers.get('content-type') !== 'application/json' || Number(request.headers.get('content-length')) !== manifest.bytes) throw new Error();
  } catch { return privateJson({error:'上传信息无效、缺少文件长度或题包超过 96 MiB'}, 400); }
  const id = crypto.randomUUID(), objectKey = `exam-library/${encodeURIComponent(uid)}/${id}`;
  let reserved = false;
  try {
    const duplicate = await env.DB.prepare('SELECT * FROM exam_library WHERE user_id = ? AND sha256 = ?').bind(uid, manifest.sha256).first<Row>();
    if (duplicate) return duplicate.state === 'ready' ? privateJson({item:item(duplicate), unchanged:true}) : privateJson({error:'相同文件仍在上传；若长时间未完成，可在目录取消后重试'}, 409);
    // One atomic statement reserves both count and bytes, including concurrent uploads.
    const result = await env.DB.prepare(`INSERT INTO exam_library (id,user_id,object_key,manifest,bytes,sha256,state,created_at)
      SELECT ?,?,?,?,?,?,'uploading',? WHERE (SELECT COUNT(*) FROM exam_library WHERE user_id = ?) < ?
      AND COALESCE((SELECT SUM(bytes) FROM exam_library WHERE user_id = ?),0) + ? <= ? ON CONFLICT DO NOTHING`)
      .bind(id, uid, objectKey, JSON.stringify(manifest), manifest.bytes, manifest.sha256, new Date().toISOString(), uid, EXAM_LIBRARY_LIMITS.packages, uid, manifest.bytes, EXAM_LIBRARY_LIMITS.bytes).run();
    if (!result.meta.changes) return privateJson({error:'个人题包库容量已满或相同文件正在上传，请刷新目录'}, 409);
    reserved = true;
    // Preserve the request stream's known length. R2 verifies SHA-256 without buffering a large JSON in the Worker.
    const object = await env.BUCKET.put(objectKey, request.body, {sha256:manifest.sha256, httpMetadata:{contentType:'application/json', cacheControl:'private, no-store'}});
    if (!object || object.size !== manifest.bytes) throw new Error('size');
    const saved = await env.DB.prepare("UPDATE exam_library SET state = 'ready' WHERE id = ? AND user_id = ? AND state = 'uploading'").bind(id, uid).run();
    if (!saved.meta.changes) throw new Error('cancelled');
    return privateJson({ok:true, id});
  } catch {
    if (reserved) {
      try { await env.BUCKET.delete(objectKey); await env.DB.prepare('DELETE FROM exam_library WHERE id = ? AND user_id = ?').bind(id, uid).run(); } catch { /* Keep the row visible for explicit retry/cleanup. */ }
    }
    return privateJson({error:'上传未完成或校验失败；原文件与本机考试记录保留'}, 503);
  }
}
export async function DELETE(request: Request) {
  const uid = await authorize(request, true); if (uid instanceof Response) return uid;
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!ID.test(id)) return privateJson({error:'题包编号无效'}, 400);
  try {
    const row = await env.DB.prepare('SELECT * FROM exam_library WHERE user_id = ? AND id = ?').bind(uid, id).first<Row>();
    if (!row) return privateJson({ok:true});
    // A tombstone blocks late upload completion and keeps cleanup retryable if R2 fails.
    await env.DB.prepare("UPDATE exam_library SET state = 'deleting' WHERE user_id = ? AND id = ?").bind(uid, id).run();
    await env.BUCKET.delete(row.object_key);
    await env.DB.prepare('DELETE FROM exam_library WHERE user_id = ? AND id = ?').bind(uid, id).run();
    return privateJson({ok:true});
  } catch { return privateJson({error:'移除未完成，请刷新后重试'}, 503); }
}
