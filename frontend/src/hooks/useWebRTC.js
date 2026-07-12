import { useEffect, useRef, useState, useCallback } from "react";

function iceServers() {
  const servers = [{ urls: "stun:stun.l.google.com:19302" }];
  const turnUrl = import.meta.env.VITE_TURN_URL;
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: import.meta.env.VITE_TURN_USERNAME,
      credential: import.meta.env.VITE_TURN_CREDENTIAL,
    });
  }
  return servers;
}

/**
 * Establishes a full-mesh WebRTC network with every other participant
 * in the room. `socketRef` is used only to exchange SDP offers/answers
 * and ICE candidates (opaque handshake data) — actual audio/video
 * flows peer-to-peer, encrypted end-to-end by WebRTC itself (DTLS-SRTP),
 * and is never proxied through the signaling server.
 *
 * @param {React.MutableRefObject} socketRef
 * @param {MediaStream|null} localStream
 */
export function useWebRTC(socketRef, localStream) {
  const [remoteStreams, setRemoteStreams] = useState({});
  const peersRef = useRef({});
  const selfIdRef = useRef(null);
  const connectingRef = useRef(new Set());
  const connectionHealthRef = useRef({});

  const setSelfId = useCallback((id) => {
    selfIdRef.current = id;
  }, []);

  const createPeerConnection = useCallback(
    (peerId) => {
      const pc = new RTCPeerConnection({ iceServers: iceServers() });

      if (localStream) {
        for (const track of localStream.getTracks()) {
          pc.addTrack(track, localStream);
        }
      }

      // Polite/impolite glare prevention
      // Lexicographically greater socketId = polite (waits for other side)
      const isPolite = selfIdRef.current && peerId > selfIdRef.current;
      pc.polite = isPolite;

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socketRef.current?.emit("signal", {
            to: peerId,
            data: { type: "ice-candidate", candidate: event.candidate },
          });
        }
      };

      pc.ontrack = (event) => {
        connectionHealthRef.current[peerId] = {
          ...connectionHealthRef.current[peerId],
          hasTrack: true,
          connected: true,
        };
        setRemoteStreams((prev) => ({ ...prev, [peerId]: event.streams[0] }));
      };

      pc.onconnectionstatechange = () => {
        console.log(`[WebRTC] ${peerId} connection state: ${pc.connectionState}`);
        if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
          setRemoteStreams((prev) => {
            const next = { ...prev };
            delete next[peerId];
            return next;
          });
          peersRef.current[peerId]?.close();
          delete peersRef.current[peerId];
          connectingRef.current.delete(peerId);
          delete connectionHealthRef.current[peerId];
        }
      };

      pc.oniceconnectionstatechange = () => {
        connectionHealthRef.current[peerId] = {
          ...connectionHealthRef.current[peerId],
          iceState: pc.iceConnectionState,
        };

        if (pc.iceConnectionState === "failed") {
          console.log(`[WebRTC] ICE failed for ${peerId}, attempting restart`);
          pc.restartIce();
        }

        if (pc.iceConnectionState === "disconnected") {
          // Schedule reconnect if no track received within 10s
          setTimeout(() => {
            const health = connectionHealthRef.current[peerId];
            if (health && health.connected && !health.hasTrack) {
              console.log(`[WebRTC] No track after 10s for ${peerId}, reconnecting`);
              reconnectPeer(peerId);
            }
          }, 10000);
        }
      };

      // Polite/impolite: handle negotiation automatically
      pc.onnegotiationneeded = async () => {
        try {
          await pc.setLocalDescription(await pc.createOffer());
          socketRef.current?.emit("signal", {
            to: peerId,
            data: pc.localDescription,
          });
        } catch (err) {
          // Glare: polite side rolls back
          if (pc.polite && err.name === "InvalidStateError") {
            console.log(`[WebRTC] Glare detected, rolling back for ${peerId}`);
            await pc.setLocalDescription(pc.currentLocalDescription);
          } else {
            console.error(`[WebRTC] Negotiation error for ${peerId}:`, err);
          }
        }
      };

      peersRef.current[peerId] = pc;
      connectionHealthRef.current[peerId] = {
        connected: false,
        hasTrack: false,
        startTime: Date.now(),
        iceState: "new",
      };
      return pc;
    },
    [localStream, socketRef]
  );

  const reconnectPeer = useCallback(async (peerId, attempt = 0) => {
    console.log(`[WebRTC] Reconnecting to ${peerId} (attempt ${attempt + 1})`);
    closePeer(peerId);
    const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
    await new Promise((r) => setTimeout(r, delay));
    connectToPeer(peerId, { isInitiator: true, selfId: selfIdRef.current, attempt: attempt + 1 });
  }, []);

  const connectToPeer = useCallback(
    async (peerId, { isInitiator = true, selfId, attempt = 0 } = {}) => {
      // Guard: already connected
      if (peersRef.current[peerId]) {
        console.log(`[WebRTC] Already connected to ${peerId}`);
        return;
      }
      // Guard: already connecting
      if (connectingRef.current.has(peerId)) {
        console.log(`[WebRTC] Already connecting to ${peerId}`);
        return;
      }
      // Guard: self
      const myId = selfId ?? selfIdRef.current;
      if (peerId === myId) {
        console.log(`[WebRTC] Skipping self-connection`);
        return;
      }

      // Polite/impolite: impolite side initiates (lower socketId = impolite)
      const shouldInitiate = isInitiator && (!myId || peerId > myId);
      if (!shouldInitiate) {
        console.log(`[WebRTC] ${myId} waiting for ${peerId} to initiate (polite)`);
        return;
      }

      // Small random jitter to prevent simultaneous initiation
      const jitter = Math.random() * 100;
      await new Promise((r) => setTimeout(r, jitter));

      connectingRef.current.add(peerId);

      try {
        const pc = createPeerConnection(peerId);
        // Offer will be sent via onnegotiationneeded automatically
      } catch (err) {
        console.error(`[WebRTC] connectToPeer(${peerId}) failed:`, err);
        connectingRef.current.delete(peerId);
        peersRef.current[peerId]?.close();
        delete peersRef.current[peerId];
        delete connectionHealthRef.current[peerId];
        // Retry with backoff
        if (attempt < 5) {
          reconnectPeer(peerId, attempt);
        }
      }
    },
    [createPeerConnection, socketRef, reconnectPeer]
  );

  const closePeer = useCallback((peerId) => {
    peersRef.current[peerId]?.close();
    delete peersRef.current[peerId];
    connectingRef.current.delete(peerId);
    delete connectionHealthRef.current[peerId];
    setRemoteStreams((prev) => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  // Handle incoming signals (offer/answer/ice)
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    async function handleSignal({ from, data }) {
      let pc = peersRef.current[from];

      if (data.type === "offer") {
        if (!pc) pc = createPeerConnection(from);
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit("signal", {
            to: from,
            data: { type: "answer", sdp: answer },
          });
        } catch (err) {
          console.error(`[WebRTC] Error handling offer from ${from}:`, err);
        }
      } else if (data.type === "answer") {
        if (pc && pc.signalingState !== "stable") {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(data));
          } catch (err) {
            console.error(`[WebRTC] Error setting remote answer from ${from}:`, err);
          }
        }
      } else if (data.type === "ice-candidate") {
        if (pc) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          } catch {
            // Benign if it arrives before remote description is set
          }
        }
      }
    }

    function handlePeerLeft({ socketId }) {
      closePeer(socketId);
    }

    function handleConnectToNewPeer({ newPeerId, existingPeers }) {
      if (newPeerId && newPeerId !== selfIdRef.current) {
        connectToPeer(newPeerId, { isInitiator: true });
      }
      if (Array.isArray(existingPeers)) {
        for (const peerId of existingPeers) {
          if (peerId !== selfIdRef.current && !peersRef.current[peerId]) {
            connectToPeer(peerId, { isInitiator: true });
          }
        }
      }
    }

    socket.on("signal", handleSignal);
    socket.on("peer-left", handlePeerLeft);
    socket.on("connect-to-new-peer", handleConnectToNewPeer);

    return () => {
      socket.off("signal", handleSignal);
      socket.off("peer-left", handlePeerLeft);
      socket.off("connect-to-new-peer", handleConnectToNewPeer);
    };
  }, [socketRef, createPeerConnection, closePeer, connectToPeer]);

  // Tab visibility: restart ICE on wake
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        console.log("[WebRTC] Tab visible, restarting ICE on stale connections");
        for (const [peerId, pc] of Object.entries(peersRef.current)) {
          if (pc.iceConnectionState !== "connected") {
            pc.restartIce();
          }
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  // Clean up all connections on unmount
  useEffect(() => {
    return () => {
      for (const pc of Object.values(peersRef.current)) pc.close();
      peersRef.current = {};
      connectingRef.current.clear();
      connectionHealthRef.current = {};
    };
  }, []);

  return { remoteStreams, connectToPeer, closePeer, setSelfId };
}