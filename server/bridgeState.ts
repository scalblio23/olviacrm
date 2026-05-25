/**
 * Shared in-memory state for the two-leg call bridge.
 *
 * Flow:
 *   1. Agent clicks Call → routers.ts dials AGENT_NUMBER, stores agentCCID → leadNumber here
 *   2. Agent answers  → webhook reads pendingBridges, dials lead, stores leadCCID → agentCCID
 *   3. Lead answers   → webhook reads activeBridges, calls bridge(leadCCID, agentCCID)
 */

// agentCallControlId → leadNumber (waiting for agent to answer)
export const pendingBridges = new Map<string, string>();

// leadCallControlId → agentCallControlId (waiting for lead to answer)
export const activeBridges = new Map<string, string>();
