# Browser-only 3-way conference — setup guide

This feature lets an agent run a **3-way conference call entirely from the browser**
(no phone needed). The agent, the customer, and a transfer target all join a
**Telnyx Conference** room. Telnyx mixes the audio, so:

- everyone hears everyone (real 3-way), and
- the **agent can leave and the customer + target stay connected**.

## How it works (plain English)

1. Agent clicks **3-Way** → the app registers a "room" on the server and the
   agent's browser dials a dedicated phone number (the *conference DID*) to step
   into that room.
2. The server then calls the **customer** and drops them into the same room.
3. Agent types a number and clicks **Add** → the server calls the **target**.
   For a *warm* transfer the customer is put on hold so the agent can brief the
   target privately first.
4. Agent clicks **Merge everyone** → customer comes off hold, all three talk.
5. Agent clicks **Leave (keep others)** → the agent drops out; customer + target
   keep talking. Or **End all** to hang everyone up.

The existing 1:1 dialer ("Call Now") is unchanged.

## What you need to configure in Telnyx (one-time)

1. **Buy / pick a phone number (DID)** to act as the "door to the room".
2. Create a **Call Control Application** (Telnyx → Voice → Call Control / Programmable Voice):
   - Set its **webhook URL** to: `https://<your-app-host>/api/telnyx/voice`
   - Note its **Connection ID / Application ID**.
3. **Route the conference DID to that Call Control Application** (assign the
   number to the app under the number's Voice settings).
4. Make sure the **WebRTC credential connection** the agents log in with can place
   outbound calls to that DID (it just needs normal outbound voice).

## Environment variables to set

| Variable | What it is |
|---|---|
| `TELNYX_API_KEY` | (already used) your Telnyx API key |
| `TELNYX_FROM_NUMBER` | (already used) caller-ID for the customer/target legs |
| `TELNYX_CONFERENCE_DID` | the DID the browser dials to enter the room, e.g. `+1...` |
| `TELNYX_CALL_CONTROL_CONNECTION_ID` | the Call Control Application's connection id (used to dial customer + target) |

Once those are set and the DID is routed to the Call Control app's
`/api/telnyx/voice` webhook, the **3-Way** button is fully functional.

## Notes / limitations

- Conference room state is kept **in memory** on the server (`conferenceState.ts`).
  This assumes a single server instance. To scale horizontally, move that state to
  a shared store (e.g. Redis).
- The agent leg correlates to its room via a custom SIP header `X-Conf-Token`
  passed by the browser, so no phone numbers travel in headers.
