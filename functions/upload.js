import { authenticateUploadRequest } from "./utils/auth.js";
import { isOwnerLoggedIn } from "./utils/owner-auth.js";
import { jsonResponse } from "./utils/http.js";
import { createDefaultMetadata, getMetadata, putMetadata } from "./utils/metadata.js";
import { allocateShortId, isShortUrlsEnabled, putShortLink } from "./utils/shortlink.js";
import { getProviderByName, getUploadProvider, r2Provider } from "./storage/index.js";
import { dedupKey, deleteDedupEntry, getDedupEntry, hashFileContent, putDedupEntry } from "./utils/dedup.js";

// Files larger than this threshold are automatically routed to the R2 bucket,
// regardless of STORAGE_PROVIDER. Telegram Bot API rejects files > 20 MB anyway,
// so this keeps big uploads working without manual config.
// Override with the R2_AUTO_THRESHOLD_BYTES env var (bytes).
const R2_AUTO_THRESHOLD_BYTES = 20 * 1024 * 1024;

function pickProvider(env, fileSize, requestedName) {
    const threshold = parseThresholdBytes(env.R2_AUTO_THRESHOLD_BYTES);

    if (fileSize > threshold) {
        return r2Provider;
    }
    if (requestedName) {
        const provider = getProviderByName(requestedName);
        if (!provider) {
            throw new Error(`Unknown provider: ${requestedName}. Available: telegram, r2`);
        }
        return provider;
    }
    return getUploadProvider(env);
}

function parseThresholdBytes(raw) {
    if (!raw) return R2_AUTO_THRESHOLD_BYTES;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : R2_AUTO_THRESHOLD_BYTES;
}

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        // 所有者通过 Web 登录态访问时跳过 UPLOAD_BASIC 校验；
        // 否则回退到原有 Basic Auth（API 脚本场景）。
        if (!await isOwnerLoggedIn(request, env)) {
            const authResponse = authenticateUploadRequest(request, env);
            if (authResponse) {
                return authResponse;
            }
        }

        const url = new URL(request.url);
        const clonedRequest = request.clone();
        const formData = await clonedRequest.formData();

        const uploadFile = formData.get('file');
        if (!uploadFile) {
            throw new Error('No file uploaded');
        }

        const fileName = uploadFile.name;
        const fileExtension = fileName.split('.').pop().toLowerCase();

        // 存储目标：默认取 STORAGE_PROVIDER，可用 ?provider=r2|telegram
        // 或表单字段 provider 覆盖；超大文件仍强制走 R2。
        const requestedProvider = url.searchParams.get('provider') || formData.get('provider') || '';
        const provider = pickProvider(env, uploadFile.size, requestedProvider);
        provider.validateConfig(env);

        // 内容去重：相同内容的文件直接返回已有链接，不重复存储。
        let fileHash = null;
        if (env.img_url) {
            fileHash = await hashFileContent(uploadFile);
            if (fileHash) {
                const existing = await getDedupEntry(env, dedupKey(fileHash));
                if (existing?.fileId) {
                    const existingMeta = await getMetadata(env, existing.fileId);
                    if (existingMeta) {
                        return jsonResponse([{ 'src': existing.src || `/file/${existing.fileId}`, 'deduplicated': true }]);
                    }
                    // 原文件已被删除（KV 元数据不存在）-> 清理过期去重记录，继续正常上传
                    await deleteDedupEntry(env, dedupKey(fileHash));
                }
            }
        }

        const longId = await provider.upload(env, uploadFile, { fileName, fileExtension });
        let shortId = null;

        // 将文件信息保存到 KV 存储
        if (env.img_url) {
            if (isShortUrlsEnabled(env)) {
                shortId = await allocateShortId(env);
            }

            await putMetadata(env, longId, createDefaultMetadata(longId, {
                fileName,
                fileSize: uploadFile.size,
                provider: provider.key,
                ...(shortId ? { shortId } : {}),
                ...(fileHash ? { fileHash } : {}),
            }));

            if (shortId) {
                await putShortLink(env, shortId, longId);
            }

            if (fileHash) {
                await putDedupEntry(env, dedupKey(fileHash), {
                    fileId: longId,
                    src: `/file/${shortId || longId}`,
                    provider: provider.key,
                    fileName,
                    fileSize: uploadFile.size,
                    createdAt: Date.now(),
                });
            }
        }

        return jsonResponse([{ 'src': `/file/${shortId || longId}` }]);
    } catch (error) {
        console.error('Upload error:', error);
        return jsonResponse({ error: error.message }, { status: 500 });
    }
}
