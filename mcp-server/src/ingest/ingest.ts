import type { Operation } from '../core/types.js';
import { badRequest } from '../core/types.js';

type ProviderId = 'opencli' | 'media';
type IngestMode = 'web-capture' | 'browser-capture' | 'media-transcription' | 'manual';
type CapabilityStatus = 'ready' | 'needs_provider' | 'needs_browser_or_login' | 'manual_required';
type AccessContext =
  | 'public'
  | 'login_required'
  | 'cookie_required'
  | 'browser_required'
  | 'manual_required'
  | 'paywalled'
  | 'private'
  | 'deleted_or_unavailable'
  | 'region_blocked'
  | 'unknown';

interface ProviderDescriptor {
  id: ProviderId;
  name: 'OPENCLI' | 'MEDIA_TRANSCRIBE';
  env: string;
  fallbackEnv: string;
  purpose: string;
  outputContract: string;
}

interface PlatformProfile {
  platform: string;
  label: string;
  sourceType: 'web' | 'social' | 'article' | 'video' | 'audio' | 'podcast' | 'media' | 'unknown';
  sourceKind: 'url' | 'profile' | 'post' | 'video' | 'article' | 'episode' | 'file' | 'unknown';
  defaultProvider: ProviderId;
  confidence: 'high' | 'medium' | 'low';
  mode: IngestMode;
  accessContext: AccessContext;
  needs: string[];
  limitations: string[];
}

const PROVIDERS: Record<ProviderId, ProviderDescriptor> = {
  opencli: {
    id: 'opencli',
    name: 'OPENCLI',
    env: 'VAULT_MIND_OPENCLI_CMD',
    fallbackEnv: 'OPENCLI_CMD',
    purpose: 'OpenCLI plus BBX/browser bridge web capture, article extraction, browser-assisted clipping, and text-first source normalization.',
    outputContract: 'Save Markdown into the vault, preserving source URL and capture metadata.',
  },
  media: {
    id: 'media',
    name: 'MEDIA_TRANSCRIBE',
    env: 'VAULT_MIND_MEDIA_CMD',
    fallbackEnv: 'MEDIA_TRANSCRIBE_CMD',
    purpose: 'Audio/video parsing, download, subtitle handling, transcription, and media-first source normalization.',
    outputContract: 'Save transcript Markdown into the vault, preserving source URL, media metadata, parser provenance, and transcription provenance.',
  },
};

const LOGIN_LIMITATION = 'Login-gated, private, deleted, paywalled, or region-blocked content may require browser/cookie-assisted capture.';
const NO_BYPASS_LIMITATION = 'LLMwiki must not bypass platform access controls; use only content available to the user and configured providers.';

function hostMatches(host: string, candidates: string[]): boolean {
  return candidates.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
}

function parseInputUrl(value: unknown): URL {
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest('url must be a non-empty absolute URL');
  }
  try {
    const url = new URL(value);
    if (!url.protocol.startsWith('http')) throw new Error('unsupported protocol');
    return url;
  } catch {
    throw badRequest('url must be absolute http(s) URL');
  }
}

function directMediaProfile(url: URL): PlatformProfile | null {
  const path = `${url.pathname}${url.search}`.toLowerCase();
  if (/\.(mp3|m4a|wav|flac|ogg|aac)(\?|$)/i.test(path)) {
    return {
      platform: 'direct-audio',
      label: 'Direct audio file',
      sourceType: 'audio',
      sourceKind: 'file',
      defaultProvider: 'media',
      confidence: 'high',
      mode: 'media-transcription',
      accessContext: 'public',
      needs: ['readable media URL', 'media transcription provider'],
      limitations: [NO_BYPASS_LIMITATION],
    };
  }
  if (/\.(mp4|mov|mkv|webm|m4v)(\?|$)/i.test(path)) {
    return {
      platform: 'direct-video',
      label: 'Direct video file',
      sourceType: 'video',
      sourceKind: 'file',
      defaultProvider: 'media',
      confidence: 'high',
      mode: 'media-transcription',
      accessContext: 'public',
      needs: ['readable media URL', 'media parsing/download/transcription provider'],
      limitations: [NO_BYPASS_LIMITATION],
    };
  }
  return null;
}

