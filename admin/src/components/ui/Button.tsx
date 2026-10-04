import type { Icon } from '@phosphor-icons/react';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { Link } from 'react-router';
import { buttonClass, type ButtonVariant } from './buttonClass';


interface Look {
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  /** A line icon shown before the label (or alone, with an aria-label). */
  icon?: Icon;
  children?: ReactNode;
}

function Contents({ icon: IconComponent, children, size }: Look) {
  return (
    <>
      {IconComponent && <IconComponent size={size === 'sm' ? 14 : 16} weight="bold" aria-hidden="true" />}
      {children}
    </>
  );
}

type ButtonProps = Look & ButtonHTMLAttributes<HTMLButtonElement> & { wide?: boolean; ref?: Ref<HTMLButtonElement> };

/** Primary for the one main action, secondary for the rest, ghost for quiet ones, danger to destroy. */
export function Button({ variant, size, icon, wide, className, type = 'button', children, ...rest }: ButtonProps) {
  const iconOnly = Boolean(icon) && children === undefined;
  return (
    <button
      type={type}
      className={[buttonClass({ variant, size, iconOnly, wide }), className].filter(Boolean).join(' ')}
      {...rest}
    >
      <Contents icon={icon} size={size}>
        {children}
      </Contents>
    </button>
  );
}

type ButtonLinkProps = Look & AnchorHTMLAttributes<HTMLAnchorElement> & { to: string };

/** A link that looks like a button, for actions that open another page. */
export function ButtonLink({ variant, size, icon, to, className, children, ...rest }: ButtonLinkProps) {
  const iconOnly = Boolean(icon) && children === undefined;
  return (
    <Link to={to} className={[buttonClass({ variant, size, iconOnly }), className].filter(Boolean).join(' ')} {...rest}>
      <Contents icon={icon} size={size}>
        {children}
      </Contents>
    </Link>
  );
}
