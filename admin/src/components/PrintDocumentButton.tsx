import { Printer } from '@phosphor-icons/react';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { Language } from '../i18n/language';
import { useLanguage, useT } from '../i18n/useT';
import { documentsApi } from '../services/api';
import type { DocumentRef } from '../services/types';
import { errorMessage } from '../utils/errors';
import { printHtml } from '../utils/printPage';
import { Button } from './ui';

interface PrintDocumentButtonProps {
  document: DocumentRef;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'md' | 'sm';
  /** Just the printer icon, for rows in a list; the label is still read out, and the page comes in the reader's language. */
  iconOnly?: boolean;
}

/** Opens the print dialog for an invoice or credit note: any printer, or Save as PDF, in Albanian or English. */
export function PrintDocumentButton({ document, variant = 'secondary', size, iconOnly }: PrintDocumentButtonProps) {
  const t = useT();
  const { language: readerLanguage } = useLanguage();
  // A buyer may need the page in the other language than the person printing it reads.
  const [language, setLanguage] = useState<Language>(readerLanguage);
  const print = useMutation({
    mutationFn: async () => printHtml(await documentsApi.printPage(document.id, language), document.number),
  });
  const languages: Array<{ value: Language; label: string }> = [
    { value: 'sq', label: t.language.albanian },
    { value: 'en', label: t.language.english },
  ];

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
      {!iconOnly && (
        <span className="segmented segmented--small" role="radiogroup" aria-label={t.documents.printLanguage}>
          {languages.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={language === option.value}
              lang={option.value}
              translate="no"
              className="segmented__option"
              disabled={print.isPending}
              onClick={() => setLanguage(option.value)}
            >
              {option.label}
            </button>
          ))}
        </span>
      )}
      {print.isError && (
        <span className="form-error" role="alert">
          {errorMessage(print.error)}
        </span>
      )}
    </span>
  );
}
