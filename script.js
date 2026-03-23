const SUPPORTED_LANGS = ['en', 'ja', 'zh', 'es', 'hi'];
const DEFAULT_LANG = 'en';
const APP_NAME = 'Device Specs Viewer';
const APP_VERSION = '0.1.0';

const state = {
  lang: DEFAULT_LANG,
  translations: {},
  collected: null,
  logs: [],
};

const DEBUG_ENABLED = (() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('debug') === '1') {
    safeStorageSet('dsv-debug', '1');
    return true;
  }
  return safeStorageGet('dsv-debug') === '1';
})();

function normalizeLang(lang) {
  if (!lang) return null;
  const lower = lang.toLowerCase();
  if (SUPPORTED_LANGS.includes(lower)) return lower;
  const base = lower.split('-')[0];
  return SUPPORTED_LANGS.includes(base) ? base : null;
}

function detectLanguage() {
  const candidates = Array.isArray(navigator.languages)
    ? navigator.languages
    : [navigator.language];

  for (const lang of candidates) {
    const normalized = normalizeLang(lang);
    if (normalized) return normalized;
  }

  return DEFAULT_LANG;
}

async function loadTranslations(lang) {
  const response = await fetch(`locales/${lang}.json`);
  if (!response.ok) {
    throw new Error(`Missing locale file for ${lang}`);
  }
  return response.json();
}

function applyTranslations() {
  const elements = document.querySelectorAll('[data-i18n]');
  elements.forEach((el) => {
    const key = el.getAttribute('data-i18n');
    const value = state.translations[key];
    if (value) {
      el.textContent = value;
    }
  });
  const ariaElements = document.querySelectorAll('[data-i18n-aria]');
  ariaElements.forEach((el) => {
    const key = el.getAttribute('data-i18n-aria');
    const value = state.translations[key];
    if (value) {
      el.setAttribute('aria-label', value);
    }
  });
  document.documentElement.lang = state.lang;
}

function t(key, vars = null) {
  const template = state.translations[key] || key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, token) => {
    if (vars[token] === undefined || vars[token] === null) return match;
    return String(vars[token]);
  });
}

async function setLanguage(lang, persist = true) {
  const normalized = normalizeLang(lang) || DEFAULT_LANG;
  try {
    state.translations = await loadTranslations(normalized);
    state.lang = normalized;
    applyTranslations();
    if (state.collected) {
      renderData(state.collected);
    }
    if (persist) {
      safeStorageSet('dsv-lang', normalized);
    }
  } catch (error) {
    if (normalized !== DEFAULT_LANG) {
      await setLanguage(DEFAULT_LANG, persist);
      return;
    }
    console.error(error);
  }
}

function getInitialLanguage() {
  const stored = safeStorageGet('dsv-lang');
  return normalizeLang(stored) || detectLanguage();
}

async function initLanguageSelector() {
  const select = document.getElementById('language-select');
  if (!select) return;

  select.addEventListener('change', (event) => {
    setLanguage(event.target.value);
  });

  const initial = getInitialLanguage();
  select.value = initial;
  await setLanguage(initial, false);
}

document.addEventListener('DOMContentLoaded', () => {
  initDebugPanel();
  initTooltips();
  initExportActions();
  Promise.all([initLanguageSelector(), collectAllData()]).then(([, data]) => {
    state.collected = data;
    renderData(data);
  });
});

function safeStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

function safeStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    // Storage may be blocked in some contexts; ignore.
  }
}

function logEvent(level, message, data = null) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    data,
  };
  state.logs.push(entry);
  if (DEBUG_ENABLED) {
    const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    logger(`[DSV] ${message}`, data ?? '');
  }
}

const QUALITY = Object.freeze({
  EXACT: 'exact',
  ESTIMATED: 'estimated',
  ALTERNATIVE: 'alternative',
  UNAVAILABLE: 'unavailable',
});

function field(value, options = {}) {
  return {
    value,
    raw: options.raw ?? null,
    quality: options.quality ?? QUALITY.UNAVAILABLE,
    notes: options.notes ?? null,
    source: options.source ?? null,
  };
}

