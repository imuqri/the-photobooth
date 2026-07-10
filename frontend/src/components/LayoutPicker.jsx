import { LAYOUTS } from "../utils/layouts.js";

export default function LayoutPicker({ value, onChange, disabled }) {
  return (
    <div className="flex gap-2">
      {Object.values(LAYOUTS).map((layout) => (
        <button
          key={layout.id}
          disabled={disabled}
          onClick={() => onChange(layout.id)}
          className={`px-3 py-1.5 rounded-full text-sm font-mono border transition-colors
            ${
              value === layout.id
                ? "bg-booth-paper text-booth-bg border-booth-paper"
                : "bg-transparent text-booth-muted border-white/15 hover:border-white/30"
            }
            ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
        >
          {layout.label}
        </button>
      ))}
    </div>
  );
}
