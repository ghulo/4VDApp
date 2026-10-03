import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { sq } from '../i18n/sq';
import { describeReason } from './approvalReasons';

describe('describeReason', () => {
  it('should read the server’s refund reason in Albanian', () =>
    expect(describeReason(sq, 'refund over €50')).toBe('rimbursim mbi €50'));

  it('should read the server’s late-return reason in Albanian', () =>
    expect(describeReason(sq, 'sold more than 30 days ago')).toBe('shitur më shumë se 30 ditë më parë'));

  it('should read the server’s damaged reason in Albanian', () =>
    expect(describeReason(sq, 'damaged item')).toBe('artikull i dëmtuar'));

  it('should leave English as the server wrote it', () => expect(describeReason(en, 'refund over €50')).toBe('refund over €50'));

  it('should show a reason it doesn’t recognise unchanged', () =>
    expect(describeReason(sq, 'something new')).toBe('something new'));
});