function detectOSFamily(ua) {
  if (/windows/i.test(ua)) return 'Windows';
  if (/android/i.test(ua)) return 'Android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
  if (/mac os x/i.test(ua)) return 'macOS';
  if (/cros/i.test(ua)) return 'ChromeOS';
  if (/linux/i.test(ua)) return 'Linux';
  return 'Unknown';
}

function parseBrowser(ua) {
  if (/edg\//i.test(ua)) return { name: 'Microsoft Edge', version: ua.match(/edg\/([\d.]+)/i)?.[1] };
  if (/chrome\//i.test(ua) && !/edg\//i.test(ua)) return { name: 'Google Chrome', version: ua.match(/chrome\/([\d.]+)/i)?.[1] };
  if (/firefox\//i.test(ua)) return { name: 'Mozilla Firefox', version: ua.match(/firefox\/([\d.]+)/i)?.[1] };
  if (/safari\//i.test(ua) && /version\//i.test(ua)) return { name: 'Apple Safari', version: ua.match(/version\/([\d.]+)/i)?.[1] };
  return { name: 'Unknown', version: null };
}

function getWebGLInfo() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  if (!gl) return null;

  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const vendor = debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);

  return { renderer, vendor };
}

function supportsLocalStorage() {
  try {
    return 'localStorage' in window && window.localStorage !== null;
  } catch (error) {
    return false;
  }
}

function supportsSessionStorage() {
  try {
    return 'sessionStorage' in window && window.sessionStorage !== null;
  } catch (error) {
    return false;
  }
}

async function copyText(text) {
  if (!text) return false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      return false;
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  let success = false;
  try {
    success = document.execCommand('copy');
  } catch (error) {
    success = false;
  }
  document.body.removeChild(textarea);
  return success;
}

async function collectAllData() {
  logEvent('info', 'Starting data collection');
  const ua = navigator.userAgent || '';
  const osFamily = detectOSFamily(ua);
  const browser = parseBrowser(ua);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown';
  const languages = navigator.languages?.length
    ? navigator.languages
    : [navigator.language].filter(Boolean);
  const platform = navigator.platform || 'Unknown';
  const deviceMemory = typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : null;
  const hardwareConcurrency =
    typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null;
  const webglInfo = getWebGLInfo();
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  const hasWebGL = !!webglInfo;
  const storageEstimate = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
  logEvent('info', 'Collected base environment signals', {
    osFamily,
    browser: browser.name,
    hasConnectionApi: !!connection,
    hasStorageEstimate: !!storageEstimate,
  });

  return {
    timestamp: new Date().toISOString(),
    system: {
      osName: field(osFamily === 'Unknown' ? 'Unavailable in browser' : osFamily, {
        raw: ua,
        quality: osFamily === 'Unknown' ? QUALITY.UNAVAILABLE : QUALITY.ALTERNATIVE,
        notes: osFamily === 'Unknown' ? 'OS name is not exposed directly.' : 'Derived from user agent string.',
        source: 'navigator.userAgent',
      }),
      osFamily: field(osFamily === 'Unknown' ? 'Unavailable in browser' : osFamily, {
        raw: ua,
        quality: osFamily === 'Unknown' ? QUALITY.UNAVAILABLE : QUALITY.ALTERNATIVE,
        notes: osFamily === 'Unknown' ? 'OS family is not exposed directly.' : 'Derived from user agent string.',
        source: 'navigator.userAgent',
      }),
      timezone: field(timezone, {
        raw: timezone,
        quality: QUALITY.EXACT,
        source: 'Intl.DateTimeFormat().resolvedOptions().timeZone',
      }),
      languages: field(languages.length ? languages.join(', ') : 'Unavailable in browser', {
        raw: languages,
        quality: languages.length ? QUALITY.EXACT : QUALITY.UNAVAILABLE,
        source: 'navigator.languages',
      }),
      platform: field(platform || 'Unavailable in browser', {
        raw: platform,
        quality: platform ? QUALITY.ALTERNATIVE : QUALITY.UNAVAILABLE,
        notes: platform ? 'Browser-reported platform string.' : 'Platform is not exposed.',
        source: 'navigator.platform',
      }),
    },
    cpu: {
      name: field('Unavailable in browser', {
        quality: QUALITY.UNAVAILABLE,
        notes: 'Exact CPU model is not exposed to web pages.',
      }),
      threads: field(hardwareConcurrency ? `${hardwareConcurrency}` : 'Unavailable in browser', {
        raw: hardwareConcurrency,
        quality: hardwareConcurrency ? QUALITY.EXACT : QUALITY.UNAVAILABLE,
        source: 'navigator.hardwareConcurrency',
      }),
      hints: field(
        hardwareConcurrency ? `hardwareConcurrency = ${hardwareConcurrency}` : 'Unavailable in browser',
        {
          raw: hardwareConcurrency,
          quality: hardwareConcurrency ? QUALITY.ALTERNATIVE : QUALITY.UNAVAILABLE,
          notes: 'Logical processor count reported by the browser.',
          source: 'navigator.hardwareConcurrency',
        }
      ),
    },
    memory: {
      total: field(deviceMemory ? `${deviceMemory} GiB` : 'Unavailable in browser', {
        raw: deviceMemory,
        quality: deviceMemory ? QUALITY.ESTIMATED : QUALITY.UNAVAILABLE,
        notes: deviceMemory ? 'Approximate device memory bucket.' : 'Device memory API unavailable.',
        source: 'navigator.deviceMemory',
      }),
      used: field('Unavailable in browser', {
        quality: QUALITY.UNAVAILABLE,
        notes: 'Used memory is not exposed to web pages.',
      }),
      free: field('Unavailable in browser', {
        quality: QUALITY.UNAVAILABLE,
        notes: 'Free memory is not exposed to web pages.',
      }),
    },
    graphics: {
      renderer: field(webglInfo?.renderer || 'Unavailable in browser', {
        raw: webglInfo,
        quality: webglInfo?.renderer ? QUALITY.ALTERNATIVE : QUALITY.UNAVAILABLE,
        notes: webglInfo?.renderer ? 'WebGL renderer string; may be masked.' : 'WebGL unavailable.',
        source: 'WebGL',
      }),
      vendor: field(webglInfo?.vendor || 'Unavailable in browser', {
        raw: webglInfo,
        quality: webglInfo?.vendor ? QUALITY.ALTERNATIVE : QUALITY.UNAVAILABLE,
        notes: webglInfo?.vendor ? 'WebGL vendor string; may be masked.' : 'WebGL unavailable.',
        source: 'WebGL',
      }),
      vramTotal: field('Unavailable in browser', {
        quality: QUALITY.UNAVAILABLE,
        notes: 'VRAM values are not exposed to web pages.',
      }),
      vramUsed: field('Unavailable in browser', {
        quality: QUALITY.UNAVAILABLE,
        notes: 'VRAM values are not exposed to web pages.',
      }),
      vramFree: field('Unavailable in browser', {
        quality: QUALITY.UNAVAILABLE,
        notes: 'VRAM values are not exposed to web pages.',
      }),
    },
    network: {
      status: field(navigator.onLine, {
        raw: navigator.onLine,
        quality: QUALITY.EXACT,
        source: 'navigator.onLine',
      }),
      type: field(connection?.effectiveType || 'Unavailable in browser', {
        raw: connection?.effectiveType || null,
        quality: connection?.effectiveType ? QUALITY.ESTIMATED : QUALITY.UNAVAILABLE,
        notes: connection?.effectiveType
          ? 'Reported by Network Information API.'
          : 'Network Information API unavailable.',
        source: 'navigator.connection',
      }),
      downlink: field(
        typeof connection?.downlink === 'number'
          ? `${connection.downlink} Mbps`
          : 'Unavailable in browser',
        {
          raw: connection?.downlink ?? null,
          quality:
            typeof connection?.downlink === 'number'
              ? QUALITY.ESTIMATED
              : QUALITY.UNAVAILABLE,
          notes:
            typeof connection?.downlink === 'number'
              ? 'Estimated downlink speed.'
              : 'Network Information API unavailable.',
          source: 'navigator.connection',
        }
      ),
      rtt: field(
        typeof connection?.rtt === 'number'
          ? `${connection.rtt} ms`
          : 'Unavailable in browser',
        {
          raw: connection?.rtt ?? null,
          quality:
            typeof connection?.rtt === 'number'
              ? QUALITY.ESTIMATED
              : QUALITY.UNAVAILABLE,
          notes:
            typeof connection?.rtt === 'number'
              ? 'Estimated round-trip time.'
              : 'Network Information API unavailable.',
          source: 'navigator.connection',
        }
      ),
    },
    browserDevice: {
      name: field(browser.name, {
        raw: browser.name,
        quality: browser.name === 'Unknown' ? QUALITY.UNAVAILABLE : QUALITY.ALTERNATIVE,
        notes: browser.name === 'Unknown'
          ? 'Browser name could not be parsed.'
          : 'Derived from user agent string.',
        source: 'navigator.userAgent',
      }),
      version: field(browser.version || 'Unavailable in browser', {
        raw: browser.version,
        quality: browser.version ? QUALITY.ALTERNATIVE : QUALITY.UNAVAILABLE,
        notes: browser.version
          ? 'Derived from user agent string.'
          : 'Browser version could not be parsed.',
        source: 'navigator.userAgent',
      }),
      userAgent: field(ua || 'Unavailable in browser', {
        raw: ua,
        quality: ua ? QUALITY.EXACT : QUALITY.UNAVAILABLE,
        source: 'navigator.userAgent',
      }),
      touch: field(navigator.maxTouchPoints > 0, {
        raw: { maxTouchPoints: navigator.maxTouchPoints },
        quality: QUALITY.ALTERNATIVE,
        notes: 'Based on maxTouchPoints and touch event availability.',
        source: 'navigator.maxTouchPoints',
      }),
      screen: field(
        screen.width && screen.height
          ? `${screen.width} x ${screen.height}`
          : 'Unavailable in browser',
        {
          raw: { width: screen.width, height: screen.height },
          quality:
            screen.width && screen.height ? QUALITY.EXACT : QUALITY.UNAVAILABLE,
          source: 'screen',
        }
      ),
      viewport: field(
        window.innerWidth && window.innerHeight
          ? `${window.innerWidth} x ${window.innerHeight}`
          : 'Unavailable in browser',
        {
          raw: { width: window.innerWidth, height: window.innerHeight },
          quality:
            window.innerWidth && window.innerHeight
              ? QUALITY.EXACT
              : QUALITY.UNAVAILABLE,
          source: 'window.innerWidth/innerHeight',
        }
      ),
      dpr: field(window.devicePixelRatio ? `${window.devicePixelRatio}` : 'Unavailable in browser', {
        raw: window.devicePixelRatio,
        quality: window.devicePixelRatio ? QUALITY.EXACT : QUALITY.UNAVAILABLE,
        source: 'window.devicePixelRatio',
      }),
      memory: field(deviceMemory ? `${deviceMemory} GiB` : 'Unavailable in browser', {
        raw: deviceMemory,
        quality: deviceMemory ? QUALITY.ESTIMATED : QUALITY.UNAVAILABLE,
        notes: deviceMemory ? 'Approximate device memory bucket.' : 'Device memory API unavailable.',
        source: 'navigator.deviceMemory',
      }),
    },
    capabilities: {
      webgl: field(hasWebGL, {
        raw: hasWebGL,
        quality: QUALITY.EXACT,
      }),
      webgl2: field(!!window.WebGL2RenderingContext, {
        raw: !!window.WebGL2RenderingContext,
        quality: QUALITY.EXACT,
      }),
      webgpu: field('gpu' in navigator, {
        raw: 'gpu' in navigator,
        quality: QUALITY.EXACT,
      }),
      wasm: field(typeof WebAssembly === 'object', {
        raw: typeof WebAssembly === 'object',
        quality: QUALITY.EXACT,
      }),
      webrtc: field(!!window.RTCPeerConnection, {
        raw: !!window.RTCPeerConnection,
        quality: QUALITY.EXACT,
      }),
      serviceWorker: field('serviceWorker' in navigator, {
        raw: 'serviceWorker' in navigator,
        quality: QUALITY.EXACT,
      }),
      localStorage: field(supportsLocalStorage(), {
        raw: supportsLocalStorage(),
        quality: QUALITY.EXACT,
      }),
      sessionStorage: field(supportsSessionStorage(), {
        raw: supportsSessionStorage(),
        quality: QUALITY.EXACT,
      }),
      indexeddb: field('indexedDB' in window, {
        raw: 'indexedDB' in window,
        quality: QUALITY.EXACT,
      }),
      clipboard: field(!!navigator.clipboard, {
        raw: !!navigator.clipboard,
        quality: QUALITY.EXACT,
      }),
      deviceMemory: field('deviceMemory' in navigator, {
        raw: 'deviceMemory' in navigator,
        quality: QUALITY.EXACT,
      }),
      hardwareConcurrency: field('hardwareConcurrency' in navigator, {
        raw: 'hardwareConcurrency' in navigator,
        quality: QUALITY.EXACT,
      }),
      networkInformation: field('connection' in navigator, {
        raw: 'connection' in navigator,
        quality: QUALITY.EXACT,
      }),
      storageEstimate: field(!!navigator.storage?.estimate, {
        raw: !!navigator.storage?.estimate,
        quality: QUALITY.EXACT,
      }),
      touch: field(navigator.maxTouchPoints > 0, {
        raw: { maxTouchPoints: navigator.maxTouchPoints },
        quality: QUALITY.ALTERNATIVE,
      }),
      pwa: field('serviceWorker' in navigator, {
        raw: {
          serviceWorker: 'serviceWorker' in navigator,
          manifest: !!document.querySelector('link[rel="manifest"]'),
        },
        quality: QUALITY.ALTERNATIVE,
        notes: 'Basic checks for PWA-related support.',
      }),
    },
    storage: {
      estimate: field(!!storageEstimate, {
        raw: storageEstimate,
        quality: storageEstimate ? QUALITY.ESTIMATED : QUALITY.UNAVAILABLE,
        notes: storageEstimate
          ? 'Based on navigator.storage.estimate().'
          : 'Storage Estimate API unavailable.',
        source: 'navigator.storage.estimate',
      }),
      usage: field(
        typeof storageEstimate?.usage === 'number'
          ? `${storageEstimate.usage} bytes`
          : 'Unavailable in browser',
        {
          raw: storageEstimate?.usage ?? null,
          quality:
            typeof storageEstimate?.usage === 'number'
              ? QUALITY.ESTIMATED
              : QUALITY.UNAVAILABLE,
          notes:
            typeof storageEstimate?.usage === 'number'
              ? 'Reported by Storage Estimate API.'
              : 'Storage Estimate API unavailable.',
          source: 'navigator.storage.estimate',
        }
      ),
      quota: field(
        typeof storageEstimate?.quota === 'number'
          ? `${storageEstimate.quota} bytes`
          : 'Unavailable in browser',
        {
          raw: storageEstimate?.quota ?? null,
          quality:
            typeof storageEstimate?.quota === 'number'
              ? QUALITY.ESTIMATED
              : QUALITY.UNAVAILABLE,
          notes:
            typeof storageEstimate?.quota === 'number'
              ? 'Reported by Storage Estimate API.'
              : 'Storage Estimate API unavailable.',
          source: 'navigator.storage.estimate',
        }
      ),
    },
  };
}

function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return null;
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[index]}`;
}

function formatField(field, options = {}) {
  if (!field) return t('status.unavailable');
  if (field.quality === QUALITY.UNAVAILABLE) return t('status.unavailable');

  if (options.type === 'onlineStatus') {
    return field.raw ? t('status.online') : t('status.offline');
  }

  if (options.type === 'availability') {
    return field.value ? t('status.available') : t('status.unavailable');
  }

  if (typeof field.value === 'boolean') {
    return field.value ? t('status.supported') : t('status.notSupported');
  }

  return field.value ?? t('status.unavailable');
}

function formatThreads(field) {
  if (!field || field.quality === QUALITY.UNAVAILABLE) return t('status.unavailable');
  const count = Number(field.raw ?? field.value);
  if (!Number.isFinite(count)) return t('status.unavailable');
  return t('unit.threads', { count });
}

function buildBrowserSummary(data) {
  const name = formatField(data.browserDevice.name);
  const version = data.browserDevice.version?.quality === QUALITY.UNAVAILABLE
    ? null
    : data.browserDevice.version?.value;
  if (!version || version === t('status.unavailable')) return name;
  return `${name} ${version}`;
}

function buildNetworkSummary(data) {
  const type = data.network.type;
  const downlink = data.network.downlink;
  if (type?.quality !== QUALITY.UNAVAILABLE) {
    const pieces = [type.value];
    if (downlink?.quality !== QUALITY.UNAVAILABLE) {
      pieces.push(downlink.value);
    }
    return pieces.join(' • ');
  }
  return formatField(data.network.status, { type: 'onlineStatus' });
}

function buildStorageSummary(data) {
  const usage = data.storage.usage;
  const quota = data.storage.quota;
  if (usage?.quality !== QUALITY.UNAVAILABLE && quota?.quality !== QUALITY.UNAVAILABLE) {
    const usageText = formatBytes(usage.raw) || usage.value;
    const quotaText = formatBytes(quota.raw) || quota.value;
    return `${usageText} / ${quotaText}`;
  }
  return formatField(data.storage.estimate, { type: 'availability' });
}

function getFieldValue(data, key) {
  const mapping = {
    'summary.os': () => formatField(data.system.osName),
    'summary.cpu': () => formatThreads(data.cpu.threads),
    'summary.ram': () => formatField(data.memory.total),
    'summary.gpu': () => formatField(data.graphics.renderer),
    'summary.network': () => buildNetworkSummary(data),
    'summary.storage': () => buildStorageSummary(data),
    'overview.os': () => formatField(data.system.osName),
    'overview.cpu': () => formatField(data.cpu.name),
    'overview.threads': () => formatThreads(data.cpu.threads),
    'overview.ram': () => formatField(data.memory.total),
    'overview.gpu': () => formatField(data.graphics.renderer),
    'overview.network': () => buildNetworkSummary(data),
    'overview.browser': () => buildBrowserSummary(data),
    'overview.storage': () => buildStorageSummary(data),
    'system.osName': () => formatField(data.system.osName),
    'system.osFamily': () => formatField(data.system.osFamily),
    'system.timezone': () => formatField(data.system.timezone),
    'system.languages': () => formatField(data.system.languages),
    'system.platform': () => formatField(data.system.platform),
    'cpu.name': () => formatField(data.cpu.name),
    'cpu.threads': () => formatThreads(data.cpu.threads),
    'cpu.hints': () => formatField(data.cpu.hints),
    'memory.total': () => formatField(data.memory.total),
    'memory.used': () => formatField(data.memory.used),
    'memory.free': () => formatField(data.memory.free),
    'graphics.renderer': () => formatField(data.graphics.renderer),
    'graphics.vendor': () => formatField(data.graphics.vendor),
    'graphics.vramTotal': () => formatField(data.graphics.vramTotal),
    'graphics.vramUsed': () => formatField(data.graphics.vramUsed),
    'graphics.vramFree': () => formatField(data.graphics.vramFree),
    'network.status': () => formatField(data.network.status, { type: 'onlineStatus' }),
    'network.type': () => formatField(data.network.type),
    'network.downlink': () => formatField(data.network.downlink),
    'network.rtt': () => formatField(data.network.rtt),
    'browser.name': () => formatField(data.browserDevice.name),
    'browser.version': () => formatField(data.browserDevice.version),
    'browser.userAgent': () => formatField(data.browserDevice.userAgent),
    'device.touch': () => formatField(data.browserDevice.touch),
    'device.screen': () => formatField(data.browserDevice.screen),
    'device.viewport': () => formatField(data.browserDevice.viewport),
    'device.dpr': () => formatField(data.browserDevice.dpr),
    'device.memory': () => formatField(data.browserDevice.memory),
    'capabilities.webgl': () => formatField(data.capabilities.webgl),
    'capabilities.webgl2': () => formatField(data.capabilities.webgl2),
    'capabilities.webgpu': () => formatField(data.capabilities.webgpu),
    'capabilities.wasm': () => formatField(data.capabilities.wasm),
    'capabilities.webrtc': () => formatField(data.capabilities.webrtc),
    'capabilities.serviceWorker': () => formatField(data.capabilities.serviceWorker),
    'capabilities.localStorage': () => formatField(data.capabilities.localStorage),
    'capabilities.sessionStorage': () => formatField(data.capabilities.sessionStorage),
    'capabilities.indexeddb': () => formatField(data.capabilities.indexeddb),
    'capabilities.clipboard': () => formatField(data.capabilities.clipboard),
    'capabilities.deviceMemory': () => formatField(data.capabilities.deviceMemory),
    'capabilities.hardwareConcurrency': () => formatField(data.capabilities.hardwareConcurrency),
    'capabilities.networkInformation': () => formatField(data.capabilities.networkInformation),
    'capabilities.storageEstimate': () => formatField(data.capabilities.storageEstimate),
    'capabilities.touch': () => formatField(data.capabilities.touch),
    'capabilities.pwa': () => formatField(data.capabilities.pwa),
    'storage.estimate': () => formatField(data.storage.estimate, { type: 'availability' }),
    'storage.usage': () => formatBytes(data.storage.usage?.raw) || formatField(data.storage.usage),
    'storage.quota': () => formatBytes(data.storage.quota?.raw) || formatField(data.storage.quota),
  };

  return mapping[key] ? mapping[key]() : t('status.unavailable');
}

function renderData(data) {
  const elements = document.querySelectorAll('[data-field]');
  elements.forEach((el, index) => {
    const key = el.dataset.field;
    const value = getFieldValue(data, key);
    const delay = Math.min(900, index * 25);
    el.classList.add('value--loading');
    setTimeout(() => {
      el.textContent = value;
      el.classList.remove('value--loading');
      el.classList.add('value--ready');
    }, delay);
  });
  logEvent('info', 'Rendered data to UI', { fieldCount: elements.length });
}

function initExportActions() {
  const actions = document.querySelector('.export-actions');
  if (!actions) return;

  actions.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    const payload = buildExportPayload();
    if (!payload) {
      logEvent('warn', 'Export requested before data collection finished');
      return;
    }

    const json = JSON.stringify(payload, null, 2);
    if (action === 'copy') {
      const success = await copyText(json);
      logEvent(success ? 'info' : 'warn', success ? 'Copied JSON export' : 'Copy JSON failed');
    }
    if (action === 'export') {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `device-specs-viewer-${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(url);
      logEvent('info', 'Downloaded JSON export');
    }
  });
}

