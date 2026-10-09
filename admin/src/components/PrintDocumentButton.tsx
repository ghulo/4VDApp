import { Printer } from '@phosphor-icons/react';
import { useMutation } from '@tanstack/react-query';
import { useT } from '../i18n/useT';
import { documentsApi } from '../services/api';
import type { DocumentRef } from '../services/types';
import { errorMessage } from '../utils/errors';
import { printHtml } from '../utils/printPage';
import { Button } from './ui';

interface PrintDocumentButtonProps {
  document: DocumentRef;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'md' | 'sm';
  /** Just the printer icon, for rows in a list; the label is still read out. */
  iconOnly?: boolean;
}

/** Opens the print dialog for an invoice or credit note: any printer, or Save as PDF. */
export function PrintDocumentButton({ document, variant = 'secondary', size, iconOnly }: PrintDocumentButtonProps) {
  const t = useT();
  const print = useMutation({
    mutationFn: async () => printHtml(await documentsApi.printPage(document.id), document.number),
  });

  return (
    <span className="print-button">
      <Button
        variant={variant}
        size={size}
        icon={Printer}
        disabled={print.isPending}
        // Icon-only rows name the document; a labelled button keeps its visible words as its name.
        aria-label={iconOnly ? t.documents.printLabel(document.number) : undefined}
        aria-busy={print.isPending}
        title={iconOnly ? t.documents.print : undefined}
        onClick={() => print.mutate()}
      >
        {iconOnly ? undefined : print.isPending ? t.documents.preparing : t.documents.print}
      </Button>
      {print.isError && (
        <span className="form-error" role="alert">
          {errorMessage(print.error)}
        </span>
      )}
    </span>
  );
}
