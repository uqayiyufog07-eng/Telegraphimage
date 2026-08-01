import { telegramProvider } from './telegram.js';
import { r2Provider } from './r2.js';

// Re-exported so callers (e.g. upload.js) can pick R2 directly when routing
// large files, without reaching into the provider module.
export { r2Provider };

// Storage provider contract:
//   key                                       - tag persisted in KV metadata for provenance
//   validateConfig(env)                       - throws when required bindings/vars are missing
//   upload(env, file, { fileName, fileExtension }) -> long file id (string)
//   fetchFile(env, request, url, fileId)      -> Response with the file body
const PROVIDERS = {
    [telegramProvider.key]: telegramProvider,
    [r2Provider.key]: r2Provider,
};

export function getUploadProvider(env) {
    const name = (env.STORAGE_PROVIDER || telegramProvider.key).toLowerCase();
    const provider = PROVIDERS[name];

    if (!provider) {
        throw new Error(`Unknown STORAGE_PROVIDER: ${env.STORAGE_PROVIDER}`);
    }

    return provider;
}

// Look up a provider by name ('telegram' | 'r2'); returns null for unknown names.
// Used when a request explicitly overrides the configured default provider.
export function getProviderByName(name) {
    return PROVIDERS[String(name || '').toLowerCase()] || null;
}

// Ids are self-describing (R2 ids carry the 'r2-' prefix), so serving does not
// depend on a KV metadata read; ids that predate providers are Telegram/Telegraph.
export function getServingProvider(fileId) {
    if (r2Provider.ownsId(fileId)) {
        return r2Provider;
    }

    return telegramProvider;
}
