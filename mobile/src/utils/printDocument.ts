import { Platform } from 'react-native';

/** Printing goes through the browser; the team app runs as a web app. */
export const canPrint = Platform.OS === 'web';

/**
 * Show an invoice in a new tab and open the print sheet: any printer, Save as
 * PDF, or share. The tab is opened straight from the tap (so the browser
 * doesn't block it) and filled once the page arrives; a hidden frame doesn't
 * print reliably on phones.
 */
export async function printDocument(load: () => Promise<string>, title: string): Promise<void> {
  const tab = window.open('', '_blank');
  if (!tab) throw new Error('blocked');
  tab.document.title = title;
  try {
    const html = await load();
    tab.document.open();
    tab.document.write(html);
    tab.document.close();
    const print = async () => {
      await tab.document.fonts?.ready.catch(() => undefined);
      tab.focus();
      tab.print();
    };
    if (tab.document.readyState === 'complete') void print();
    else tab.addEventListener('load', () => void print(), { once: true });
  } catch (error) {
    tab.close();
    throw error;
  }
}