function buildExportPayload() {
  if (!state.collected) return null;

  const displayed = {};
  document.querySelectorAll('[data-field]').forEach((el) => {
    const key = el.dataset.field;
    displayed[key] = getFieldValue(state.collected, key);
  });

  const fields = {};
  collectFieldMeta(state.collected, '', fields);

  const capabilityFlags = Object.fromEntries(
    Object.entries(state.collected.capabilities).map(([key, value]) => [key, !!value.value])
  );

  return {
    app: {
      name: APP_NAME,
      version: APP_VERSION,
    },
    timestamp: new Date().toISOString(),
    language: {
      selected: state.lang,
      detected: navigator.languages?.length ? navigator.languages : [navigator.language].filter(Boolean),
    },
    displayed,
    fields,
    capabilityFlags,
    raw: state.collected,
  };
}

function collectFieldMeta(obj, prefix, out) {
  if (!obj || typeof obj !== 'object') return;
  Object.entries(obj).forEach(([key, value]) => {
    if (value && typeof value === 'object' && 'quality' in value && 'value' in value) {
      out[prefix + key] = {
        value: value.value,
        raw: value.raw ?? null,
        quality: value.quality,
        notes: value.notes ?? null,
        source: value.source ?? null,
      };
      return;
    }
    if (value && typeof value === 'object') {
      collectFieldMeta(value, `${prefix}${key}.`, out);
    }
  });
}

