import { isEmptyBinding, jsonResponse } from '../utils/http.js';
import { isShortUrlsEnabled } from '../utils/shortlink.js';
import { getSetupStatus } from '../utils/setup-status.js';

// Public, non-sensitive site configuration for the frontend. Any static UI can
// read this once at startup instead of the deployment having to edit HTML.
export async function onRequestGet(context) {
    const { env } = context;
    const setup = getSetupStatus(env);

    return jsonResponse({
        siteName: env.SITE_NAME || 'Telegraph-Image',
        siteTitle: env.SITE_TITLE || env.SITE_NAME || 'Telegraph-Image | 免费图床',
        backgroundImage: env.SITE_BACKGROUND || '',
        enableShortUrls: isShortUrlsEnabled(env),
        uploadRequiresAuth: !isEmptyBinding(env.UPLOAD_BASIC_USER) && !isEmptyBinding(env.UPLOAD_BASIC_PASS),
        showAdminEntry: env.HIDE_ADMIN_ENTRY !== 'true',
        // Netdisk & WebDAV availability (both require R2 binding)
        netdiskEnabled: !!env.img_r2,
        webdavEnabled: !!env.img_r2,
        webdavUrl: env.img_r2 ? '/webdav' : null,
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
