'use client';

export function Button({ children, variant = 'default', className = '', disabled, ...props }) {
  const base = 'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 px-4 py-2';

  const variants = {
    default: 'bg-primary text-primary-foreground hover:bg-primary/90',
    outline: 'border border-border bg-transparent text-foreground hover:bg-muted',
    ghost: 'text-foreground hover:bg-muted',
  };

  return (
    <button
      className={`${base} ${variants[variant] || variants.default} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
