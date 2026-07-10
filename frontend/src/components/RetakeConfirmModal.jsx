export default function RetakeConfirmModal({ isOpen, onConfirm, onCancel }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-booth-surface2 rounded-2xl p-8 max-w-md w-full border border-white/10 shadow-2xl">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-amber-500/20 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-amber-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h3 className="font-display text-xl text-booth-paper mb-2">Retake photo?</h3>
          <p className="text-booth-muted text-sm mb-6 leading-relaxed">
            This photo exists only in your browser and isn't saved anywhere. Retaking will discard it permanently —
            everyone's result popup will close and a new capture sequence will begin.
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={onCancel}
              className="px-5 py-2.5 rounded-xl bg-booth-surface border border-white/10 text-booth-paper font-display text-base hover:bg-white/5 transition-colors"
            >
              Keep Photo
            </button>
            <button
              onClick={onConfirm}
              className="px-5 py-2.5 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-300 font-display text-base hover:bg-amber-500/30 transition-colors"
            >
              Retake
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}