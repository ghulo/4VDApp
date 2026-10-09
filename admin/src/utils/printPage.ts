/**
 * Print an HTML page (an invoice, say) through the browser's own print dialog,
 * which lists every connected printer and offers "Save as PDF". The page goes
 * into a hidden frame so the dashboard itself isn't printed.
 */
export function printHtml(html: string, title: string): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.title = title;
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
    frame.srcdoc = html;
    frame.addEventListener('load', async () => {
      const win = frame.contentWindow!;
      // Wait for the web fonts, so the paper matches the screen.
      await win.document.fonts?.ready.catch(() => undefined);
      win.addEventListener('afterprint', () => setTimeout(() => frame.remove(), 0), { once: true });
      win.focus();
      win.print();
      resolve();
    });
    document.body.append(frame);
  });
}
