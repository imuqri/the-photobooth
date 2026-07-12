import { useState } from "react";
import { useNavigate } from "react-router-dom";
import LayoutPicker from "../components/LayoutPicker.jsx";

export default function Landing() {
  const navigate = useNavigate();
  const [mode, setMode] = useState("choose"); // 'choose' | 'create' | 'join'
  const [layout, setLayout] = useState("strip3");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function createSession() {
    setBusy(true);
    setError("");
    // Use fetch to call a REST endpoint instead of socket
    // This avoids socket connection issues during navigation
    fetch("/api/create-room", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layout }),
    })
      .then((res) => res.json())
      .then((res) => {
        setBusy(false);
        if (res?.error) return setError(readableError(res.error));
        navigate(`/room/${res.room.code}`);
      })
      .catch(() => {
        setBusy(false);
        setError("Failed to create room. Please try again.");
      });
  }

  function joinSession(e) {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) return setError("Enter the code your host shared with you.");
    navigate(`/room/${code}`);
  }

  function joinSession(e) {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) return setError("Enter the code your host shared with you.");
    navigate(`/room/${code}`);
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-booth-muted mb-3">
        No sign up · Nothing saved · Camera-only while you're here
      </p>
      <h1 className="font-display text-6xl sm:text-7xl text-booth-paper tracking-wide text-shadow-soft">
        Together&nbsp;Booth
      </h1>
      <p className="text-booth-muted mt-3 max-w-md">
        Open your camera, share a code, and pile into one frame with whoever you invite —
        wherever they are. Take the shot, download it, and it's gone from here.
      </p>

      {mode === "choose" && (
        <div className="mt-10 flex flex-col sm:flex-row gap-4">
          <button
            onClick={() => setMode("create")}
            className="px-8 py-4 rounded-xl bg-booth-shutter text-booth-paper font-display text-2xl tracking-wide hover:brightness-110 transition"
          >
            Start a Booth
          </button>
          <button
            onClick={() => setMode("join")}
            className="px-8 py-4 rounded-xl bg-booth-surface2 border border-white/10 text-booth-paper font-display text-2xl tracking-wide hover:border-white/25 transition"
          >
            Join a Booth
          </button>
        </div>
      )}

      {mode === "create" && (
        <div className="mt-10 flex flex-col items-center gap-5">
          <div>
            <p className="text-xs font-mono uppercase tracking-widest text-booth-muted mb-2">
              Choose a layout
            </p>
            <LayoutPicker value={layout} onChange={setLayout} />
          </div>
          <button
            onClick={createSession}
            disabled={!connected || busy}
            className="px-8 py-3 rounded-xl bg-booth-shutter text-booth-paper font-display text-xl tracking-wide disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create session"}
          </button>
          <BackButton onClick={() => setMode("choose")} />
        </div>
      )}

      {mode === "join" && (
        <form onSubmit={joinSession} className="mt-10 flex flex-col items-center gap-4">
          <input
            autoFocus
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder="ENTER CODE"
            maxLength={6}
            className="font-mono text-2xl tracking-[0.4em] text-center bg-booth-surface2 border border-white/15
                       rounded-lg px-4 py-3 text-booth-paper placeholder:text-booth-muted/50 w-64 uppercase"
          />
          <button
            type="submit"
            className="px-8 py-3 rounded-xl bg-booth-shutter text-booth-paper font-display text-xl tracking-wide"
          >
            Join session
          </button>
          <BackButton onClick={() => setMode("choose")} />
        </form>
      )}

      {error && <p className="mt-4 text-booth-shutter font-mono text-sm">{error}</p>}
    </div>
  );
}

function BackButton({ onClick }) {
  return (
    <button onClick={onClick} className="text-sm text-booth-muted hover:text-booth-paper underline">
      Back
    </button>
  );
}

function readableError(code) {
  switch (code) {
    case "RATE_LIMITED":
      return "Too many attempts — wait a minute and try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}