function detectPlatform(url: URL): PlatformProfile {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const media = directMediaProfile(url);
  if (media) return media;

  if (hostMatches(host, ['youtube.com', 'youtu.be', 'youtube-nocookie.com'])) {
    return mediaProfile('youtube', 'YouTube', 'video', 'media-transcription', 'high', 'public', [
      'media parsing/download/transcription provider',
      'subtitles or transcription model',
      'cookies only when video requires authenticated access',
    ]);
  }

  if (hostMatches(host, ['bilibili.com', 'b23.tv'])) {
    return mediaProfile('bilibili', 'Bilibili', 'video', 'media-transcription', 'medium', 'cookie_required', [
      'media parsing/download/transcription provider',
      'subtitle/transcription support',
      'cookies for login-gated or high-risk videos',
    ]);
  }

  if (hostMatches(host, ['douyin.com', 'iesdouyin.com'])) {
    return mediaProfile('douyin', 'Douyin', 'video', 'browser-capture', 'low', 'browser_required', [
      'OPENCLI/BBX browser resolver for short links and page metadata',
      'media parsing/download/transcription provider',
      'authenticated browser or cookie-assisted capture when required',
    ], ['Short-video pages change frequently; expect manual fallback.']);
  }

  if (hostMatches(host, ['tiktok.com', 'vm.tiktok.com'])) {
    return mediaProfile('tiktok', 'TikTok', 'video', 'browser-capture', 'medium', 'browser_required', [
      'OPENCLI/BBX browser resolver for short links and page metadata',
      'media parsing/download/transcription provider',
    ], ['TikTok links may need browser resolution before media download/transcription.']);
  }

  if (hostMatches(host, ['xiaohongshu.com', 'xhslink.com'])) {
    return webProfile('xiaohongshu', 'Xiaohongshu', 'social', 'browser-capture', 'low', 'browser_required', [
      'OPENCLI browser-assisted capture',
      'authenticated browser session when required',
      'media provider for video notes',
    ], ['Video notes may need a second media parsing/download/transcription step.']);
  }

  if (hostMatches(host, ['x.com', 'twitter.com'])) {
    return webProfile('x', 'X / Twitter', 'social', 'browser-capture', 'medium', 'browser_required', [
      'OPENCLI browser-assisted capture',
      'authenticated browser session for login-gated posts',
    ], ['Threads, quote posts, deleted replies, and media need manual review.']);
  }

  if (hostMatches(host, ['weibo.com', 'weibo.cn', 'm.weibo.cn'])) {
    return webProfile('weibo', 'Weibo', 'social', 'browser-capture', 'medium', 'browser_required', [
      'OPENCLI/BBX browser-assisted capture',
      'authenticated browser session for login-gated posts',
      'media provider for video posts',
    ], ['Video posts may need a second media parsing/download/transcription step.']);
  }

  if (hostMatches(host, ['mp.weixin.qq.com', 'weixin.qq.com'])) {
    return webProfile('wechat-official-account', 'WeChat Official Account', 'article', 'web-capture', 'medium', 'public', [
      'OPENCLI article capture',
      'browser session when article blocks anonymous access',
    ]);
  }

  if (hostMatches(host, ['zhihu.com', 'zhuanlan.zhihu.com'])) {
    return webProfile('zhihu', 'Zhihu', 'article', 'web-capture', 'medium', 'login_required', [
      'OPENCLI article/question/answer capture',
      'browser session when content blocks anonymous access',
    ], ['Answers folded behind login or app prompts may need browser-assisted capture.']);
  }

  if (
    hostMatches(host, ['podcasts.apple.com', 'open.spotify.com', 'podcasters.spotify.com'])
    || /\.xml(\?|$)/i.test(url.pathname)
  ) {
    return {
      platform: 'podcast',
      label: 'Podcast',
      sourceType: 'podcast',
      sourceKind: 'episode',
      defaultProvider: 'media',
      confidence: 'medium',
      mode: 'media-transcription',
      accessContext: 'public',
      needs: ['media audio/transcription provider', 'episode audio URL or provider-supported podcast page'],
      limitations: ['Some podcast pages require resolving the episode media URL first.', NO_BYPASS_LIMITATION],
    };
  }

  return webProfile('generic-web', 'Generic web page', 'web', 'web-capture', 'medium', 'public', ['OPENCLI web capture']);
}

function mediaProfile(
  platform: string,
  label: string,
  sourceKind: PlatformProfile['sourceKind'],
  mode: IngestMode,
  confidence: PlatformProfile['confidence'],
  accessContext: AccessContext,
  needs: string[],
  extraLimitations: string[] = [],
): PlatformProfile {
  return {
    platform,
    label,
    sourceType: 'video',
    sourceKind,
    defaultProvider: 'media',
    confidence,
    mode,
    accessContext,
    needs,
    limitations: [LOGIN_LIMITATION, ...extraLimitations, NO_BYPASS_LIMITATION],
  };
}

function webProfile(
  platform: string,
  label: string,
  sourceType: PlatformProfile['sourceType'],
  mode: IngestMode,
  confidence: PlatformProfile['confidence'],
  accessContext: AccessContext,
  needs: string[],
  extraLimitations: string[] = [],
): PlatformProfile {
  return {
    platform,
    label,
    sourceType,
    sourceKind: sourceType === 'article' ? 'article' : 'post',
    defaultProvider: 'opencli',
    confidence,
    mode,
    accessContext,
    needs,
    limitations: [LOGIN_LIMITATION, ...extraLimitations, NO_BYPASS_LIMITATION],
  };
}

function providerConfig(provider: ProviderId): { configured: boolean; command: string; env: string; fallbackEnv: string } {
  const descriptor = PROVIDERS[provider];
  const command = process.env[descriptor.env] || process.env[descriptor.fallbackEnv] || provider;
  return {
    configured: Boolean(process.env[descriptor.env] || process.env[descriptor.fallbackEnv]),
    command,
    env: descriptor.env,
    fallbackEnv: descriptor.fallbackEnv,
  };
}

