import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { dotColumn } from './dots';
import { DotBars, RollingNumber, StatusLine } from './index';

describe('dotColumn', () => {
  it('should stack dots up from the base, one row per step', () => {
    const dots = dotColumn({ x: 10, base: 100, height: 30, width: 4, step: 6 });

    expect(dots.filter((dot) => dot.lit)).toHaveLength(5);
    expect(Math.max(...dots.map((dot) => dot.y))).toBeLessThan(100);
    expect(Math.min(...dots.filter((dot) => dot.lit).map((dot) => dot.y))).toBeGreaterThanOrEqual(70);
  });

  it('should light at least one dot for any value above zero, and none for zero', () => {
    expect(dotColumn({ x: 0, base: 60, height: 0.4, width: 4, step: 6 }).filter((dot) => dot.lit)).toHaveLength(1);
    expect(dotColumn({ x: 0, base: 60, height: 0, width: 4, step: 6 }).filter((dot) => dot.lit)).toHaveLength(0);
  });

  it('should fill the rest of the column with unlit dots up to the top', () => {
    const dots = dotColumn({ x: 0, base: 60, height: 12, width: 4, step: 6, top: 0 });

    expect(dots).toHaveLength(10);
    expect(dots.filter((dot) => !dot.lit)).toHaveLength(8);
  });

  it('should add columns side by side when the bar is wide enough', () => {
    const dots = dotColumn({ x: 0, base: 12, height: 12, width: 18, step: 6, top: 0 });

    expect(new Set(dots.map((dot) => dot.x)).size).toBe(3);
  });
});

describe('RollingNumber', () => {
  it('should be read out as the plain value, with one rolling strip per digit', () => {
    const html = renderToStaticMarkup(<RollingNumber value="€1,204.50" />);

    expect(html).toContain('<span class="visually-hidden">€1,204.50</span>');
    expect(html).not.toContain('role="text"');
    expect(html.match(/class="roll__strip"/g)).toHaveLength(6);
    expect(html).toContain('€');
  });
});

describe('DotBars and StatusLine', () => {
  it('should draw one dot column per value, hidden from screen readers', () => {
    const html = renderToStaticMarkup(<DotBars values={[0, 5, 10]} />);

    expect(html).toContain('aria-hidden="true"');
    expect(html.match(/class="dot-bars__lit"/g)!.length).toBeGreaterThan(0);
  });

  it('should show the status pill between two dotted lines', () => {
    const html = renderToStaticMarkup(<StatusLine>3 sales today</StatusLine>);

    expect(html).toContain('status-line__pill');
    expect(html).toContain('3 sales today');
  });
});
