interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
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
  };
}
