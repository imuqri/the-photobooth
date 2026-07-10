export default function CaptureResultModal({
  imageDataUrl,
  isInitiator,
  onDownload,
  onRetake,
  onClose,
}) {
  if (!imageDataUrl) return null;

  const handleRetake = () => {
    const confirmed = window.confirm(
      "Retake photo? This photo exists only in your browser and isn't saved anywhere. Retaking will discard it permanently."
    );
    if (confirmed) {
      onRetake();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/85 flex flex-col items-center justify-center gap-5 p-6 z-50">
      <img
        src={imageDataUrl}
        alt="Your photobooth strip"
        className="max-h-[70vh] rounded-lg shadow-2xl"
      />
      <p className="text-xs font-mono text-booth-muted text-center max-w-sm">
        This never touched our server — it exists only in your browser. Download it now; closing this
        won't save a copy anywhere.
      </p>
      <div className="flex gap-3">
        <button
          onClick={onDownload}
          className="px-6 py-3 rounded-xl bg-booth-shutter text-booth-paper font-display text-lg tracking-wide"
        >
          Download
        </button>
        {isInitiator && (
          <button
            onClick={handleRetake}
            className="px-6 py-3 rounded-xl bg-booth-surface2 border border-white/15 text-booth-paper font-display text-lg tracking-wide"
          >
            Retake
          </button>
        )}
        <button
          onClick={onClose}
          className="px-6 py-3 rounded-xl bg-booth-surface2 border border-white/15 text-booth-muted font-display text-lg tracking-wide"
        >
          Close
        </button>
      </div>
    </div>
  );
}