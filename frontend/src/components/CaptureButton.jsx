export default function CaptureButton({ onClick, disabled, countdown, shotLabel }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={onClick}
        disabled={disabled}
        aria-label="Take photo"
        className="relative w-20 h-20 rounded-full bg-booth-shutter disabled:bg-booth-muted/40
                   disabled:cursor-not-allowed shadow-[0_0_0_4px_rgba(242,236,226,0.15)]
                   hover:shadow-[0_0_0_6px_rgba(242,236,226,0.22)] transition-shadow
                   flex items-center justify-center"
      >
        {countdown ? (
          <span className="text-3xl font-display text-booth-paper animate-countdown">
            {countdown}
          </span>
        ) : (
          <span className="w-14 h-14 rounded-full border-2 border-booth-paper/80" />
        )}
      </button>
      <span className="text-xs font-mono text-booth-muted uppercase tracking-widest">
        {shotLabel}
      </span>
    </div>
  );
}
