/**
 * Who holds typed work right now, and which moves would lose it.
 *
 * - A **page** guard (a long form: new bill, order, prices…) holds back any
 *   move to another page: a menu link, Back, a link elsewhere. Moves that
 *   stay on the page (a tab or filter kept in the address) pass.
 * - A **sheet** guard (a filled form on a card) holds back only Back: its own
 *   Save closes it by changing the address (?new=1), which must pass.
 *
 * The sign-in page always passes: signing out or a lapsed session must not
 * get stuck behind a question.
 */
export type GuardKind = 'page' | 'sheet';

export interface Guard {
  kind: GuardKind;
  /** Read at the moment of the move, so it is never a render behind. */
  active: () => boolean;
}

export interface Move {
  currentPath: string;
  nextPath: string;
  /** React Router's history action: POP is Back or Forward. */
  action: 'POP' | 'PUSH' | 'REPLACE';
}

export function holdsBack(guards: Iterable<Guard>, move: Move): boolean {
  if (move.nextPath === '/login' || move.nextPath.startsWith('/login/')) return false;
  for (const guard of guards) {
    if (!guard.active()) continue;
    if (guard.kind === 'page' && move.nextPath !== move.currentPath) return true;
    if (guard.kind === 'sheet' && move.action === 'POP') return true;
  }
  return false;
}

/**
 * Whether the browser may ask "leave this page?" on close or reload. In a Windows app before 0.5.0 the question is
 * swallowed silently (it has no handler for it), so the window would just refuse to close; 0.5.0 asks it itself.
 */
export const promptsOnUnload = (): boolean => typeof window !== 'undefined' && (!window.fourvdDesktop || window.fourvdDesktop.confirmsLeave === true);
