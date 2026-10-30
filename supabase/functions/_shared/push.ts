/**
 * Firebase Cloud Messaging HTTP v1 sender (MOB-08). The service-account key is
 * a server secret (FCM_PRIVATE_KEY); OAuth tokens are minted here with
 * WebCrypto and cached for their lifetime. Nothing here reaches a client.
 */
import { encodeBase64Url } from './encoding.ts';

export interface FcmConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

let cached: { token: string; expiresAt: number } | null = null;

function pemToPkcs8(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, '');
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

async function accessToken(cfg: FcmConfig, fetchImpl: typeof fetch): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) => encodeBase64Url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${
    enc({
      iss: cfg.clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  }`;
  const key = await crypto.subtle.importKey('pkcs8', pemToPkcs8(cfg.privateKey), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = encodeBase64Url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))));
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!res.ok || !data.access_token) throw new Error('FCM OAuth token request failed');
  cached = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cached.token;
}

export type SendResult = 'sent' | 'invalid_token' | 'failed';

export async function sendPush(cfg: FcmConfig, msg: PushMessage, fetchImpl: typeof fetch = fetch): Promise<SendResult> {
  const token = await accessToken(cfg, fetchImpl);
  const res = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${cfg.projectId}/messages:send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      message: {
        token: msg.token,
        notification: { title: msg.title.slice(0, 120), body: msg.body.slice(0, 500) },
        data: msg.data,
        android: { priority: 'high' },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.ok) return 'sent';
  // 404 UNREGISTERED / 400 INVALID_ARGUMENT on the token: drop it.
  if (res.status === 404 || res.status === 400) return 'invalid_token';
  return 'failed';
}
