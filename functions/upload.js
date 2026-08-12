import { authenticateUploadRequest } from "./utils/auth.js";
import { isOwnerLoggedIn } from "./utils/owner-auth.js";
import { jsonResponse } from "./utils/http.js";
import { handleFileUpload } from "./utils/upload-core.js";

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

        return await handleFileUpload(request, env);
    } catch (error) {
        console.error('Upload error:', error);
        return jsonResponse({ error: error.message }, { status: 500 });
    }
}