/**
 * In-memory state for browser-only 3-way conferences.
 *
 * One "room" per active conference. Lifecycle:
 *   1. Agent calls trpc `telnyx.conference.start({ customerNumber })` → a room is
 *      registered keyed by a freshly generated token, and the customer number is
 *      stashed (no leg exists yet).
 *   2. Agent's WebRTC client dials the conference DID with custom header
 *      `X-Conf-Token: <token>` → /api/telnyx/voice gets `call.initiated`, looks up
 *      the room by token, answers the agent leg.
 *   3. On agent `call.answered` → create the Telnyx conference, dial the customer.
 *   4. Customer `call.answered` → join the room.
 *   5. Agent adds a target → dial target → on answer, join (optionally on hold).
 *
 * This is process-local (like the previous bridgeState). A single-instance server
 * is assumed; if you scale horizontally, move this to a shared store.
 */

export type ParticipantRole = "agent" | "customer" | "target";

export interface Participant {
  role: ParticipantRole;
  number: string;            // E.164 (agent leg uses the conference DID)
  callControlId?: string;    // set once the leg exists
  onHold: boolean;
  joinedAt?: number;
}

export interface ConferenceRoom {
  token: string;             // correlates the agent WebRTC leg to this room
  conferenceId?: string;     // Telnyx conference id, set after creation
  customerNumber: string;
  participants: Participant[];
  createdAt: number;
}

// token → room
const rooms = new Map<string, ConferenceRoom>();
// call_control_id → token (reverse lookup for webhook events)
const callIndex = new Map<string, string>();

export function createRoom(token: string, customerNumber: string): ConferenceRoom {
  const room: ConferenceRoom = {
    token,
    customerNumber,
    participants: [
      { role: "agent", number: "(webrtc)", onHold: false },
      { role: "customer", number: customerNumber, onHold: false },
    ],
    createdAt: Date.now(),
  };
  rooms.set(token, room);
  return room;
}

export function getRoomByToken(token: string): ConferenceRoom | undefined {
  return rooms.get(token);
}

export function getRoomByCall(callControlId: string): ConferenceRoom | undefined {
  const token = callIndex.get(callControlId);
  return token ? rooms.get(token) : undefined;
}

/** Attach a call_control_id to a participant role and index it for reverse lookup. */
export function bindCall(token: string, role: ParticipantRole, callControlId: string, number?: string) {
  const room = rooms.get(token);
  if (!room) return;
  let p = room.participants.find((x) => x.role === role && !x.callControlId);
  if (!p) {
    p = { role, number: number ?? "", onHold: false };
    room.participants.push(p);
  }
  p.callControlId = callControlId;
  if (number) p.number = number;
  p.joinedAt = Date.now();
  callIndex.set(callControlId, token);
}

/** Add a target participant slot (before its leg exists). */
export function addTargetSlot(token: string, number: string): Participant | undefined {
  const room = rooms.get(token);
  if (!room) return undefined;
  const p: Participant = { role: "target", number, onHold: false };
  room.participants.push(p);
  return p;
}

export function setHold(callControlId: string, onHold: boolean) {
  const room = getRoomByCall(callControlId);
  const p = room?.participants.find((x) => x.callControlId === callControlId);
  if (p) p.onHold = onHold;
}

/** Remove a leg from its room. If the room is empty afterwards, delete it. */
export function removeCall(callControlId: string) {
  const token = callIndex.get(callControlId);
  callIndex.delete(callControlId);
  if (!token) return;
  const room = rooms.get(token);
  if (!room) return;
  room.participants = room.participants.filter((p) => p.callControlId !== callControlId);
  const liveLegs = room.participants.filter((p) => p.callControlId);
  if (liveLegs.length === 0) rooms.delete(token);
}

export function deleteRoom(token: string) {
  const room = rooms.get(token);
  if (room) {
    for (const p of room.participants) {
      if (p.callControlId) callIndex.delete(p.callControlId);
    }
  }
  rooms.delete(token);
}

/** Public-safe snapshot for the client UI (no call_control_ids). */
export function roomSnapshot(token: string) {
  const room = rooms.get(token);
  if (!room) return null;
  return {
    token: room.token,
    active: !!room.conferenceId,
    participants: room.participants.map((p) => ({
      role: p.role,
      number: p.number,
      onHold: p.onHold,
      connected: !!p.callControlId,
    })),
  };
}