function chooseProvider(profile: PlatformProfile, preferred: unknown): ProviderId {
  if (preferred === undefined || preferred === null || preferred === '' || preferred === 'auto') {
    return profile.defaultProvider;
  }
  if (preferred === 'opencli' || preferred === 'media') return preferred;
  if (preferred === 'openttpe') return 'media';
  throw badRequest('preferredProvider must be auto, opencli, or media');
}

function statusFor(profile: PlatformProfile, configured: boolean): CapabilityStatus {
  if (!configured) return 'needs_provider';
  if (profile.mode === 'browser-capture') return 'needs_browser_or_login';
  if (profile.mode === 'manual' || profile.confidence === 'low') return 'manual_required';
  return 'ready';
}

function nextAction(status: CapabilityStatus, provider: ProviderDescriptor, config: { command: string; env: string; fallbackEnv: string }): string {
  if (status === 'needs_provider') {
    return `Configure ${provider.name} with ${config.env} or ${config.fallbackEnv}; then run the provider to produce Markdown in the vault.`;
  }
  if (status === 'needs_browser_or_login') {
    return `Use ${provider.name} with browser/cookie-assisted access as needed; claim success only after Markdown lands in the vault and query.unified can find it.`;
  }
  if (status === 'manual_required') {
    return `Try ${provider.name}, but expect manual/Web Clipper fallback; LLMwiki should only claim success after a local Markdown note exists.`;
  }
  return `Run ${provider.name} via ${config.command}; once Markdown lands in the vault, use query.unified for cited analysis.`;
}

function recommendedVaultPath(profile: PlatformProfile): string {
  if (profile.defaultProvider === 'media') return '素材库/media/<source-slug>.md';
  if (profile.sourceType === 'article') return '素材库/articles/<source-slug>.md';
  return '素材库/web/<source-slug>.md';
}

function pipelineFor(profile: PlatformProfile, primary: ProviderId): Array<Record<string, unknown>> {
  const ids: ProviderId[] = ['douyin', 'xiaohongshu', 'tiktok', 'weibo'].includes(profile.platform)
    ? ['opencli', 'media']
    : [primary];

  return ids.map((id) => {
    const provider = PROVIDERS[id];
    const config = providerConfig(id);
    return {
      id: provider.id,
      name: provider.name,
      configured: config.configured,
      command: config.command,
      capability: id === 'opencli' ? 'resolve.capture' : 'media.transcribe',
      role: id === 'opencli'
        ? 'resolve browser/page/source metadata and capture text-first material'
        : 'parse/download media and produce transcript Markdown',
    };
  });
}

export function preflight(params: Record<string, unknown>): Record<string, unknown> {
  const url = parseInputUrl(params.url);
  const profile = detectPlatform(url);
  const providerId = chooseProvider(profile, params.preferredProvider);
  const provider = PROVIDERS[providerId];
  const config = providerConfig(providerId);
  const status = statusFor(profile, config.configured);

  return {
    url: url.toString(),
    platform: profile.platform,
    label: profile.label,
    sourceType: profile.sourceType,
    sourceKind: profile.sourceKind,
    access_context: profile.accessContext,
    mode: profile.mode,
    provider: {
      id: provider.id,
      name: provider.name,
      configured: config.configured,
      command: config.command,
      env: config.env,
      fallbackEnv: config.fallbackEnv,
      purpose: provider.purpose,
    },
    pipeline: pipelineFor(profile, providerId),
    can_auto_ingest: status === 'ready',
    status,
    confidence: profile.confidence,
    needs: profile.needs,
    limitations: profile.limitations,
    output_contract: provider.outputContract,
    recommended_vault_path: recommendedVaultPath(profile),
    next_action: nextAction(status, provider, config),
  };
}

export function makeIngestOps(): Operation[] {
  return [
    {
      name: 'ingest.providers',
      namespace: 'ingest',
      description: 'List supported local ingest providers. LLMwiki routes to OPENCLI for text/web capture and MEDIA_TRANSCRIBE for audio/video parsing, download, and transcription; it does not bundle platform scrapers.',
      mutating: false,
      params: {},
      handler: async () => ({
        providers: Object.values(PROVIDERS).map((provider) => {
          const config = providerConfig(provider.id);
          return {
            id: provider.id,
            name: provider.name,
            configured: config.configured,
            command: config.command,
            env: config.env,
            fallbackEnv: config.fallbackEnv,
            purpose: provider.purpose,
            output_contract: provider.outputContract,
          };
        }),
      }),
    },
    {
      name: 'ingest.link.preflight',
      namespace: 'ingest',
      description: 'Classify a source URL and route it to OPENCLI or MEDIA_TRANSCRIBE. Read-only capability check; capture succeeds only after a provider writes Markdown into the vault.',
      mutating: false,
      params: {
        url: { type: 'string', required: true, description: 'Absolute source URL to classify' },
        preferredProvider: {
          type: 'string',
          required: false,
          enum: ['auto', 'opencli', 'media'],
          default: 'auto',
          description: 'Override provider routing when needed',
        },
      },
      handler: async (_ctx, params) => preflight(params),
    },
  ];
}
