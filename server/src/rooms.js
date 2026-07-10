// In-memory room store.
//
// Deliberately NOT a database: rooms are ephemeral, live only in process
// memory, and are wiped on a TTL. There is nothing here to breach after
// a session ends because there is nothing left.

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

export function createRoom(hostSocketId, layout = "strip3") {
  const code = generateCode();
  /** @type {Room} */
  const room = {
    code,
    hostSocketId,
    locked: false,
    layout,
    participants: new Map(),
    lastActivity: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

export function getRoom(code) {
  return rooms.get(code?.toUpperCase());
}

export function touchRoom(room) {
  room.lastActivity = Date.now();
}

export function joinRoom(code, socketId) {
  const room = getRoom(code);
  if (!room) return { error: "NOT_FOUND" };
  if (room.locked) return { error: "LOCKED" };
  if (room.participants.size >= MAX_PARTICIPANTS) return { error: "FULL" };

  room.participants.set(socketId, {
    socketId,
    joinedAt: Date.now(),
    position: { x: 0.5, y: 0.5, scale: 1 },
  });
  touchRoom(room);
  return { room };
}

export function leaveRoom(code, socketId) {
  const room = getRoom(code);
  if (!room) return null;
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
