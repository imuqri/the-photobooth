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
  const [remoteStreams, setRemoteStreams] = useState({}); // { socketId: MediaStream }
  const peersRef = useRef({}); // { socketId: RTCPeerConnection }
  const selfIdRef = useRef(null);
  const connectingRef = useRef(new Set()); // track in-progress connection attempts

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

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socketRef.current?.emit("signal", {
            to: peerId,
            data: { type: "ice-candidate", candidate: event.candidate },
          });
        }
      };

      pc.ontrack = (event) => {
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
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === "failed") {
          console.log(`[WebRTC] ICE failed for ${peerId}, attempting restart`);
          pc.restartIce();
        }
      };

      peersRef.current[peerId] = pc;
      return pc;
    },
    [localStream, socketRef]
  );

  const connectToPeer = useCallback(
    async (peerId, { isInitiator = true } = {}) => {
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
      if (peerId === selfIdRef.current) {
        console.log(`[WebRTC] Skipping self-connection`);
        return;
      }

      // Glare prevention: deterministic tiebreaker
      // Only the peer with lexicographically greater socketId initiates
      if (isInitiator && selfIdRef.current && peerId < selfIdRef.current) {
        console.log(
          `[WebRTC] Tiebreaker: ${selfIdRef.current} waits for ${peerId} to initiate`
        );
        return;
      }

      connectingRef.current.add(peerId);

      try {
        const pc = createPeerConnection(peerId);

        if (isInitiator) {
          const offer = await pc.createOffer({ iceRestart: true });
          await pc.setLocalDescription(offer);
          socketRef.current?.emit("signal", {
            to: peerId,
            data: { type: "offer", sdp: offer },
          });
        }
        // If not initiator, wait for offer from other side
      } catch (err) {
        console.error(`[WebRTC] connectToPeer(${peerId}) failed:`, err);
        connectingRef.current.delete(peerId);
        peersRef.current[peerId]?.close();
        delete peersRef.current[peerId];
      }
    },
    [createPeerConnection, socketRef]
  );

  const closePeer = useCallback((peerId) => {
    peersRef.current[peerId]?.close();
    delete peersRef.current[peerId];
    connectingRef.current.delete(peerId);
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
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
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
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          } catch (err) {
            console.error(
              `[WebRTC] Error setting remote answer from ${from}:`,
              err
            );
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
      // New peer joined - we (existing user) must connect to them
      if (newPeerId && newPeerId !== selfIdRef.current) {
        connectToPeer(newPeerId, { isInitiator: true });
      }
      // Reconcile: ensure we're connected to all existing peers too
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

  // Clean up all connections on unmount
  useEffect(() => {
    return () => {
      for (const pc of Object.values(peersRef.current)) pc.close();
      peersRef.current = {};
      connectingRef.current.clear();
    };
  }, []);

  return { remoteStreams, connectToPeer, closePeer, setSelfId };
}