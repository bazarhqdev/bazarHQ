/**
 * Capacitor-ready native wrappers. Every function degrades gracefully in a
 * normal browser so the SPA also runs in `vite dev`.
 *
 * Permission policy (MOB-18): nothing except INTERNET is requested at launch.
 * Notification permission is requested only when the merchant taps
 * "Turn on push notifications" (MOB-10). Image picking uses the WebView file
 * chooser, which asks for camera access only at that moment.
 */
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { PushNotifications } from '@capacitor/push-notifications';
import { SplashScreen } from '@capacitor/splash-screen';

export const isNative = () => Capacitor.isNativePlatform();
export const platform = () => Capacitor.getPlatform();

/** MOB-17: back navigates within the stack and exits only at a root screen. */
export function onHardwareBack(handler: () => boolean): () => void {
  if (!isNative()) return () => undefined;
  let handle: PluginListenerHandle | undefined;
  void App.addListener('backButton', () => {
    const handled = handler();
    if (!handled) void App.exitApp();
  }).then((h) => (handle = h));
  return () => void handle?.remove();
}

/** MOB-06: refresh the session when the app returns to the foreground. */
export function onAppResume(handler: () => void): () => void {
  if (!isNative()) {
    const onVisible = () => document.visibilityState === 'visible' && handler();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }
  let handle: PluginListenerHandle | undefined;
  void App.addListener('resume', handler).then((h) => (handle = h));
  return () => void handle?.remove();
}

export async function hideNativeSplash() {
  if (isNative()) await SplashScreen.hide().catch(() => undefined);
}

/**
 * Non-sensitive preferences ONLY (e.g. UI choices). @capacitor/preferences is
 * not encrypted storage and must never hold access/refresh tokens (AUTH-05, MOB-05).
 */
