import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// scrypt is built into Node, so there is no native module to compile on free hosts.
// The cost settings are stored with each hash, so they can be raised later without breaking old hashes.
const KEY_LENGTH = 64;
const COST = process.env.NODE_ENV === 'test' ? 2 ** 10 : 2 ** 15;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const MAX_MEMORY = 128 * 1024 * 1024;

function deriveKey(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, { N: COST, r: BLOCK_SIZE, p: PARALLELISM, maxmem: MAX_MEMORY });
  return ['scrypt', COST, BLOCK_SIZE, PARALLELISM, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, n, r, p, salt, hash] = stored.split('$');
  if (algorithm !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await deriveKey(password, Buffer.from(salt, 'base64'), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAX_MEMORY,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Checked when an email has no account, so a failed sign-in takes about as long either way
 * and response timing doesn't reveal which emails are registered.
 */
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}
