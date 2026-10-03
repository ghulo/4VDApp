import { activeCatalogue } from '../i18n/useT';

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : activeCatalogue().common.somethingWrong;
}