function initTooltips() {
  const tooltip = document.getElementById('tooltip');
  if (!tooltip) return;

  const titleEl = tooltip.querySelector('.tooltip-title');
  const bodyEl = tooltip.querySelector('.tooltip-body');
  const closeButton = tooltip.querySelector('.tooltip-close');
  const hoverCapable = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  let activeButton = null;
  let hideTimer = null;

  const showTooltip = (button) => {
    if (!button) return;
    const key = button.dataset.help;
    const content = getHelpContent(key);
    if (!content) return;

    activeButton = button;
    titleEl.textContent = content.title;
    bodyEl.innerHTML = '';
    content.body.split('\n').forEach((line) => {
      const p = document.createElement('p');
      p.textContent = line;
      bodyEl.appendChild(p);
    });
    positionTooltip(button, tooltip);
    tooltip.setAttribute('data-open', 'true');
    tooltip.setAttribute('aria-hidden', 'false');
  };

  const hideTooltip = () => {
    tooltip.setAttribute('data-open', 'false');
    tooltip.setAttribute('aria-hidden', 'true');
    activeButton = null;
  };

  closeButton?.addEventListener('click', hideTooltip);

  document.addEventListener('click', (event) => {
    const button = event.target.closest('.help-button');
    if (button) {
      if (activeButton === button) {
        hideTooltip();
      } else {
        showTooltip(button);
      }
      return;
    }
    if (!tooltip.contains(event.target)) {
      hideTooltip();
    }
  });

  if (hoverCapable) {
    document.querySelectorAll('.help-button').forEach((button) => {
      button.addEventListener('mouseenter', () => {
        clearTimeout(hideTimer);
        showTooltip(button);
      });
      button.addEventListener('mouseleave', () => {
        hideTimer = setTimeout(hideTooltip, 200);
      });
    });

    tooltip.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    tooltip.addEventListener('mouseleave', () => {
      hideTimer = setTimeout(hideTooltip, 200);
    });
  }

  window.addEventListener('resize', () => {
    if (activeButton) {
      positionTooltip(activeButton, tooltip);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideTooltip();
    }
  });
}

