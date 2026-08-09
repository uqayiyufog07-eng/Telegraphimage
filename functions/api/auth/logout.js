import { ownerLogoutResponse } from '../../utils/owner-auth.js';

// 退出登录：POST /api/auth/logout
// 清除 wb_owner Cookie（无状态会话，无需删除服务端记录）。
export async function onRequestPost(context) {
  const { request } = context;
  return ownerLogoutResponse(request);
}
