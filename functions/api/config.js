import { isEmptyBinding, jsonResponse } from '../utils/http.js';
import { isShortUrlsEnabled } from '../utils/shortlink.js';
import { getSetupStatus } from '../utils/setup-status.js';
import { ownerPasswordSet } from '../utils/owner-auth.js';

// Public, non-sensitive site configuration for the frontend. Any static UI can
// read this once at startup instead of the deployment having to edit HTML.
export async function onRequestGet(context) {
    const { env } = context;
    const setup = getSetupStatus(env);

    const ownerAuthEnabled = ownerPasswordSet(env);

    // WebDAV 状态：仅依赖 env 凭证（单所有者模式）
    const r2Enabled = !!env.img_r2;
    const webdavEnvHasCreds = !isEmptyBinding(env.WEBDAV_USER) && !isEmptyBinding(env.WEBDAV_PASS);
    const basicEnvHasCreds = !isEmptyBinding(env.BASIC_USER) && !isEmptyBinding(env.BASIC_PASS);
    const webdavAuthRequired = r2Enabled && (webdavEnvHasCreds || basicEnvHasCreds);
    // webdavUser：暴露当前生效的单一账号（兼容 netdisk 面板展示）
    const webdavUser = !isEmptyBinding(env.WEBDAV_USER) ? env.WEBDAV_USER : (!isEmptyBinding(env.BASIC_USER) ? env.BASIC_USER : null);

    return jsonResponse({
        siteName: env.SITE_NAME || '老钱303的云上空间',
        siteTitle: env.SITE_TITLE || env.SITE_NAME || '老钱303的云上空间 | 免费图床',
        backgroundImage: env.SITE_BACKGROUND || '',
        enableShortUrls: isShortUrlsEnabled(env),
        uploadRequiresAuth: !isEmptyBinding(env.UPLOAD_BASIC_USER) && !isEmptyBinding(env.UPLOAD_BASIC_PASS),
        // 所有者鉴权（单用户）是否启用
        ownerAuthEnabled: ownerAuthEnabled,
        // Netdisk & WebDAV availability (both require R2 binding)
        netdiskEnabled: r2Enabled,
        webdavEnabled: r2Enabled,
        webdavUrl: r2Enabled ? '/webdav' : null,
        // WebDAV auth status (expose only non-sensitive info)
        webdavAuthRequired: webdavAuthRequired,
        webdavUser: webdavUser,
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
