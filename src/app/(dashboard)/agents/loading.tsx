export default function AgentsLoading() {
  return (
    <div className="space-y-6" aria-label="Loading AI Agents">
      <div className="space-y-2">
        <div className="h-7 w-32 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded-md bg-muted" />
      </div>

      <div className="flex gap-2">
        {['w-28', 'w-20', 'w-24', 'w-20'].map((width) => (
          <div key={width} className={`h-9 ${width} animate-pulse rounded-md bg-muted`} />
        ))}
      </div>

      <div className="min-h-[420px] animate-pulse rounded-xl border border-border bg-card" />
    </div>
  );
}
