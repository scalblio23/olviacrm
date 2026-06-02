/**
 * Telnyx Call Control + Conference helpers.
 *
 * These wrap the Telnyx Voice API (https://api.telnyx.com/v2) commands needed to
 * run a browser-only 3-way conference:
 *
 *   - The agent's WebRTC leg dials a dedicated "conference DID" which is attached
 *     to a Call Control application. That gives the *server* a call_control_id for
 *     the agent leg (something the plain WebRTC SDK never exposes).
 *   - The server creates a conference from the agent leg, then dials the customer
 *     (and later a transfer target) into the same conference.
 *   - Telnyx mixes the audio. The agent can leave without ending the room, so the
 *     customer and target stay connected.
 *
 * All audio mixing happens on Telnyx — nothing is bridged through the browser.
 */

const TELNYX_API_KEY = process.env.TELNYX_API_KEY ?? "";

// Connection (Call Control app) used to dial the customer/target PSTN legs.
export const TELNYX_CALL_CONTROL_CONNECTION_ID =
  process.env.TELNYX_CALL_CONTROL_CONNECTION_ID ?? "";

// Caller-ID used for the outbound customer/target legs.
const TELNYX_FROM_NUMBER = process.env.TELNYX_FROM_NUMBER ?? "+61485825732";

// The DID the agent's WebRTC client dials to "enter the room". Inbound calls to
// this number must be routed to the same Call Control application whose webhook
// points at /api/telnyx/voice.
export const TELNYX_CONFERENCE_DID = process.env.TELNYX_CONFERENCE_DID ?? "";

/** Encode an arbitrary object as a Telnyx client_state (base64 JSON). */
export function encodeClientState(obj: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
}

/** Decode a Telnyx client_state back into an object (returns {} on failure). */
export function decodeClientState(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || !raw) return {};
  try {
    return JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function telnyxVoicePost(
  path: string,
  body: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  if (!TELNYX_API_KEY) throw new Error("TELNYX_API_KEY not configured");
  const res = await fetch(`https://api.telnyx.com/v2${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TELNYX_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    /* non-JSON body — leave json empty */
  }
  if (!res.ok) {
    // 422 "call has already ended" style errors are common during teardown races;
    // surface the detail but let callers decide whether to ignore.
    const errors = Array.isArray(json?.errors) ? json.errors : [];
    console.error(`[TelnyxVoice] POST ${path} failed (HTTP ${res.status}):`, errors.length ? JSON.stringify(errors) : raw);
    throw new Error(`Telnyx voice ${path} error ${res.status}`);
  }
  return json;
}

/** Answer an inbound call (the agent's WebRTC leg arriving at the Call Control app). */
export function answerCall(callControlId: string, clientState?: string) {
  return telnyxVoicePost(`/calls/${callControlId}/actions/answer`,
    clientState ? { client_state: clientState } : {});
}

/** Hang up a single call leg. */
export async function hangupCall(callControlId: string) {
  try {
    await telnyxVoicePost(`/calls/${callControlId}/actions/hangup`);
  } catch {
    /* leg may already be gone — ignore */
  }
}

/**
 * Create a conference seeded from an existing (answered) call leg — typically the
 * agent's WebRTC leg. The seeding leg is placed into the room immediately.
 * Returns the conference id.
 */
export async function createConference(name: string, callControlId: string): Promise<string> {
  const res = await telnyxVoicePost(`/conferences`, {
    name,
    call_control_id: callControlId,
    // Agent leaving must NOT tear the room down.
    end_conference_on_exit: false,
    start_conference_on_create: true,
  });
  const data = res?.data as Record<string, unknown> | undefined;
  const id = data?.id as string | undefined;
  if (!id) throw new Error("Telnyx createConference returned no id");
  return id;
}

/**
 * Dial a PSTN number as a new outbound leg. The leg is NOT yet in the conference;
 * join it on the resulting `call.answered` webhook. Returns the new call_control_id.
 */
export async function dialOut(to: string, clientState: string): Promise<string> {
  if (!TELNYX_CALL_CONTROL_CONNECTION_ID) {
    throw new Error("TELNYX_CALL_CONTROL_CONNECTION_ID not configured");
  }
  const res = await telnyxVoicePost(`/calls`, {
    connection_id: TELNYX_CALL_CONTROL_CONNECTION_ID,
    to,
    from: TELNYX_FROM_NUMBER,
    client_state: clientState,
  });
  const data = res?.data as Record<string, unknown> | undefined;
  const id = data?.call_control_id as string | undefined;
  if (!id) throw new Error("Telnyx dialOut returned no call_control_id");
  return id;
}

/**
 * Join an answered leg into a conference.
 * @param hold  start this participant on hold (used for warm transfers).
 * @param endConferenceOnExit  when true, the whole room ends if this leg leaves.
 */
export function joinConference(
  conferenceId: string,
  callControlId: string,
  opts: { hold?: boolean; endConferenceOnExit?: boolean } = {},
) {
  return telnyxVoicePost(`/conferences/${conferenceId}/actions/join`, {
    call_control_id: callControlId,
    hold: opts.hold ?? false,
    end_conference_on_exit: opts.endConferenceOnExit ?? false,
  });
}

/** Put one or more participants on hold (they hear hold music / silence). */
export function holdParticipants(conferenceId: string, callControlIds: string[]) {
  return telnyxVoicePost(`/conferences/${conferenceId}/actions/hold`, {
    call_control_ids: callControlIds,
  });
}

/** Take one or more participants off hold (back into the live mix). */
export function unholdParticipants(conferenceId: string, callControlIds: string[]) {
  return telnyxVoicePost(`/conferences/${conferenceId}/actions/unhold`, {
    call_control_ids: callControlIds,
  });
}

/** Remove a participant from the conference (without ending the room). */
export function leaveConference(conferenceId: string, callControlId: string) {
  return telnyxVoicePost(`/conferences/${conferenceId}/actions/leave`, {
    call_control_id: callControlId,
  });
}
