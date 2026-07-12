// In-memory room store.
//
// Deliberately NOT a database: rooms are ephemeral, live only in process
// memory, and are wiped on a TTL. There is nothing here to breach after
// a session ends because there is nothing left.
//
// The room also keeps a `lastKnownPositions` map that preserves the
// last known position of participants even after they leave. This allows
// a user who refreshes (and gets a new socketId) to rejoin with their
// previous position, and also helps new joiners see the most recent
// positions of all current participants.

const ROOM_TTL_MS = 60 * 60 * 1000; // room dies after 60 min of no activity
const MAX_PARTICIPANTS = 6;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity
const CODE_LENGTH = 5;

/** @type {Map<string, Room>} */
const rooms = new Map();

/**
 * @typedef {Object} Participant
 * @property {string} socketId
 * @property {number} joinedAt
 * @property {{x:number,y:number,scale:number}} position
 *
 * @typedef {Object} Room
 * @property {string} code
 * @property {string} hostSocketId
 * @property {boolean} locked
 * @property {string} layout  // 'strip3' | 'grid4'
 * @property {Map<string, Participant>} participants
 * @property {Map<string, {x:number,y:number,scale:number}>} lastKnownPositions
 * @property {number} lastActivity
 */

function generateCode() {
  let code;
  do {
    code = Array.from(
      { length: CODE_LENGTH },
      () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
    ).join("");
  } while (rooms.has(code));
  return code;
}

export function createRoom(hostSocketId, layout = "strip3", userId) {
  const code = generateCode();
  /** @type {Room} */
  const room = {
    code,
    hostSocketId,
    locked: false,
    layout,
    participants: new Map(),
    lastKnownPositions: new Map(),
    lastActivity: Date.now(),
  };
  // If userId provided, pre-seed their position
  if (userId) {
    room.lastKnownPositions.set(userId, { x: 0.5, y: 0.5, scale: 1 });
  }
  rooms.set(code, room);
  return room;
}

export function getRoom(code) {
  return rooms.get(code?.toUpperCase());
}

export function touchRoom(room) {
  room.lastActivity = Date.now();
}

export function joinRoom(code, socketId, userId) {
  const room = getRoom(code);
  if (!room) return { error: "NOT_FOUND" };
  if (room.locked) return { error: "LOCKED" };
  if (room.participants.size >= MAX_PARTICIPANTS) return { error: "FULL" };

  // Preserve last known position if this userId was previously in the room
  const lastPos = userId ? room.lastKnownPositions.get(userId) : null;
  room.participants.set(socketId, {
    socketId,
    userId,
    joinedAt: Date.now(),
    position: lastPos || { x: 0.5, y: 0.5, scale: 1 },
  });
  touchRoom(room);
  return { room };
}

export function leaveRoom(code, socketId) {
  const room = getRoom(code);
  if (!room) return null;
  const participant = room.participants.get(socketId);
  if (participant?.userId) {
    // Preserve the position for potential quick rejoin (e.g., page refresh)
    room.lastKnownPositions.set(participant.userId, participant.position);
  }
  room.participants.delete(socketId);
  touchRoom(room);

  if (room.participants.size === 0) {
    rooms.delete(room.code);
    return null;
  }

  // reassign host if the host left
  if (room.hostSocketId === socketId) {
    room.hostSocketId = room.participants.keys().next().value;
  }
  return room;
}

export function setLocked(code, locked) {
  const room = getRoom(code);
  if (!room) return null;
  room.locked = locked;
  touchRoom(room);
  return room;
}

export function updatePosition(code, socketId, position) {
  const room = getRoom(code);
  if (!room) return null;
  const p = room.participants.get(socketId);
  if (!p) return null;
  p.position = position;
  if (p.userId) {
    room.lastKnownPositions.set(p.userId, position);
  }
  touchRoom(room);
  return room;
}

export function roomSummary(room) {
  return {
    code: room.code,
    layout: room.layout,
    locked: room.locked,
    hostSocketId: room.hostSocketId,
    participants: Array.from(room.participants.values()),
  };
}

// Sweep expired rooms periodically. Anything idle past the TTL disappears —
// this is the only "cleanup" mechanism the app needs, by design.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.lastActivity > ROOM_TTL_MS) {
      rooms.delete(code);
    }
  }
}, 60 * 1000).unref();

export const config = { MAX_PARTICIPANTS, ROOM_TTL_MS };