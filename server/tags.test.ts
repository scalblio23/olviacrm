import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTag, listTags, deleteTag } from "./db";
import { db } from "./_core/db";
import { tags } from "../drizzle/schema";

describe("tags", () => {
  const createdIds: number[] = [];

  afterAll(async () => {
    // Cleanup
    for (const id of createdIds) {
      await deleteTag(id).catch(() => {});
    }
  });

  it("creates a tag and returns it", async () => {
    const tag = await createTag({ name: "Test Tag", color: "#6366f1" });
    expect(tag).toBeDefined();
    expect(tag.name).toBe("Test Tag");
    expect(tag.color).toBe("#6366f1");
    expect(typeof tag.id).toBe("number");
    createdIds.push(tag.id);
  });

  it("lists tags and includes the created one", async () => {
    const tag = await createTag({ name: "List Test Tag", color: "#22c55e" });
    createdIds.push(tag.id);
    const list = await listTags();
    expect(list.some((t) => t.id === tag.id)).toBe(true);
  });

  it("deletes a tag", async () => {
    const tag = await createTag({ name: "Delete Me", color: "#ef4444" });
    await deleteTag(tag.id);
    const list = await listTags();
    expect(list.some((t) => t.id === tag.id)).toBe(false);
  });
});
