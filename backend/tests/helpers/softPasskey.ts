import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';

const b64url = (bytes: Uint8Array | Buffer) => Buffer.from(bytes).toString('base64url');
const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest();

/** Flags in authenticator data. */
const UP = 0x01;
const UV = 0x04;
const BE = 0x08;
const BS = 0x10;
const AT = 0x40;

/**
 * A pretend device that makes and uses a passkey (ES256, "none" attestation),
 * so the tests can sign in the way a phone or Windows Hello would.
 */
export class SoftPasskey {
  readonly credentialId = randomBytes(32);
  private readonly privateKey: KeyObject;
  private readonly publicJwk: { x: string; y: string };
  counter: number;
  userHandle: string | null = null;

  constructor(
    private readonly rpId: string,
    private readonly origin: string,
    options: { counter?: number; synced?: boolean; userVerified?: boolean } = {},
  ) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: 'jwk' });
    this.publicJwk = { x: jwk.x!, y: jwk.y! };
    this.counter = options.counter ?? 0;
    this.synced = options.synced ?? false;
    this.userVerified = options.userVerified ?? true;
  }

  synced: boolean;
  userVerified: boolean;

  get id(): string {
    return b64url(this.credentialId);
  }

  private flags(extra: number): number {
    return UP | (this.userVerified ? UV : 0) | (this.synced ? BE | BS : 0) | extra;
  }

  private counterBytes(): Buffer {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32BE(this.counter);
    return bytes;
  }

  /** The answer to registration options (navigator.credentials.create). */
  create(options: { challenge: string; user: { id: string } }) {
    this.userHandle = options.user.id;
    const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin: this.origin, crossOrigin: false }));
    const cose = new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(this.publicJwk.x, 'base64url')],
      [-3, Buffer.from(this.publicJwk.y, 'base64url')],
    ]);
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([
      sha256(this.rpId),
      Buffer.from([this.flags(AT)]),
      this.counterBytes(),
      Buffer.alloc(16), // AAGUID: unknown provider
      idLength,
      this.credentialId,
      Buffer.from(isoCBOR.encode(cose)),
    ]);
    const attestationObject = isoCBOR.encode(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]) as never);
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      clientExtensionResults: {},
      authenticatorAttachment: 'platform' as const,
      response: { clientDataJSON: b64url(clientData), attestationObject: b64url(attestationObject), transports: ['internal', 'hybrid'] },
    };
  }

  /** The answer to sign-in options (navigator.credentials.get). Uses up one count, like a hardware key. */
  get(options: { challenge: string }, overrides: { origin?: string; bumpCounter?: boolean } = {}) {
    if (overrides.bumpCounter !== false && this.counter > 0) this.counter += 1;
    const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin: overrides.origin ?? this.origin, crossOrigin: false }));
    const authData = Buffer.concat([sha256(this.rpId), Buffer.from([this.flags(0)]), this.counterBytes()]);
    const signature = sign('sha256', Buffer.concat([authData, sha256(clientData)]), this.privateKey);
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      clientExtensionResults: {},
      authenticatorAttachment: 'platform' as const,
      response: {
        clientDataJSON: b64url(clientData),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
        ...(this.userHandle && { userHandle: this.userHandle }),
      },
    };
  }
}
