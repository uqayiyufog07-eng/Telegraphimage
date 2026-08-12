import { jsonResponse } from '../../utils/http.js';
import { handleFileUpload } from '../../utils/upload-core.js';

// 图床统一上传接口：POST /api/imgbed/upload（multipart/form-data，字段 file、可选 provider）
// 根中间件已保证所有者鉴权；此处仅调用共享上传核心。
export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    return await handleFileUpload(request, env);
  } catch (error) {
    console.error('imgbed upload error:', error);
    return jsonResponse({ error: error.message }, { status: 500 });
  }
}