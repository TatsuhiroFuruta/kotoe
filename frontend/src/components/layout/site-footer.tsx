export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-1 px-4 py-6 text-xs text-ink-muted sm:flex-row sm:items-center sm:justify-between">
        <span>Kotoe（言絵）</span>
        <span>画像を言葉だけで描写し、その言葉から AI が再現する</span>
      </div>
    </footer>
  );
}
