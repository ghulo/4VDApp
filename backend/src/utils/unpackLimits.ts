import JSZip from 'jszip';
import { ValidationError } from '../errors/httpErrors.js';

/**
 * Limits on what an uploaded .zip or Excel file may unpack into. An upload is
 * at most a few tens of MB, but a zip (and an .xlsx is a zip) can hold a file
 * that unpacks to gigabytes, or a million tiny files, or a sheet with a
 * million rows. Every file 4VD reads from an upload goes through one
 * UnpackBudget per request, so a drop of many files shares one allowance.
 */
export interface UnpackLimits {
  /** Bytes unpacked in all, the workbooks' own XML included. */
  bytes: number;
  /** Files inside one zip or workbook. */
  entries: number;
  /** Rows in all sheets and CSV files together. */
  rows: number;
  /** Cells in all rows together (a row can reach column XFD with one cell). */
  cells: number;
}

export const UNPACK_LIMITS: UnpackLimits = {
  bytes: 200 * 1024 * 1024,
  entries: 5_000,
  rows: 200_000,
  cells: 5_000_000,
};

export type UnpackLimit = keyof UnpackLimits;

const MESSAGES: Record<UnpackLimit, (limits: UnpackLimits) => string> = {
  bytes: (l) => `The file unpacks to more than ${Math.round(l.bytes / 1024 / 1024)} MB. Send a smaller file, or only the part you need.`,
  entries: (l) => `The zip holds more than ${l.entries.toLocaleString('en')} files. Send only the files you need.`,
  rows: (l) => `The file has more than ${l.rows.toLocaleString('en')} rows. Send a smaller file, or only the part you need.`,
  cells: (l) => `The file has more than ${l.cells.toLocaleString('en')} filled cells. Send a smaller file, or only the part you need.`,
};

/** A file that would unpack past a limit: a 400 in plain words, never a 500 or a full server. */
export class TooBigToUnpackError extends ValidationError {
  constructor(
    readonly limit: UnpackLimit,
    limits: UnpackLimits,
  ) {
    super(MESSAGES[limit](limits));
  }
}

/** Wraps a reader's catch-all: limit errors go through, anything else becomes the reader's own error. */
export function rethrowIfTooBig(error: unknown): void {
  if (error instanceof TooBigToUnpackError) throw error;
}

const EOCD = 0x06054b50;
/** A worksheet row or cell tag, with or without a namespace prefix ("<row " / "<x:c>"). */
const ROW_TAG = /<(?:[A-Za-z_][\w.-]*:)?row[\s>/]/g;
const CELL_TAG = /<(?:[A-Za-z_][\w.-]*:)?c[\s>/]/g;
const TAG_START = /^<(?:[A-Za-z_][\w.-]*:)?(?:row|c)[\s>/]/;

/** One request's allowance; pass custom limits only in tests. */
export class UnpackBudget {
  private bytesUsed = 0;
  private rowsUsed = 0;
  private cellsUsed = 0;

  constructor(readonly limits: UnpackLimits = UNPACK_LIMITS) {}

  private fail(limit: UnpackLimit): never {
    throw new TooBigToUnpackError(limit, this.limits);
  }

  addBytes(n: number): void {
    this.bytesUsed += n;
    if (this.bytesUsed > this.limits.bytes) this.fail('bytes');
  }

  addRows(n: number): void {
    this.rowsUsed += n;
    if (this.rowsUsed > this.limits.rows) this.fail('rows');
  }

  addCells(n: number): void {
    this.cellsUsed += n;
    if (this.cellsUsed > this.limits.cells) this.fail('cells');
  }

  /** Where the row and cell counts stand, to give back a refused file's share with restore(). */
  mark(): { rows: number; cells: number } {
    return { rows: this.rowsUsed, cells: this.cellsUsed };
  }

  /** Gives back what a refused file counted (its rows are dropped); unpacked bytes stay spent. */
  restore(mark: { rows: number; cells: number }): void {
    this.rowsUsed = mark.rows;
    this.cellsUsed = mark.cells;
  }

