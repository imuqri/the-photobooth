import { useEffect, useRef, useState, useCallback } from "react";
import { io } from "socket.io-client";

const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL || "http://localhost:4000";
const USER_ID_KEY = "photobooth_user_id";

function generateUserId() {
  return crypto.randomUUID();
}

function getOrCreateUserId() {
  let userId = localStorage.getItem(USER_ID_KEY);
  if (!userId) {
    userId = generateUserId();
    localStorage.setItem(USER_ID_KEY, userId);
  }
  return userId;
}

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
  const handlersRef = useRef(new Map());

  useEffect(() => {
    const socket = io(SIGNALING_URL, { transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      // Re-register all handlers on reconnect
      handlersRef.current.forEach((handler, event) => {
        socket.on(event, handler);
      });
    });
    socket.on("disconnect", () => setConnected(false));

    return () => {
      socket.disconnect();
    };
  }, []);

  /**
   * Register a socket event handler that persists across reconnections.
   * Returns a cleanup function to unregister the handler.
   *
   * @param {string} event - Socket event name (e.g., "peer-position")
   * @param {Function} handler - Event handler function
   * @returns {Function} Cleanup function to unregister the handler
   */
  const registerHandler = useCallback((event, handler) => {
    // Store handler for reconnection
    handlersRef.current.set(event, handler);

    // Register immediately if connected
    const socket = socketRef.current;
    if (socket?.connected) {
      socket.on(event, handler);
    }

    // Return cleanup function
    return () => {
      handlersRef.current.delete(event);
      socket?.off(event, handler);
    };
  }, []);

  return { socketRef, connected, registerHandler };
}

export function useUserId() {
  const userId = getOrCreateUserId();
  return userId;
}