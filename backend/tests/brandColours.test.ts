import { describe, expect, it } from 'vitest';
import { BRAND_PRESETS, brandColours, defaultBrandColour } from '../src/utils/brandColours.js';

// admin/src/theme/brandTheme.test.ts checks the same colours, so emails match the dashboard.
const FIXTURES = [
  { hex: '#0f766e', key: { face: '#0f766e', top: '#2f8179', low: '#026a62', edge: '#004b45', ink: '#ffffff' }, words: { light: '#146a63', dark: '#7ecbc2' }, notes: [] },
  { hex: '#14284b', key: { face: '#14284b', top: '#203354', low: '#0b1e40', edge: '#000623', ink: '#ffffff' }, words: { light: '#485d80', dark: '#a4bce4' }, notes: ['darkWords'] },
  { hex: '#7cc4f0', key: { face: '#7cc4f0', top: '#8fd0f9', low: '#6fb7e3', edge: '#5098c2', ink: '#0f1010' }, words: { light: '#226386', dark: '#84c3eb' }, notes: [] },
  { hex: '#ffee00', key: { face: '#ffee00', top: '#fffab6', low: '#f1e105', edge: '#cdc003', ink: '#0f1010' }, words: { light: '#665e00', dark: '#ccbf03' }, notes: ['paleWords'] },
];

describe('brandColours', () => {
  it.each(FIXTURES)('works out $hex the same as the dashboard', ({ hex, key, words, notes }) => {
    const colours = brandColours(hex, 'plain');
    expect(colours.key).toEqual(key);
    expect(colours.words).toEqual(words);
    expect(colours.notes).toEqual(notes);
  });

  it('gives a business without a colour the same preset every time, never amber', () => {
    expect(defaultBrandColour('kafe-dardania')).toBe(defaultBrandColour('kafe-dardania'));
    expect(BRAND_PRESETS).toContain(defaultBrandColour('kafe-dardania'));
    expect(BRAND_PRESETS).not.toContain('#f5b71a');
  });
});
