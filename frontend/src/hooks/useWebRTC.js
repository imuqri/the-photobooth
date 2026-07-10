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
        if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
          setRemoteStreams((prev) => {
            const next = { ...prev };
            delete next[peerId];
            return next;
          });
        }
      };

      peersRef.current[peerId] = pc;
      return pc;
    },
    [localStream, socketRef]
  );

  const connectToPeer = useCallback(
    async (peerId) => {
      const pc = createPeerConnection(peerId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socketRef.current?.emit("signal", {
        to: peerId,
        data: { type: "offer", sdp: offer },
      });
    },
    [createPeerConnection, socketRef]
  );

  const closePeer = useCallback((peerId) => {
    peersRef.current[peerId]?.close();
    delete peersRef.current[peerId];
    setRemoteStreams((prev) => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    async function handleSignal({ from, data }) {
      let pc = peersRef.current[from];

      if (data.type === "offer") {
        if (!pc) pc = createPeerConnection(from);
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("signal", { to: from, data: { type: "answer", sdp: answer } });
      } else if (data.type === "answer") {
        if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      } else if (data.type === "ice-candidate") {
        if (pc) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          } catch {
            // benign if it arrives before remote description is set in rare races
          }
        }
      }
    }

    function handlePeerLeft({ socketId }) {
      closePeer(socketId);
    }

    socket.on("signal", handleSignal);
    socket.on("peer-left", handlePeerLeft);

    return () => {
      socket.off("signal", handleSignal);
      socket.off("peer-left", handlePeerLeft);
    };
  }, [socketRef, createPeerConnection, closePeer]);

  // Clean up all connections on unmount — this is also naturally what
  // happens when the tab closes, which is why camera permission doesn't
  // "leak" across sessions.
  useEffect(() => {
    return () => {
      for (const pc of Object.values(peersRef.current)) pc.close();
      peersRef.current = {};
    };
  }, []);

  return { remoteStreams, connectToPeer, closePeer };
}
