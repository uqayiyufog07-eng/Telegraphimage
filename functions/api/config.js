import { isEmptyBinding, jsonResponse } from '../utils/http.js';
import { isShortUrlsEnabled } from '../utils/shortlink.js';
import { getSetupStatus } from '../utils/setup-status.js';
import { authAvailable, registrationOpen, getRegistrationMode } from '../utils/users.js';
import { hasAnyWebDAVAccount, listWebDAVAccounts } from '../utils/webdav-auth.js';

// Public, non-sensitive site configuration for the frontend. Any static UI can
// read this once at startup instead of the deployment having to edit HTML.
export async function onRequestGet(context) {
    const { env } = context;
    const setup = getSetupStatus(env);

    const authEnabled = authAvailable(env);
    const regMode = authEnabled ? await getRegistrationMode(env) : 'closed';
    const regOpen = regMode !== 'closed';

    // WebDAV 状态：KV 动态账号 + env 凭证
    const r2Enabled = !!env.img_r2;
    let webdavKvCount = 0;
    let webdavKvHasAccounts = false;
    if (r2Enabled) {
        try {
            webdavKvHasAccounts = await hasAnyWebDAVAccount(env);
            if (webdavKvHasAccounts) {
                const accounts = await listWebDAVAccounts(env);
                webdavKvCount = accounts.length;
            }
        } catch {
            // KV 不可用时忽略
        }
    }
    const webdavEnvHasCreds = !isEmptyBinding(env.WEBDAV_USER) && !isEmptyBinding(env.WEBDAV_PASS);
    const basicEnvHasCreds = !isEmptyBinding(env.BASIC_USER) && !isEmptyBinding(env.BASIC_PASS);
    const webdavAuthRequired = r2Enabled && (webdavKvHasAccounts || webdavEnvHasCreds || basicEnvHasCreds);
    // webdavUser：仅当 env 有单一账号时暴露（向后兼容 netdisk 面板）；KV 多账号时不暴露
    const webdavUser = !isEmptyBinding(env.WEBDAV_USER) ? env.WEBDAV_USER : (!isEmptyBinding(env.BASIC_USER) ? env.BASIC_USER : null);

    return jsonResponse({
        siteName: env.SITE_NAME || '老钱303的云上空间',
        siteTitle: env.SITE_TITLE || env.SITE_NAME || '老钱303的云上空间 | 免费图床',
        backgroundImage: env.SITE_BACKGROUND || '',
        enableShortUrls: isShortUrlsEnabled(env),
        uploadRequiresAuth: !isEmptyBinding(env.UPLOAD_BASIC_USER) && !isEmptyBinding(env.UPLOAD_BASIC_PASS),
        showAdminEntry: env.HIDE_ADMIN_ENTRY !== 'true',
        // 用户系统（注册/登录）可用性
        authEnabled: authEnabled,
        registrationMode: regMode,
        registrationOpen: regOpen,
        inviteRequired: regMode === 'invite',
        // Netdisk & WebDAV availability (both require R2 binding)
        netdiskEnabled: r2Enabled,
        webdavEnabled: r2Enabled,
        webdavUrl: r2Enabled ? '/webdav' : null,
        // WebDAV auth status (expose only non-sensitive info)
        webdavAuthRequired: webdavAuthRequired,
        webdavUser: webdavUser,
        webdavAccountCount: webdavKvCount,
        // Storage targets the frontend may offer for uploads. The default comes
        // from STORAGE_PROVIDER; availability is derived from configured bindings.
        storage: {
            default: (env.STORAGE_PROVIDER || 'telegram').toLowerCase(),
            available: [
                ...(!isEmptyBinding(env.TG_Bot_Token) && !isEmptyBinding(env.TG_Chat_ID) ? ['telegram'] : []),
                ...(env.img_r2 ? ['r2'] : []),
            ],
        },
        // Deployment self-check so a misconfigured site says so instead of
        // failing silently on the first upload. Enum status only, no values.
        ready: setup.ready,
        setup: setup.checks,
        problems: setup.problems,
    }, {
        headers: { 'Cache-Control': 'no-store' },
    });
}
