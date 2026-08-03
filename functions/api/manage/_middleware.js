import {
    basicAuthentication,
    basicAuthChallengeResponse,
    dashboardDisabledResponse,
    unauthorizedResponse,
} from "../../utils/auth.js";
import { isEmptyBinding } from "../../utils/http.js";
import { authAvailable, isAdminSession } from "../../utils/users.js";

async function errorHandling(context) {
    try {
      return await context.next();
    } catch (err) {
      return new Response(err.message + '\n' + err.stack, { status: 500 });
    }
  }

  async function authentication(context) {
    // 用户系统未启用时，回退纯 BASIC 鉴权
    if (isEmptyBinding(context.env.img_url)) {
        if (isEmptyBinding(context.env.BASIC_USER)) {
            return context.next();
        }
        if (!context.request.headers.has('Authorization')) {
            return basicAuthChallengeResponse();
        }
        const credentials = basicAuthentication(context.request);
        if (credentials instanceof Response) {
            return credentials;
        }
        if (context.env.BASIC_USER !== credentials.user || context.env.BASIC_PASS !== credentials.pass) {
            return unauthorizedResponse('Invalid credentials.');
        }
        return context.next();
    }

    // 1. 优先：管理员 session
    if (authAvailable(context.env)) {
        const session = await isAdminSession(context.request, context.env);
        if (session) {
            context.data.user = session;
            return context.next();
        }
    }

    // 2. 回退：BASIC 凭证（兼容 API 脚本 / WebDAV 客户端）
    if (!isEmptyBinding(context.env.BASIC_USER)) {
        if (!context.request.headers.has('Authorization')) {
            return basicAuthChallengeResponse();
        }
        const credentials = basicAuthentication(context.request);
        if (credentials instanceof Response) {
            return credentials;
        }
        if (context.env.BASIC_USER !== credentials.user || context.env.BASIC_PASS !== credentials.pass) {
            return unauthorizedResponse('Invalid credentials.');
        }
        return context.next();
    }

    // 3. 用户系统启用但未配置 BASIC，且非管理员 session → 拒绝
    return dashboardDisabledResponse();
  }
  
  export const onRequest = [errorHandling, authentication];
