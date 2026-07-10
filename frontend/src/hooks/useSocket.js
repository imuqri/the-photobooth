import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL || "http://localhost:4000";

/**
 * Owns one socket.io connection for the lifetime of the component that
 * uses it. The socket disconnects automatically on unmount (e.g. when
 * the user navigates away or closes the tab), which is also the moment
 * the browser revokes camera access — the two are tied together by
 * nothing surviving past the page's lifetime.
 */
export function useSocket() {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = io(SIGNALING_URL, { transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    return () => {
      socket.disconnect();
    };
  }, []);

  return { socketRef, connected };
}
