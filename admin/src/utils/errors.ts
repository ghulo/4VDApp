import { activeCatalogue } from '../i18n/useT';
import { ApiError } from '../services/apiClient';

export function errorMessage(error: unknown): string {
  // A change dated in a filed VAT month: the server's words are English, so say it in the reader's language.
  if (error instanceof ApiError && error.code === 'PERIOD_FILED') return activeCatalogue().common.periodFiled;
  if (error instanceof ApiError && error.code === 'YEAR_CLOSED') return activeCatalogue().common.yearClosed;
  if (error instanceof ApiError && error.code === 'VIEWING_AS') return activeCatalogue().viewAs.nothingSaved;
  // A Counter takeover by someone a manager asked to set two-step sign-in up again.
  if (error instanceof ApiError && error.code === 'TWO_STEP_SETUP_NEEDED') return activeCatalogue().common.twoStepSetupNeeded;
  // The daily cap on wrong Counter PINs.
  if (error instanceof ApiError && error.code === 'PIN_LOCKED_DAY') return activeCatalogue().counter.pinLockedDayError;
  return error instanceof Error ? error.message : activeCatalogue().common.somethingWrong;
}
