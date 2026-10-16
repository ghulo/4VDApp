import { FileCsv, FileXls } from '@phosphor-icons/react';
import { useMutation } from '@tanstack/react-query';
import { useT } from '../i18n/useT';
import { exportsApi, type ReportRange } from '../services/api';
import { errorMessage } from '../utils/errors';
import { MenuButton } from './ui';

type ExportKind = Parameters<typeof exportsApi.download>[0];

/** A list's download key for a table's toolbar: the same file as on Reports, as Excel or CSV. */
export function ExportMenu({ kind, range }: { kind: ExportKind; range?: ReportRange }) {
  const t = useT();
  const download = useMutation({ mutationFn: (format: 'xlsx' | 'csv') => exportsApi.download(kind, format, range) });
  return (
    <>
      <MenuButton
        label={download.isPending ? t.common.downloading : t.common.download}
        icon={FileXls}
        loading={download.isPending}
        items={[
          { label: t.common.excelFile, icon: FileXls, onSelect: () => download.mutate('xlsx') },
          { label: t.common.csvFile, icon: FileCsv, onSelect: () => download.mutate('csv') },
        ]}
      />
      {download.isError && (
        <p className="form-error" role="alert">
          {errorMessage(download.error)}
        </p>
      )}
    </>
  );
}
