import { describe, expect, it } from "vitest";
import { applicationJarPath, bdmvRelativePath } from "./disc-path.js";

describe("applicationJarPath", () => {
  it("normalizes separators and adds the requested package prefix", () => {
    expect(applicationJarPath("./apps\\main", "JAR")).toBe("JAR/apps/main.jar");
    expect(applicationJarPath("apps/main.JAR", "BDMV/JAR")).toBe("BDMV/JAR/apps/main.JAR");
  });

  it("rejects absolute and unsafe paths", () => {
    for (const path of ["", "/apps/main", "apps//main", "apps/./main", "apps/../main"]) {
      expect(applicationJarPath(path, "JAR")).toBeNull();
    }
  });
});

describe("bdmvRelativePath", () => {
  it("removes a case-insensitive BDMV root prefix", () => {
    expect(bdmvRelativePath("BDMV/PLAYLIST/00001.mpls")).toBe("PLAYLIST/00001.mpls");
    expect(bdmvRelativePath("bdmv/STREAM/00001.m2ts")).toBe("STREAM/00001.m2ts");
  });

  it("preserves paths without the root prefix", () => {
    expect(bdmvRelativePath("PLAYLIST/00001.mpls")).toBe("PLAYLIST/00001.mpls");
    expect(bdmvRelativePath("BACKUP/PLAYLIST/00001.mpls")).toBe("BACKUP/PLAYLIST/00001.mpls");
  });
});
