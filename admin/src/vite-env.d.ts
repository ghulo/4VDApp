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
    fiscalSend?(job: { name: string; text: string }): Promise<
      { status: 'printed'; receiptNo: string | null } | { status: 'failed'; message: string | null } | { status: 'not_running' } | { status: 'no_folder' }
    >;
    /** Missing in Windows app versions before 0.4.0. */
    getSetup?(): Promise<DesktopSetup>;
    saveSetup?(change: Partial<Pick<DesktopSetup, 'done' | 'role' | 'openAtLogin'>>): Promise<DesktopSetup>;
    setLanguage?(language: 'en' | 'sq'): void;
  };
}
