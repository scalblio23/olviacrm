import { useEffect, useRef, useState, useCallback } from "react";
import { TelnyxRTC } from "@telnyx/webrtc";
import { trpc } from "@/lib/trpc";

export type PhoneState =
  | "idle"
  | "initializing"
  | "ready"
  | "connecting"   // call object created, ICE gathering
  | "ringing"      // remote party ringing (SIP 180)
  | "active"       // call connected, media flowing
  | "reconnecting" // ICE/DTLS failure, SDK retrying
  | "ended"        // call just ended (brief flash)
  | "error";

export interface ConferenceParticipant {
  role: "agent" | "customer" | "target";
  number: string;
  onHold: boolean;
  connected: boolean;
}

export interface UseTelnyxPhoneReturn {
  phoneState: PhoneState;
  isMuted: boolean;
  error: string | null;
  callCause: string | null;
  dial: (to: string) => void;
  hangup: () => void;
  toggleMute: () => void;
  initialize: () => void;
  // ─── Conference (browser-only 3-way) ───
  conferenceToken: string | null;
  conferenceParticipants: ConferenceParticipant[];
  startConference: (customerNumber: string) => Promise<void>;
  addTarget: (targetNumber: string, warm?: boolean) => Promise<void>;
  mergeConference: () => Promise<void>;
  setParticipantHold: (role: "customer" | "target", onHold: boolean) => Promise<void>;
  removeParticipant: (role: "customer" | "target") => Promise<void>;
  leaveConference: () => Promise<void>;
  endConference: () => Promise<void>;
}

