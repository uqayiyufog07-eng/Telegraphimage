// R2 路径工具：网盘文件在 R2 中用完整路径作为 key（如 "documents/work/report.pdf"）。
// 文件夹通过以 "/" 结尾的空对象 key 显式标记（如 "documents/"），便于 WebDAV MKCOL
// 语义和 list 时区分"空目录"与"不存在的目录"。

const DELIMITER = '/';

// 将用户输入的路径规范化为 R2 key 前缀（用于 list）。
// 规则：
//   - 去除首尾空白
//   - 去除开头多余的 "/"
//   - 折叠重复的 "/"
//   - 末尾补 "/" （作为目录前缀）
//   - 空字符串表示根目录（前缀为空）
//
// 示例：
//   normalizePath("")              => ""
//   normalizePath("/")             => ""
//   normalizePath("docs")          => "docs/"
//   normalizePath("/docs/")        => "docs/"
//   normalizePath("docs/work//x")  => "docs/work/x/"   （仅用于目录前缀场景）
//   normalizePath("../etc/passwd") => "etc/passwd/"    （剥离 .. 防止越界）
export function normalizePath(rawPath) {
  if (rawPath == null) return '';
  let p = String(rawPath).trim();
  // 剥离所有 ".." 段，防止路径穿越到网盘命名空间之外
  // （R2 本身没有真正的目录层级，但保留这一步让语义清晰）
  p = p.split(DELIMITER)
    .filter(seg => seg !== '' && seg !== '.' && seg !== '..')
    .join(DELIMITER);
  return p;
}

// 规范化为"文件 key"（不以 "/" 结尾）。用于上传/下载单个文件时确定 R2 key。
// 输入应是完整文件路径，如 "docs/report.pdf"。
export function normalizeFileKey(rawPath) {
  const dir = normalizePath(dirname(rawPath));
  const base = basename(rawPath);
  if (!base) return '';
  return dir ? `${dir}/${base}` : base;
}

// 规范化为"目录前缀"（以 "/" 结尾或为空）。
// 用于 list 的 prefix 参数、mkdir 的 key。
export function normalizeDirPrefix(rawPath) {
  const p = normalizePath(rawPath);
  return p ? p + DELIMITER : '';
}

// 从路径中提取目录部分（不含末尾 "/"）。
//   dirname("docs/report.pdf") => "docs"
//   dirname("report.pdf")      => ""
//   dirname("docs/")           => "docs"
export function dirname(rawPath) {
  const p = String(rawPath || '').trim().replace(/^\/+/, '');
  if (!p) return '';
  const idx = p.replace(/\/+$/, '').lastIndexOf(DELIMITER);
  if (idx < 0) return '';
  return p.slice(0, idx);
}

// 从路径中提取文件名部分。
//   basename("docs/report.pdf") => "report.pdf"
//   basename("report.pdf")      => "report.pdf"
//   basename("docs/")           => ""
//   basename("")                => ""
export function basename(rawPath) {
  const p = String(rawPath || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
  if (!p) return '';
  const idx = p.lastIndexOf(DELIMITER);
  return idx < 0 ? p : p.slice(idx + 1);
}

// 判断 R2 key 是否为文件夹标记（以 "/" 结尾）。
export function isFolderKey(key) {
  return typeof key === 'string' && key.endsWith(DELIMITER);
}

// 从 R2 list 结果中分离出目录条目（delimitedPrefixes）和文件条目（objects）。
// 文件夹标记对象（以 "/" 结尾的空对象）会被过滤掉，因为它们已由 delimitedPrefixes 表达。
//
// 返回:
//   { directories: string[], files: R2Object[] }
//   directories: 已去掉末尾 "/" 的目录名（相对路径），如 ["work", "photos"]
//   files: R2Object 数组（已排除文件夹标记对象）
export function parseListResult(result, basePrefix) {
  const directories = (result.delimitedPrefixes || []).map(prefix => {
    // 去掉 basePrefix 和末尾的 "/"
    let name = prefix;
    if (basePrefix && name.startsWith(basePrefix)) {
      name = name.slice(basePrefix.length);
    }
    return name.replace(/\/+$/, '');
  }).filter(Boolean);

  const files = (result.objects || []).filter(obj => !isFolderKey(obj.key));

  return { directories, files };
}

// 从 R2 key 中提取相对于某前缀的"显示名"。
//   displayName("docs/report.pdf", "docs/") => "report.pdf"
//   displayName("docs/report.pdf", "")       => "report.pdf"  （取最后一段）
export function displayName(key, basePrefix) {
  let name = key;
  if (basePrefix && name.startsWith(basePrefix)) {
    name = name.slice(basePrefix.length);
  }
  return name;
}

// 将路径段数组拼接为 R2 key（文件或目录）。
//   joinPath(["docs", "work"], false) => "docs/work"
//   joinPath(["docs", "work"], true)  => "docs/work/"
export function joinPath(segments, isDir = false) {
  const cleaned = (segments || [])
    .map(s => String(s || '').trim())
    .filter(s => s && s !== '.' && s !== '..');
  const joined = cleaned.join(DELIMITER);
  return isDir ? (joined ? joined + DELIMITER : '') : joined;
}

// 递归列出某前缀下的所有对象 key（用于删除文件夹、ZIP 打包）。
// 返回所有 R2Object 的数组。注意：会消耗多次 list 调用，大目录可能较慢。
export async function listAllObjects(bucket, prefix, maxResults = 10000) {
  const objects = [];
  let cursor = undefined;
  let safety = 0;

  do {
    if (objects.length >= maxResults) break;
    const opts = {
      limit: 1000,
      // 不使用 delimiter，递归列出全部
    };
    if (prefix) opts.prefix = prefix;
    if (cursor) opts.cursor = cursor;

    const page = await bucket.list(opts);
    for (const obj of page.objects) {
      objects.push(obj);
      if (objects.length >= maxResults) break;
    }
    cursor = page.truncated ? page.cursor : undefined;
    // 防御性循环上限
    if (++safety > 200) break;
  } while (cursor);

  return objects;
}
