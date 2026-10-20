/**
 * A keyboard shortcut drawn as keycaps, one cap per key ("Ctrl" "K"), the
 * way the Counter's keys look. Plain `<kbd>` elsewhere gets the same cap.
 */
export function Kbd({ keys, size = 'md' }: { keys: string | string[]; size?: 'sm' | 'md' }) {
  const list = Array.isArray(keys) ? keys : [keys];
  return (
    <kbd className={size === 'sm' ? 'kbd kbd--sm' : 'kbd'}>
      {list.map((key, index) => (
        <kbd key={`${key}-${index}`}>{key}</kbd>
      ))}
    </kbd>
  );
}