function positionTooltip(button, tooltip) {
  const rect = button.getBoundingClientRect();
  const tipRect = tooltip.getBoundingClientRect();
  const margin = 12;

  let top = rect.bottom + margin;
  let left = rect.left + rect.width / 2 - tipRect.width / 2;

  if (left < margin) left = margin;
  if (left + tipRect.width > window.innerWidth - margin) {
    left = window.innerWidth - tipRect.width - margin;
  }

  if (top + tipRect.height > window.innerHeight - margin) {
    top = rect.top - tipRect.height - margin;
  }

  if (top < margin) top = margin;

  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;
}

function getHelpContent(key) {
  if (!key) return null;
  const title = t(`${key}.title`);
  const body = t(`${key}.body`);
  if (!title || !body || title === `${key}.title` || body === `${key}.body`) {
    return null;
  }
  return { title, body };
}

function initDebugPanel() {
  const panel = document.getElementById('debug-panel');
  if (!panel) return;
  if (!DEBUG_ENABLED) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;

  panel.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'copy') {
      const payload = exportLogs();
      const success = await copyText(payload);
      logEvent(success ? 'info' : 'warn', success ? 'Copied logs to clipboard' : 'Clipboard copy failed');
    }
    if (action === 'download') {
      const payload = exportLogs();
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `dsv-debug-${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(url);
      logEvent('info', 'Downloaded logs');
    }
    if (action === 'clear') {
      state.logs = [];
      logEvent('info', 'Cleared logs');
    }
  });
}

function exportLogs() {
  return JSON.stringify(
    {
      app: 'Device Specs Viewer',
      timestamp: new Date().toISOString(),
      language: state.lang,
      logs: state.logs,
    },
    null,
    2
  );
}

window.DSVDebug = {
  enabled: DEBUG_ENABLED,
  getLogs: () => [...state.logs],
  clear: () => {
    state.logs = [];
  },
  export: exportLogs,
  enable: () => safeStorageSet('dsv-debug', '1'),
  disable: () => safeStorageSet('dsv-debug', '0'),
};