export function useTelnyxPhone(): UseTelnyxPhoneReturn {
  const [phoneState, setPhoneState] = useState<PhoneState>("idle");
  const [isMuted, setIsMuted]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [callCause, setCallCause]   = useState<string | null>(null);
  const [conferenceToken, setConferenceToken] = useState<string | null>(null);
  const [conferenceParticipants, setConferenceParticipants] =
    useState<ConferenceParticipant[]>([]);

  const clientRef      = useRef<TelnyxRTC | null>(null);
  const activeCallRef  = useRef<ReturnType<TelnyxRTC["newCall"]> | null>(null);
  // Hidden <audio> element that the SDK attaches the remote stream to
  const audioElRef     = useRef<HTMLAudioElement | null>(null);
  // From number returned by the server (never exposed to client directly)
  const fromNumberRef  = useRef<string>("");
  // Ringback tone audio element
  const ringAudioRef   = useRef<HTMLAudioElement | null>(null);
  // Call-start chime audio element
  const callStartAudioRef = useRef<HTMLAudioElement | null>(null);

  const playCallStart = useCallback(() => {
    if (!callStartAudioRef.current) {
      const el = document.createElement("audio");
      el.src = "/manus-storage/call_start_004ed2ca.wav";
      el.loop = false;
      el.volume = 0.8;
      el.style.display = "none";
      document.body.appendChild(el);
      callStartAudioRef.current = el;
    }
    callStartAudioRef.current.currentTime = 0;
    callStartAudioRef.current.play().catch(() => { /* autoplay blocked — ignore */ });
  }, []);

  const startRingback = useCallback(() => {
    if (!ringAudioRef.current) {
      const el = document.createElement("audio");
      el.src = "/manus-storage/ringback_152634c7.wav";
      el.loop = true;
      el.volume = 0.6;
      el.style.display = "none";
      document.body.appendChild(el);
      ringAudioRef.current = el;
    }
    ringAudioRef.current.currentTime = 0;
    ringAudioRef.current.play().catch(() => { /* autoplay blocked — ignore */ });
  }, []);

  const stopRingback = useCallback(() => {
    if (ringAudioRef.current) {
      ringAudioRef.current.pause();
      ringAudioRef.current.currentTime = 0;
    }
  }, []);

  const getTokenMutation = trpc.telnyx.getWebRTCToken.useMutation();

  // ─── Conference mutations + state polling ──────────────────────────────────
  const utils                = trpc.useUtils();
  const confStartMutation    = trpc.telnyx.conference.start.useMutation();
  const confAddMutation      = trpc.telnyx.conference.addTarget.useMutation();
  const confMergeMutation    = trpc.telnyx.conference.merge.useMutation();
  const confHoldMutation     = trpc.telnyx.conference.setHold.useMutation();
  const confRemoveMutation   = trpc.telnyx.conference.removeParticipant.useMutation();
  const confLeaveMutation    = trpc.telnyx.conference.leave.useMutation();
  const confEndMutation      = trpc.telnyx.conference.end.useMutation();

  // Poll room state while a conference is live so the participant list stays fresh.
  useEffect(() => {
    if (!conferenceToken) return;
    let active = true;
    const poll = async () => {
      try {
        const snap = await utils.telnyx.conference.state.fetch({ token: conferenceToken });
        if (active && snap) setConferenceParticipants(snap.participants as ConferenceParticipant[]);
      } catch { /* transient — keep polling */ }
    };
    void poll();
    const id = setInterval(() => void poll(), 2500);
    return () => { active = false; clearInterval(id); };
  }, [conferenceToken, utils]);

  // Create a persistent hidden audio element on first use
  const getAudioEl = useCallback(() => {
    if (!audioElRef.current) {
      const el = document.createElement("audio");
      el.autoplay = true;
      el.style.display = "none";
      document.body.appendChild(el);
      audioElRef.current = el;
    }
    return audioElRef.current;
  }, []);

  const cleanup = useCallback(() => {
    if (clientRef.current) {
      try { clientRef.current.disconnect(); } catch { /* ignore */ }
      clientRef.current = null;
    }
    activeCallRef.current = null;
  }, []);

  const initialize = useCallback(async () => {
    // Allow re-init from error state
    if (phoneState === "initializing" || phoneState === "ready") return;
    setPhoneState("initializing");
    setError(null);
    setCallCause(null);

    try {
      // 1. Request mic permission upfront
      await navigator.mediaDevices.getUserMedia({ audio: true });

      // 2. Get a fresh JWT from the backend (also retrieves the from number server-side)
      const { token, fromNumber } = await getTokenMutation.mutateAsync();
      fromNumberRef.current = fromNumber ?? "";

      // 3. Create the Telnyx WebRTC client
      const client = new TelnyxRTC({
        login_token: token,
      });

      // 4. Wire up client-level events
      client.on("telnyx.ready", () => {
        console.log("[TelnyxRTC] ready");
        setPhoneState("ready");
        setError(null);
      });

      client.on("telnyx.error", (err: { code?: string; message?: string }) => {
        console.error("[TelnyxRTC] client error", err);
        setError(err?.message ?? "Connection error");
        setPhoneState("error");
      });

      // 5. Wire up call state notifications
      client.on("telnyx.notification", (notification: {
        type: string;
        call?: {
          state: string;
          direction?: string;
          cause?: string;
          muteAudio?: () => void;
          unmuteAudio?: () => void;
          hangup?: () => void;
          answer?: () => void;
        };
      }) => {
        if (notification.type !== "callUpdate" || !notification.call) return;

        const call  = notification.call;
        const state = call.state;
        const cause = call.cause ?? null;

        console.log(`[TelnyxRTC] callUpdate state=${state} direction=${call.direction ?? "?"} cause=${cause ?? "-"}`);

        switch (state) {
          case "new":
          case "requesting":
            // Call object created / SIP INVITE being sent
            setPhoneState("connecting");
            startRingback();
            activeCallRef.current = call as ReturnType<TelnyxRTC["newCall"]>;
            break;

          case "trying":
          case "ringing":
            setPhoneState("ringing");
            startRingback();
            activeCallRef.current = call as ReturnType<TelnyxRTC["newCall"]>;
            break;

          case "active":
            stopRingback();
            playCallStart();
            setPhoneState("active");
            setIsMuted(false);
            activeCallRef.current = call as ReturnType<TelnyxRTC["newCall"]>;
            break;

          case "held":
            // Keep active ref but show as active (held is a sub-state)
            activeCallRef.current = call as ReturnType<TelnyxRTC["newCall"]>;
            break;

          case "reconnecting":
            setPhoneState("reconnecting");
            break;

          case "hangup":
          case "destroy":
          case "destroyed":
            // Terminal state — call has ended
            stopRingback();
            setCallCause(cause);
            setPhoneState("ended");
            setIsMuted(false);
            activeCallRef.current = null;
            // If the agent's leg was part of a conference, it has now left it.
            setConferenceToken(null);
            setConferenceParticipants([]);
            // Return to ready after a brief "call ended" flash (1.5s)
            setTimeout(() => {
              setPhoneState("ready");
              setCallCause(null);
            }, 1500);
            break;

          default:
            console.log(`[TelnyxRTC] unhandled state: ${state}`);
        }
      });

      // 6. Connect the WebSocket to Telnyx
      client.connect();
      clientRef.current = client;

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to initialize phone";
      console.error("[TelnyxRTC] init error:", msg);
      setError(msg);
      setPhoneState("error");
      cleanup();
    }
  }, [phoneState, getTokenMutation, cleanup, getAudioEl]);

  /** Normalise any phone number to E.164 format.
   *  Handles:
   *  - Australian local: 04xxxxxxxx  → +614xxxxxxxx
   *  - Australian no-plus: 614xxxxxxxx → +614xxxxxxxx
   *  - Already E.164: +614xxxxxxxx → unchanged
   *  - US local: 10-digit starting with 2-9 → +1xxxxxxxxxx
   *  - Anything else: strips non-digit chars and prepends + if missing
   */
  const normalisePhone = useCallback((raw: string): string => {
    const digits = raw.replace(/[^\d]/g, "");
    // Australian mobile/landline: starts with 0 (local format)
    if (digits.startsWith("0") && digits.length === 10) {
      return "+61" + digits.slice(1);
    }
    // Australian without leading +: 61 followed by 9 digits
    if (digits.startsWith("61") && digits.length === 11) {
      return "+" + digits;
    }
    // US 10-digit (no country code)
    if (digits.length === 10 && /^[2-9]/.test(digits)) {
      return "+1" + digits;
    }
    // Already has + prefix — return as-is
    if (raw.startsWith("+")) return raw;
    // Fallback: prepend + to the digit string
    return "+" + digits;
  }, []);

  const dial = useCallback((to: string) => {
    if (!clientRef.current || phoneState !== "ready") {
      console.warn("[TelnyxRTC] dial() called but not ready, state=", phoneState);
      return;
    }
    const normalisedTo = normalisePhone(to);
    try {
      console.log(`[TelnyxRTC] dialling ${normalisedTo} (raw: ${to})`);
      setCallCause(null);
      const call = clientRef.current.newCall({
        destinationNumber: normalisedTo,
        callerNumber: fromNumberRef.current || "+61485825732",
        callerName: "Loop Dialer",
        audio: true,
        remoteElement: getAudioEl(),
      });
      activeCallRef.current = call;
      setPhoneState("connecting");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to place call";
      console.error("[TelnyxRTC] dial error:", msg);
      setError(msg);
      setPhoneState("error");
    }
  }, [phoneState, getAudioEl, normalisePhone]);

  const hangup = useCallback(() => {
    if (activeCallRef.current) {
      try { activeCallRef.current.hangup(); } catch { /* ignore */ }
      activeCallRef.current = null;
    }
    setPhoneState("ready");
    setIsMuted(false);
  }, []);

  // ─── Conference controls ───────────────────────────────────────────────────

  /** Start a 3-way: place the agent's WebRTC leg into a server conference room,
   *  then the server dials the customer into the same room. */
  const startConference = useCallback(async (customerNumber: string) => {
    if (!clientRef.current || phoneState !== "ready") {
      throw new Error("Phone not ready — connect your microphone first");
    }
    const { token, conferenceDid } = await confStartMutation.mutateAsync({ customerNumber });
    setConferenceToken(token);
    setConferenceParticipants([]);
    setCallCause(null);
    // The agent dials the conference DID; the X-Conf-Token header lets the server
    // match this WebRTC leg to the room it just registered.
    const opts = {
      destinationNumber: conferenceDid,
      callerNumber: fromNumberRef.current || "+61485825732",
      callerName: "Loop Dialer",
      audio: true,
      remoteElement: getAudioEl(),
      customHeaders: [{ name: "X-Conf-Token", value: token }],
    } as Parameters<TelnyxRTC["newCall"]>[0];
    const call = clientRef.current.newCall(opts);
    activeCallRef.current = call;
    setPhoneState("connecting");
  }, [phoneState, confStartMutation, getAudioEl]);

  const addTarget = useCallback(async (targetNumber: string, warm = true) => {
    if (!conferenceToken) throw new Error("No active conference");
    const snap = await confAddMutation.mutateAsync({ token: conferenceToken, targetNumber, warm });
    if (snap) setConferenceParticipants(snap.participants as ConferenceParticipant[]);
  }, [conferenceToken, confAddMutation]);

  const mergeConference = useCallback(async () => {
    if (!conferenceToken) return;
    const snap = await confMergeMutation.mutateAsync({ token: conferenceToken });
    if (snap) setConferenceParticipants(snap.participants as ConferenceParticipant[]);
  }, [conferenceToken, confMergeMutation]);

  const setParticipantHold = useCallback(async (role: "customer" | "target", onHold: boolean) => {
    if (!conferenceToken) return;
    const snap = await confHoldMutation.mutateAsync({ token: conferenceToken, role, onHold });
    if (snap) setConferenceParticipants(snap.participants as ConferenceParticipant[]);
  }, [conferenceToken, confHoldMutation]);

  const removeParticipant = useCallback(async (role: "customer" | "target") => {
    if (!conferenceToken) return;
    const snap = await confRemoveMutation.mutateAsync({ token: conferenceToken, role });
    if (snap) setConferenceParticipants(snap.participants as ConferenceParticipant[]);
  }, [conferenceToken, confRemoveMutation]);

  /** Agent drops out — customer + target keep talking on Telnyx. */
  const leaveConference = useCallback(async () => {
    if (conferenceToken) {
      try { await confLeaveMutation.mutateAsync({ token: conferenceToken }); } catch { /* ignore */ }
    }
    if (activeCallRef.current) {
      try { activeCallRef.current.hangup(); } catch { /* ignore */ }
      activeCallRef.current = null;
    }
    setConferenceToken(null);
    setConferenceParticipants([]);
    setIsMuted(false);
    setPhoneState("ready");
  }, [conferenceToken, confLeaveMutation]);

  /** End the whole conference (everyone hangs up). */
  const endConference = useCallback(async () => {
    if (conferenceToken) {
      try { await confEndMutation.mutateAsync({ token: conferenceToken }); } catch { /* ignore */ }
    }
    if (activeCallRef.current) {
      try { activeCallRef.current.hangup(); } catch { /* ignore */ }
      activeCallRef.current = null;
    }
    setConferenceToken(null);
    setConferenceParticipants([]);
    setIsMuted(false);
    setPhoneState("ready");
  }, [conferenceToken, confEndMutation]);

  const toggleMute = useCallback(() => {
    if (!activeCallRef.current) return;
    if (isMuted) {
      activeCallRef.current.unmuteAudio();
      setIsMuted(false);
    } else {
      activeCallRef.current.muteAudio();
      setIsMuted(true);
    }
  }, [isMuted]);

  // Cleanup audio element and client on unmount
  useEffect(() => {
    return () => {
      cleanup();
      if (audioElRef.current) {
        audioElRef.current.remove();
        audioElRef.current = null;
      }
    };
  }, [cleanup]);

  return {
    phoneState, isMuted, error, callCause,
    dial, hangup, toggleMute, initialize,
    conferenceToken, conferenceParticipants,
    startConference, addTarget, mergeConference,
    setParticipantHold, removeParticipant, leaveConference, endConference,
  };
}
