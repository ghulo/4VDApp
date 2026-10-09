/**
 * Makes the keys browsers and phones need to receive alerts, and prints the
 * three lines to paste into Render (4vd-api -> Environment). Nothing is stored.
 *
 *   npm run vapid -- you@example.com
 */
import webpush from 'web-push';

const contact = process.argv[2];
if (!contact || !contact.includes('@')) {
  console.error('Give an email address people can reach you on, e.g.: npm run vapid -- you@example.com');
  process.exit(1);
}
const keys = webpush.generateVAPIDKeys();
console.log('\nAdd these three variables to 4vd-api on Render (Environment -> Add Environment Variable):\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`VAPID_SUBJECT=mailto:${contact}\n`);
console.log('Keep the private key secret. Do not create new keys later: everyone would have to turn alerts on again.\n');