export const prefs = {
  async get(key: string): Promise<string | null> {
    try {
      return (await Preferences.get({ key })).value;
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    await Preferences.set({ key, value }).catch(() => undefined);
  },
  async clear(): Promise<void> {
    await Preferences.clear().catch(() => undefined);
  },
};

/**
 * Session token vault (AUTH-05 / MOB-05). On Android this is backed by
 * capacitor-secure-storage-plugin, which encrypts values with a key held in
 * the Android Keystore. It is passed to the Supabase client as its auth
 * `storage`, so access/refresh tokens never touch localStorage or
 * @capacitor/preferences. In a plain browser (vite dev) tokens stay in memory
 * only — the plugin's web fallback (base64 in localStorage) is deliberately
 * not used.
 */
export interface SecureTokenStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const memoryVault = new Map<string, string>();

export const secureTokenStore: SecureTokenStore = {
  async getItem(key) {
    if (!isNative()) return memoryVault.get(key) ?? null;
    try {
      return (await SecureStoragePlugin.get({ key })).value;
    } catch {
      return null; // missing key
    }
  },
  async setItem(key, value) {
    if (!isNative()) return void memoryVault.set(key, value);
    await SecureStoragePlugin.set({ key, value });
  },
  async removeItem(key) {
    if (!isNative()) return void memoryVault.delete(key);
    await SecureStoragePlugin.remove({ key }).catch(() => undefined);
  },
};

/* ------------------------------ Camera ------------------------------ */

function dataUrlToFile(dataUrl: string, name: string): File {
  const [head, body] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(head ?? '')?.[1] ?? 'image/jpeg';
  const bin = atob(body ?? '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: mime });
}

/**
 * Camera or photo library (MOB-18: permission is requested by the OS at this
 * moment, not at launch). Returns null when the user cancels or denies.
 */
export async function pickImage(): Promise<File | null> {
  if (!isNative()) return null;
  try {
    const photo = await Camera.getPhoto({
      source: CameraSource.Prompt,
      resultType: CameraResultType.DataUrl,
      quality: 82,
      width: 1600,
      correctOrientation: true,
      promptLabelHeader: 'Add a photo',
      promptLabelPhoto: 'Choose from gallery',
      promptLabelPicture: 'Take a photo',
    });
    if (!photo.dataUrl) return null;
    return dataUrlToFile(photo.dataUrl, `photo-${Date.now()}.${photo.format === 'png' ? 'png' : 'jpg'}`);
  } catch {
    return null;
  }
}

/* ---------------------------- Filesystem ---------------------------- */

/** Writes an export (CSV) to the app cache and opens the Android share sheet. */
export async function saveTextFile(filename: string, text: string, mime: string): Promise<void> {
  if (!isNative()) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const res = await Filesystem.writeFile({ path: filename, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
  await Share.share({ title: filename, files: [res.uri], dialogTitle: 'Save or share export' }).catch(() => undefined);
}

/* ---------------------------- Deep links ---------------------------- */

const ROOT_DOMAIN = (import.meta.env.VITE_ROOT_DOMAIN ?? 'bazarhq.com').toLowerCase();
const ROOT_HOSTS = new Set([ROOT_DOMAIN, `www.${ROOT_DOMAIN}`, 'bazarhq.vercel.app', 'www.bazarhq.vercel.app']);

/**
 * Maps an incoming link to an in-app route:
 *  https://bazarhq.vercel.app/store/greenbasket/products/<id> → /c/s/greenbasket/p/<id>
 *  https://bazarhq.vercel.app/track?order=…                  → /c/track?order=…
 *  bazarhq://order/<ORDER_ID>                   → /c/track?order=<ORDER_ID>
 *  bazarhq://payment/return?order=…            → /c/track?order=…
 *  bazarhq://merchant/orders/<id>               → /orders/<id>
 * Unknown links return null and are ignored (no open redirects).
 */
export function mapDeepLink(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const qs = url.search;
  if (url.protocol === 'bazarhq:') {
    const parts = [url.host, ...url.pathname.split('/')].filter(Boolean);
    if (parts[0] === 'order' && parts[1] && /^ORD-\d{8}-BHQ\d{6}$/.test(parts[1])) return `/c/track?order=${parts[1]}`;
    if (parts[0] === 'store' && parts[1] && /^[a-z0-9-]{3,63}$/.test(parts[1])) return `/c/s/${parts[1]}`;
    if (parts[0] === 'merchant' && parts[1] === 'orders' && parts[2]) return `/orders/${encodeURIComponent(parts[2])}`;
    // Gateway return (SSLCommerz success/fail URL): show live tracking; payment state comes from the server webhook.
    if (parts[0] === 'payment' && parts[1] === 'return') return `/c/track${qs}`;
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  if (ROOT_HOSTS.has(host)) {
    if (url.pathname === '/track') return `/c/track${qs}`;
    const store = /^\/store\/([a-z0-9-]{3,63})(\/.*)?$/.exec(url.pathname);
    if (store) return storePath(store[1]!, store[2] ?? '/');
    if (url.pathname === '/' || url.pathname === '') return '/c';
    return null;
  }
  if (host.endsWith(`.${ROOT_DOMAIN}`)) {
    const sub = host.slice(0, -(ROOT_DOMAIN.length + 1));
    if (!/^[a-z0-9-]{3,63}$/.test(sub) || ['www', 'admin', 'merchant', 'api', 'app'].includes(sub)) return null;
    return storePath(sub, url.pathname);
  }
  return null;
}

function storePath(sub: string, path: string): string {
  const product = /^\/products\/([a-z0-9-]+)$/i.exec(path);
  if (product) return `/c/s/${sub}/p/${product[1]}`;
  if (path === '/products') return `/c/s/${sub}/products`;
  if (path === '/cart') return `/c/s/${sub}/cart`;
  return `/c/s/${sub}`;
}

/** MOB-07: handle links that open or resume the app. */
export function onDeepLink(handler: (route: string) => void): () => void {
  if (!isNative()) return () => undefined;
  let handle: PluginListenerHandle | undefined;
  void App.getLaunchUrl().then((l) => {
    const r = l?.url ? mapDeepLink(l.url) : null;
    if (r) handler(r);
  });
  void App.addListener('appUrlOpen', ({ url }) => {
    const r = mapDeepLink(url);
    if (r) handler(r);
  }).then((h) => (handle = h));
  return () => void handle?.remove();
}

export const pushSupported = () => isNative() && import.meta.env.VITE_PUSH_ENABLED === 'true';

/**
 * MOB-08/10: ask for notification permission at the point of use, then
 * register with FCM. The token must be sent to the device-token Edge Function
 * (device_tokens) — never stored in the client.
 */
let lastPushToken: string | null = null;
export const currentPushToken = () => lastPushToken;

export async function enablePush(onToken: (token: string) => void): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!pushSupported()) return 'unsupported';
  let status = await PushNotifications.checkPermissions();
  if (status.receive === 'prompt' || status.receive === 'prompt-with-rationale') {
    status = await PushNotifications.requestPermissions();
  }
  if (status.receive !== 'granted') return 'denied';
  await PushNotifications.addListener('registration', (t) => {
    lastPushToken = t.value;
    onToken(t.value);
  });
  await PushNotifications.register();
  return 'granted';
}

/** AUTH-13: on logout, deregister push and clear non-sensitive prefs. */
export async function nativeSignOutCleanup(unregisterDevice?: (token: string) => Promise<void>) {
  if (lastPushToken && unregisterDevice) await unregisterDevice(lastPushToken).catch(() => undefined);
  if (pushSupported()) await PushNotifications.unregister().catch(() => undefined);
  lastPushToken = null;
  await prefs.clear();
  // Supabase's own signOut removes its session key; clearing the vault also covers interrupted sign-outs.
  if (isNative()) await SecureStoragePlugin.clear().catch(() => undefined);
  else memoryVault.clear();
}

/** External pages (payment gateway, policy PDFs) open in a Custom Tab, never inside the app WebView. */
export async function openExternal(url: string): Promise<void> {
  if (!/^https:\/\//.test(url)) return;
  if (isNative()) await Browser.open({ url, presentationStyle: 'popover' });
  else window.open(url, '_blank', 'noopener');
}
