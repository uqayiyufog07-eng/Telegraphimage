// 上传去重：以文件内容的 SHA-256 作为指纹，在 KV 中记录"内容 -> 已存文件"的映射。
// 命中映射时直接复用已有文件，避免重复存储相同内容。
//
// KV key 命名空间（均为内部 key，不会被后台文件列表当作普通文件）：
//   dedup:{hash}   -> 图床去重记录 { fileId, src, provider, fileName, fileSize, createdAt }
//   nddedup:{hash} -> 网盘去重记录 { key, size, fileName, updatedAt }

const DEDUP_PREFIX = 'dedup:';
const ND_DEDUP_PREFIX = 'nddedup:';

// 超过该大小的文件不计算哈希（Workers 内存有限，大文件跳过去重）。
const MAX_HASHABLE_BYTES = 64 * 1024 * 1024;

export function dedupKey(hash) {
  return DEDUP_PREFIX + hash;
}

export function ndDedupKey(hash) {
  return ND_DEDUP_PREFIX + hash;
}

export function isDedupKey(name) {
  return typeof name === 'string'
    && (name.startsWith(DEDUP_PREFIX) || name.startsWith(ND_DEDUP_PREFIX));
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');
}

// 计算 File/Blob 内容的 SHA-256（hex）。文件过大或读取失败时返回 null（视为不去重）。
export async function hashFileContent(file) {
  if (!file || typeof file.arrayBuffer !== 'function') return null;
  if (typeof file.size === 'number' && file.size > MAX_HASHABLE_BYTES) return null;
  try {
    return toHex(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
  } catch {
    return null;
  }
}

// 计算文本内容的 SHA-256（hex），用于网盘 JSON 文本上传。
export async function hashText(text) {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text))));
}

export async function getDedupEntry(env, key) {
  const record = await env.img_url.getWithMetadata(key);
  return record?.metadata || null;
}

export async function putDedupEntry(env, key, entry) {
  await env.img_url.put(key, '', { metadata: entry });
}

export async function deleteDedupEntry(env, key) {
  await env.img_url.delete(key);
}
