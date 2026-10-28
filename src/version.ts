import pkg from "../package.json";

/** The version in package.json: sent by the update check and compared with the answer. */
export const VERSION: string = pkg.version;

/** True when `a` is a newer semantic version than `b` (numeric parts only; a pre-release suffix is ignored). */
export function isNewer(a: string, b: string): boolean {
  const parts = (v: string) => v.split("-")[0]!.split(".").map((x) => Number(x) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
}
