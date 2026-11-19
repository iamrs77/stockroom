/** Joins class names, skipping false, null and undefined, e.g. cx('rounded', isActive && 'bg-accent'). */
export const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');