  /**
   * Opens a zip's table of contents without unpacking anything: the number of
   * files is checked from the zip's end record before JSZip builds its list,
   * and again after (that record can lie). Files are then unpacked one at a
   * time with read(), each counted as it streams.
   */
  async openZip(bytes: Buffer): Promise<JSZip> {
    const declared = declaredEntries(bytes);
    if (declared !== null && declared > this.limits.entries) this.fail('entries');
    const zip = await JSZip.loadAsync(bytes);
    const entries = Object.values(zip.files).filter((entry) => !entry.dir);
    if (entries.length > this.limits.entries) this.fail('entries');
    return zip;
  }

  /** The size a zip entry says it unpacks to; checked before unpacking, but never trusted alone. */
  checkDeclared(entry: JSZip.JSZipObject): void {
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
    if (this.bytesUsed + size > this.limits.bytes) this.fail('bytes');
  }

  /**
   * Unpacks one entry chunk by chunk, counting the real bytes as they come
   * (the sizes in a zip's headers can lie) and stopping at the limit. With
   * keep false the bytes are only counted and dropped; onChunk sees each one.
   */
  async read(entry: JSZip.JSZipObject, keep: true, onChunk?: (chunk: Uint8Array) => void): Promise<Buffer>;
  async read(entry: JSZip.JSZipObject, keep: false, onChunk?: (chunk: Uint8Array) => void): Promise<null>;
  async read(entry: JSZip.JSZipObject, keep: boolean, onChunk?: (chunk: Uint8Array) => void): Promise<Buffer | null> {
    this.checkDeclared(entry);
    const stream = (entry as unknown as { internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array> }).internalStream('uint8array');
    return new Promise<Buffer | null>((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      let settled = false;
      const stop = (error: unknown) => {
        if (settled) return;
        settled = true;
        chunks.length = 0;
        stream.pause();
        reject(error);
      };
      stream
        .on('data', (chunk) => {
          // Chunks already being inflated may still arrive after a stop: drop them.
          if (settled) return;
          try {
            this.addBytes(chunk.length);
            onChunk?.(chunk);
          } catch (error) {
            stop(error);
            return;
          }
          if (keep) chunks.push(chunk);
        })
        .on('error', stop)
        .on('end', () => {
          if (settled) return;
          settled = true;
          resolve(keep ? Buffer.concat(chunks) : null);
        })
        .resume();
    });
  }

  /**
   * Walks a whole .xlsx before ExcelJS opens it (ExcelJS unpacks every part
   * in one go): every part is unpacked and counted against the byte limit,
   * then dropped, and the row and cell tags in every part are counted (every
   * part, not only xl/worksheets/sheetN.xml, so no naming trick slips a sheet
   * past). Throws TooBigToUnpackError; a broken zip throws JSZip's own error.
   */
  async checkWorkbook(bytes: Buffer): Promise<void> {
    const zip = await this.openZip(bytes);
    let rows = 0;
    let cells = 0;
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue;
      if (/(^|\/)xl\/media\//i.test(entry.name)) {
        await this.read(entry, false);
        continue;
      }
      let tail = '';
      await this.read(entry, false, (chunk) => {
        // Latin-1 keeps one character per byte; tags are plain ASCII.
        const text = tail + Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('latin1');
        rows += text.match(ROW_TAG)?.length ?? 0;
        cells += text.match(CELL_TAG)?.length ?? 0;
        if (rows > this.limits.rows - this.rowsUsed) this.fail('rows');
        if (cells > this.limits.cells - this.cellsUsed) this.fail('cells');
        // Carry over only a tag cut off by the chunk's end, one that wasn't counted yet.
        const open = text.slice(text.lastIndexOf('<'));
        tail = text.includes('<') && open.length < 24 && !open.includes('>') && !TAG_START.test(open) ? open : '';
      });
    }
    // Rows and cells are counted again as they are read (addRows/addCells), so the walk only refuses, it doesn't spend.
  }
}

/** The file count in a zip's end record, or null when there is none to find (JSZip will then say it's broken). */
function declaredEntries(bytes: Buffer): number | null {
  const from = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= from; i -= 1) {
    if (bytes.readUInt32LE(i) === EOCD) {
      const count = bytes.readUInt16LE(i + 10);
      // 0xFFFF means a zip64 record holds the real number: that's already past any limit we'd set.
      return count === 0xffff ? Number.MAX_SAFE_INTEGER : count;
    }
  }
  return null;
}
