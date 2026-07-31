import { errorHandling, telemetryData } from "./utils/middleware.js";
import { authenticateUploadRequest } from "./utils/auth.js";
import { jsonResponse } from "./utils/http.js";
import { createDefaultMetadata, putMetadata } from "./utils/metadata.js";
import { allocateShortId, isShortUrlsEnabled, putShortLink } from "./utils/shortlink.js";
import { getUploadProvider, r2Provider } from "./storage/index.js";

// Files larger than this threshold are automatically routed to the R2 bucket,
// regardless of STORAGE_PROVIDER. Telegram Bot API rejects files > 20 MB anyway,
// so this keeps big uploads working without manual config.
// Override with the R2_AUTO_THRESHOLD_BYTES env var (bytes).
const R2_AUTO_THRESHOLD_BYTES = 20 * 1024 * 1024;

function pickProvider(env, fileSize) {
    const baseProvider = getUploadProvider(env);
    const threshold = parseThresholdBytes(env.R2_AUTO_THRESHOLD_BYTES);

    if (fileSize > threshold) {
        return r2Provider;
    }
    return baseProvider;
}

function parseThresholdBytes(raw) {
    if (!raw) return R2_AUTO_THRESHOLD_BYTES;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : R2_AUTO_THRESHOLD_BYTES;
}

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const authResponse = authenticateUploadRequest(request, env);
        if (authResponse) {
            return authResponse;
        }

        const clonedRequest = request.clone();
        const formData = await clonedRequest.formData();

        await errorHandling(context);
        telemetryData(context);

        const uploadFile = formData.get('file');
        if (!uploadFile) {
            throw new Error('No file uploaded');
        }

        const fileName = uploadFile.name;
        const fileExtension = fileName.split('.').pop().toLowerCase();

        // Route large files to R2 automatically; falls back to the configured
        // provider for everything else.
        const provider = pickProvider(env, uploadFile.size);
        provider.validateConfig(env);

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
            }));

            if (shortId) {
                await putShortLink(env, shortId, longId);
            }
        }

        return jsonResponse([{ 'src': `/file/${shortId || longId}` }]);
    } catch (error) {
        console.error('Upload error:', error);
        return jsonResponse({ error: error.message }, { status: 500 });
    }
}
