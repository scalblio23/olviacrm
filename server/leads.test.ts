import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock DB helpers to avoid needing a real database in tests
vi.mock("./db", () => ({
  createLeadSession: vi.fn().mockResolvedValue("test-session-id"),
  insertLeads: vi.fn().mockResolvedValue(undefined),
  upsertContact: vi.fn().mockResolvedValue({ id: 1 }),
  setContactTags: vi.fn().mockResolvedValue(undefined),
  getLatestLeadSession: vi.fn().mockResolvedValue(null),
  getLeadsBySession: vi.fn().mockResolvedValue([
    {
      id: 1,
      sessionId: "test-session-id",
      name: "Alice Smith",
      phone: "+61400000001",
      company: "Acme Corp",
      extraData: null,
      disposition: "none",
      notes: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]),
  getLeadById: vi.fn().mockResolvedValue({
    id: 1,
    sessionId: "test-session-id",
    name: "Alice Smith",
    phone: "+61400000001",
    company: "Acme Corp",
    extraData: null,
    disposition: "none",
    notes: "",
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  updateLeadDisposition: vi.fn().mockResolvedValue(undefined),
  updateLeadNotes: vi.fn().mockResolvedValue(undefined),
}));

function createCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

describe("leads.upload", () => {
  it("creates a session and returns a sessionId", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.leads.upload({
      fileName: "test.csv",
      rows: [
        { name: "Alice Smith", phone: "+61400000001", company: "Acme Corp" },
        { name: "Bob Jones", phone: "+61400000002" },
      ],
    });
    expect(result).toHaveProperty("sessionId");
    expect(typeof result.sessionId).toBe("string");
    expect(result.sessionId.length).toBeGreaterThan(0);
  });
});

describe("leads.list", () => {
  it("returns leads for a session", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.leads.list({ sessionId: "test-session-id" });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty("phone");
  });
});

describe("leads.get", () => {
  it("returns a single lead by id", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.leads.get({ id: 1 });
    expect(result).toBeDefined();
    expect(result?.name).toBe("Alice Smith");
    expect(result?.phone).toBe("+61400000001");
  });
});

describe("leads.setDisposition", () => {
  it("updates disposition successfully", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.leads.setDisposition({ id: 1, disposition: "answered" });
    expect(result).toEqual({ success: true });
  });

  it("accepts all valid disposition values", async () => {
    const caller = appRouter.createCaller(createCtx());
    const dispositions = ["none", "answered", "no_answer", "callback", "appointment_set"] as const;
    for (const d of dispositions) {
      const result = await caller.leads.setDisposition({ id: 1, disposition: d });
      expect(result).toEqual({ success: true });
    }
  });
});

describe("leads.setNotes", () => {
  it("saves notes for a lead", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.leads.setNotes({ id: 1, notes: "Called twice, interested in product." });
    expect(result).toEqual({ success: true });
  });

  it("accepts empty notes", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.leads.setNotes({ id: 1, notes: "" });
    expect(result).toEqual({ success: true });
  });
});

describe("telnyx.validateCredentials", () => {
  it("returns credential status without exposing values", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.telnyx.validateCredentials();
    expect(result).toHaveProperty("hasApiKey");
    expect(result).toHaveProperty("hasFromNumber");
    expect(result).toHaveProperty("hasConnectionId");
    expect(result).toHaveProperty("fromNumber");
    expect(typeof result.hasApiKey).toBe("boolean");
    expect(typeof result.hasFromNumber).toBe("boolean");
    expect(typeof result.hasConnectionId).toBe("boolean");
    // fromNumber should be the configured number (never expose API key)
    expect(result.fromNumber).toBe(process.env.TELNYX_FROM_NUMBER ?? "+61485825732");
  });
});

describe("auth.logout", () => {
  it("clears the session cookie", async () => {
    const ctx = createCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result).toEqual({ success: true });
  });
});
