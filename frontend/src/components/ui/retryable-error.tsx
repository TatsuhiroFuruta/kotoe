import { buttonClasses } from "@/components/ui/button";

export function RetryableError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-card border border-line bg-surface p-8 text-center">
      <p className="text-ink">{message}</p>
      <button type="button" onClick={onRetry} className={buttonClasses({ variant: "secondary" })}>
        再試行
      </button>
    </div>
  );
}
