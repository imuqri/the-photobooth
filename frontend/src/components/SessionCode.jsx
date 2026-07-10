import { useState } from "react";

export default function SessionCode({ code }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/room/${code}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard API unavailable — user can still select the code manually
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-xs uppercase tracking-[0.25em] text-booth-muted font-mono">
        Session code
      </span>
      <div className="flex items-center gap-3">
        <span className="font-mono text-3xl tracking-[0.35em] text-booth-paper bg-booth-surface2 px-4 py-2 rounded-md border border-white/10">
          {code}
        </span>
        <button
          onClick={copyLink}
          className="text-sm font-mono px-3 py-2 rounded-md bg-booth-shutter/90 hover:bg-booth-shutter text-booth-paper transition-colors"
        >
          {copied ? "Copied!" : "Copy link"}
        </button>
      </div>
    </div>
  );
}
