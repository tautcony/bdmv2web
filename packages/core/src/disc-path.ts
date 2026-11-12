/** Resolve a BD-J application or class-path entry to its package-relative JAR path. */
export function applicationJarPath(basePath: string, prefix: string): string | null {
  const normalized = basePath.replaceAll("\\", "/").replace(/^\.\//, "");
  const segments = normalized.split("/");
  if (!normalized || normalized.startsWith("/") || segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  const jarPath = /\.jar$/i.test(normalized) ? normalized : `${normalized}.jar`;
  return `${prefix}/${jarPath}`;
}

/** Remove the optional root directory from a virtual BDMV path. */
export function bdmvRelativePath(path: string): string {
  return path.replace(/^BDMV\//i, "");
}
