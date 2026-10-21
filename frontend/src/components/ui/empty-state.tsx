export function EmptyState({ message, children }: { message: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-line bg-surface p-10 text-center">
      <p className="wrap-break-word text-ink-muted">{message}</p>
      {children}
    </div>
  );
}
