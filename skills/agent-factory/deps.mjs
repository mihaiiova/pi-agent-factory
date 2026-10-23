/**
 * deps — compute the pinned `packages` declaration for a generated project.
 *
 * Pure seam: `declareDependencies(piPackages, rev, used) -> string[]`.
 * A generated project is self-contained by declaration, not vendoring: it
 * declares `git:github.com/mihaiiova/pi-config@<rev>` (the shared skills,
 * scripts, and extensions) plus the exact `npm:<name>@<version>` pins it uses
 * from pi-config's own `pi.packages`. Local-path and secret-shaped entries are
 * never emitted.
 */

const GIT_PIN = "git:github.com/mihaiiova/pi-config@";
const LOCAL_PATH_RE = /^(file:|link:|\/|\.\.?\/)/;

function isString(value) {
  return typeof value === "string";
}

/**
 * @param {string[]} [piPackages] pi-config's own `pi.packages` (`npm:<name>@<version>`).
 * @param {string} [rev] the pi-config git revision to pin.
 * @param {string[]} [used] the npm package names the generated project uses.
 * @returns {string[]} the pinned `packages` list (git pin first, then npm pins).
 */
export function declareDependencies(piPackages, rev, used = []) {
  const pins = [];

  if (isString(rev) && rev.length > 0 && !LOCAL_PATH_RE.test(rev)) {
    pins.push(`${GIT_PIN}${rev}`);
  }

  const usedSet = new Set(Array.isArray(used) ? used.filter(isString) : []);
  for (const entry of Array.isArray(piPackages) ? piPackages : []) {
    if (!isString(entry) || LOCAL_PATH_RE.test(entry)) continue;
    if (!entry.startsWith("npm:")) continue;
    const rest = entry.slice(4); // strip "npm:"
    const at = rest.lastIndexOf("@");
    if (at <= 0) continue;
    const name = rest.slice(0, at); // handles scoped names (@scope/pkg)
    const version = rest.slice(at + 1);
    if (!name || !version || LOCAL_PATH_RE.test(version)) continue;
    if (usedSet.has(name)) pins.push(entry);
  }

  return pins;
}
