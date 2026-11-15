/**
 * Whether an email really comes from the address in its From line. Anyone can
 * write any From, so a sender counts only when Cloudflare's own checks say
 * DMARC, DKIM or SPF passed for the From's domain.
 *
 * Authentication-Results headers can be written by the sender too, so only the
 * topmost one stamped by Cloudflare (its authserv-id names cloudflare) counts;
 * anything below it came from outside and is ignored.
 */

const RESULT_HEADERS = new Set(['authentication-results', 'arc-authentication-results']);

/** a.example.com and example.com belong together; example.com and badexample.com don't. */
export function aligned(a, b) {
  const x = a.toLowerCase().replace(/\.$/, '');
  const y = b.toLowerCase().replace(/\.$/, '');
  // Both must be real domains (a bare "com" would match everything).
  return x.includes('.') && y.includes('.') && (x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`));
}

const domainOf = (address) => (address ?? '').split('@').pop().toLowerCase().replace(/[<>"\s]/g, '');

/** The server that wrote the results: the first item, after ARC's "i=N;". */
const authservId = (value) => value.replace(/^\s*i=\d+\s*;/i, '').split(';')[0].trim().toLowerCase();

/** The topmost results Cloudflare stamped, or null. `headers` is in mail order, top first. */
export function cloudflareResults(headers) {
  const found = headers.find((h) => RESULT_HEADERS.has(h.key.toLowerCase()) && authservId(h.value).includes('cloudflare'));
  return found ? found.value.toLowerCase() : null;
}

/**
 * @param {Array<{ key: string, value: string }>} headers every header, top first
 * @param {string} from the From address
 * @param {string} envelopeFrom the SMTP MAIL FROM (message.from)
 * @returns {{ ok: boolean, why: string }}
 */
export function checkSender(headers, from, envelopeFrom) {
  const fromDomain = domainOf(from);
  if (!fromDomain) return { ok: false, why: 'no From domain' };
  const results = cloudflareResults(headers);
  if (results === null) return { ok: false, why: 'no Cloudflare authentication results' };

  for (const match of results.matchAll(/dmarc=pass[^;]*?header\.from=([^\s;]+)/g)) {
    if (aligned(match[1], fromDomain)) return { ok: true, why: 'dmarc' };
  }
  for (const match of results.matchAll(/dkim=pass[^;]*?header\.(?:d|i)=@?([^\s;]+)/g)) {
    if (aligned(domainOf(match[1]), fromDomain)) return { ok: true, why: 'dkim' };
  }
  for (const match of results.matchAll(/spf=pass(?:[^;]*?smtp\.mailfrom=([^\s;]+))?/g)) {
    if (aligned(domainOf(match[1] ?? envelopeFrom), fromDomain)) return { ok: true, why: 'spf' };
  }
  return { ok: false, why: 'no passing check for the From domain' };
}
