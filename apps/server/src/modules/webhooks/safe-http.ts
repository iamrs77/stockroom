import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from 'node:dns';
import { lookup as dnsLookupAsync } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';

/**
 * Webhook URLs are chosen by users, so requests to them must not reach private networks: the
 * cloud metadata service, localhost, or other internal services (server-side request forgery).
 * URLs are checked when an endpoint is saved and again at connection time, so a hostname that
 * resolved to a public address at registration can't later be switched to a private one (DNS rebinding).
 */
const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, including cloud metadata at 169.254.169.254
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved and broadcast
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
  ['64:ff9b::', 96], // NAT64, which can reach IPv4 private ranges
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6');
}

export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address); // IPv4-mapped IPv6
  if (mapped) return blocked.check(mapped[1]!, 'ipv4');
  const family = isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family === 6) return blocked.check(address, 'ipv6');
  return true; // not an IP address at all: refuse
}

export class UnsafeUrlError extends Error {}

/** Checks a webhook URL before it's saved. */
export async function assertDeliverableUrl(raw: string, { allowPrivate }: { allowPrivate: boolean }) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('Enter a full URL, starting with https://');
  }
  if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:')) {
    throw new UnsafeUrlError('Webhook URLs must use https://');
  }
  if (url.username || url.password) throw new UnsafeUrlError('Remove the username and password from the URL');
  if (allowPrivate) return;

  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: LookupAddress[];
  try {
    addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await dnsLookupAsync(host, { all: true });
  } catch {
    throw new UnsafeUrlError(`Couldn't find ${url.hostname}. Check the address.`);
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new UnsafeUrlError('This URL points to a private network address, which webhooks can’t reach');
  }
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** A DNS lookup for http.request that refuses private addresses at the moment of connecting. */
function guardedLookup(allowPrivate: boolean) {
  return (hostname: string, options: LookupOptions, callback: LookupCallback) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, []);
      const list = addresses as LookupAddress[];
      const safe = allowPrivate ? list : list.filter((a) => !isPrivateAddress(a.address));
      if (safe.length === 0) {
        return callback(Object.assign(new Error(`Refused to connect to a private address for ${hostname}`), { code: 'EPRIVATE' }), []);
      }
      if (options.all) return callback(null, safe);
      callback(null, safe[0]!.address, safe[0]!.family);
    });
  };
}

export type PostResult = { status?: number; error?: string; durationMs: number };

/**
 * POSTs a JSON body. Never throws; returns the status code or the error. Redirects aren't followed
 * (a redirect could point somewhere private), and only a little of the response body is read.
 */
export function postJson(
  rawUrl: string,
  body: string,
  headers: Record<string, string>,
  { timeoutMs, allowPrivate }: { timeoutMs: number; allowPrivate: boolean },
): Promise<PostResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      resolve({ error: 'Invalid URL', durationMs: 0 });
      return;
    }
    const client = url.protocol === 'https:' ? https : url.protocol === 'http:' && allowPrivate ? http : undefined;
    if (!client) {
      resolve({ error: 'Webhook URLs must use https://', durationMs: 0 });
      return;
    }
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (!allowPrivate && isIP(host) && isPrivateAddress(host)) {
      resolve({ error: 'Refused to connect to a private address', durationMs: 0 });
      return;
    }

    const req = client.request(
      url,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        lookup: guardedLookup(allowPrivate) as unknown as typeof dnsLookup,
        timeout: timeoutMs,
      },
      (res) => {
        let read = 0;
        res.on('data', (chunk: Buffer) => {
          read += chunk.length;
          if (read > 64 * 1024) res.destroy(); // the body doesn't matter; don't download a huge one
        });
        res.on('close', () => resolve({ status: res.statusCode, durationMs: Date.now() - started }));
        res.on('error', () => resolve({ status: res.statusCode, durationMs: Date.now() - started }));
      },
    );
    req.on('timeout', () => req.destroy(new Error(`No response within ${timeoutMs / 1000} s`)));
    req.on('error', (err) => resolve({ error: err.message, durationMs: Date.now() - started }));
    req.end(body);
  });
}
