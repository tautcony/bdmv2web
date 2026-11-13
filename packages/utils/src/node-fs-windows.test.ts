import { beforeEach, describe, expect, it, vi } from "vitest";

// Windows reports ENOENT for a path below a file where POSIX reports ENOTDIR,
// so `fileBytes` inspects the parent to keep the two apart. A real POSIX
// filesystem never reports ENOENT there, so the branch is driven by a stub.
const statMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, stat: statMock };
});

const { fileBytes } = await import("./node-fs.js");

const failure = (code: string) => Object.assign(new Error(code), { code });

describe("fileBytes on a Windows-style filesystem", () => {
  beforeEach(() => statMock.mockReset());

  it("reports ENOTDIR when the parent is a file", async () => {
    statMock.mockRejectedValueOnce(failure("ENOENT"));
    statMock.mockResolvedValueOnce({ isDirectory: () => false });
    await expect(fileBytes("C:\\media\\file.m2ts\\child")).rejects.toMatchObject({ code: "ENOTDIR" });
  });

  it("treats a missing parent as a missing file", async () => {
    statMock.mockRejectedValueOnce(failure("ENOENT"));
    statMock.mockRejectedValueOnce(failure("ENOENT"));
    await expect(fileBytes("C:\\media\\absent\\child")).resolves.toBe(0n);
  });

  it("rethrows an unrelated parent error", async () => {
    statMock.mockRejectedValueOnce(failure("ENOENT"));
    const denied = failure("EACCES");
    statMock.mockRejectedValueOnce(denied);
    await expect(fileBytes("C:\\media\\denied\\child")).rejects.toBe(denied);
  });
});
