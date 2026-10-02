export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-text';

/** The class list for anything that should look like a button. */
export function buttonClass({
  variant = 'secondary',
  size = 'md',
  iconOnly = false,
  wide = false,
}: { variant?: ButtonVariant; size?: 'md' | 'sm'; iconOnly?: boolean; wide?: boolean } = {}): string {
  return ['button', `button--${variant}`, size === 'sm' && 'button--sm', iconOnly && 'button--icon', wide && 'button--wide']
    .filter(Boolean)
    .join(' ');
}
