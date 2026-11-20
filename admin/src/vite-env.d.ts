interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** What this computer is for, kept by the Windows app (desktop/src/setup.js). */
interface DesktopSetup {
  done: boolean;
  role: 'counter' | 'office';
  openAtLogin: boolean;
  /** False when run with `npm start`: only the installed app can start with Windows. */
  canOpenAtLogin: boolean;
  version: string;
}

/** Only there inside the Windows app (desktop/src/preload.js). */
interface Window {
  fourvdDesktop?: {
    setTheme(preference: 'light' | 'dark' | 'system'): void;
    /** Missing in Windows app versions older than the Counter. */
    fiscalStatus?(): Promise<{ folder: boolean; flink: boolean; path: string }>;
    /** With a sale's key (Windows app 0.4.6 and later), the app notes the job and F-Link's answer on its disk. */
    fiscalSend?(job: { name: string; text: string; key?: string }): Promise<
      { status: 'printed'; receiptNo: string | null } | { status: 'failed'; message: string | null } | { status: 'not_running' } | { status: 'no_folder' }
    >;
    /** What happened to a sale's last receipt, from the app's own job journal; missing before 0.4.6. */
    fiscalLookup?(key: string): Promise<{
      status: 'printing' | 'printed' | 'failed' | 'not_running' | 'no_folder' | 'unknown';
      receiptNo: string | null;
      message: string | null;
    } | null>;
    /** Missing in Windows app versions before 0.4.0. */
    getSetup?(): Promise<DesktopSetup>;
    saveSetup?(change: Partial<Pick<DesktopSetup, 'done' | 'role' | 'openAtLogin'>>): Promise<DesktopSetup>;
    setLanguage?(language: 'en' | 'sq'): void;
  };
}
