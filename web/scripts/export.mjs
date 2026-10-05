import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { keccak256, toBytes } from "viem";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const json = async (p) => JSON.parse(await readFile(resolve(root, p), "utf8"));
const stable = (x) =>
  Array.isArray(x)
    ? x.map(stable)
    : x && typeof x === "object"
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, stable(x[k])]),
        )
      : x;
const canonical = (x) => JSON.stringify(stable(x));
const handoff = await json("web/deployment/handoff.json");
const net = await json("web/deployment/network.json");
// Pinned inputs are removed at submission; when present, also validate our preserved records.
for (const [path, record] of [
  [".imd/reads/deployment.json", handoff],
  [".imd/reads/network.json", net],
]) {
  try {
    if (canonical(await json(path)) !== canonical(record))
      throw Error(`Pinned input mismatch: ${path}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const check = process.argv.includes("--check");
const contracts = [];
for (const { name, address, abiHash } of handoff.contracts) {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) throw Error("Invalid contract name");
  const path = `docs/abi/${name}.json`;
  const pinned = JSON.parse(
    execFileSync("git", ["show", `${handoff.sourceCommit}:${path}`], {
      cwd: root,
      encoding: "utf8",
    }),
  );
  const abi = await json(path);
  if (!Array.isArray(abi) || canonical(abi) !== canonical(pinned))
    throw Error("ABI differs from pinned source");
  const hash = keccak256(toBytes(canonical(abi))).slice(2);
  if (hash !== abiHash) throw Error(`ABI hash mismatch: ${hash} != ${abiHash}`);
  const abiPath = `abi/${name}.json`;
  if (!check) {
    await mkdir(resolve(root, "dist/abi"), { recursive: true });
    await writeFile(
      resolve(root, "dist", abiPath),
      JSON.stringify(abi, null, 2) + "\n",
    );
  } else if (canonical(await json(`dist/${abiPath}`)) !== canonical(abi))
    throw Error("Exported ABI changed");
  contracts.push({ name, address, abiHash, abiPath });
}
async function walk(dir, prefix = "") {
  const result = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = prefix + ent.name;
    if (ent.isSymbolicLink()) throw Error("Symlink in export");
    if (ent.isDirectory())
      result.push(...(await walk(resolve(dir, ent.name), p + "/")));
    else if (p !== "imd-deployment.json") result.push(p);
  }
  return result.sort();
}
const assets = [];
let bytes = 0;
for (const path of await walk(resolve(root, "dist"))) {
  const data = await readFile(resolve(root, "dist", path));
  bytes += data.length;
  if (data.length > 8388608) throw Error("Oversized asset");
  assets.push({
    path,
    sha256: createHash("sha256").update(data).digest("hex"),
  });
}
if (
  assets.length > 128 ||
  bytes > 24 * 1024 * 1024 ||
  !assets.some((a) => a.path === "index.html")
)
  throw Error("Export limits exceeded or missing entrypoint");
const { launchId, chainId, sourceCommit, attestationHash, poolKey } = handoff;
if (net.network.chainId !== chainId) throw Error("Network mismatch");
const expected = {
  version: 1,
  launchId,
  chainId,
  sourceCommit,
  attestationHash,
  contracts,
  assets,
  ...(poolKey ? { poolKey } : {}),
  ...net,
};
if (check) {
  if (canonical(await json("dist/imd-deployment.json")) !== canonical(expected))
    throw Error("Manifest mismatch");
} else
  await writeFile(
    resolve(root, "dist/imd-deployment.json"),
    JSON.stringify(expected, null, 2) + "\n",
  );
console.log(
  `${check ? "Verified" : "Exported"} ${contracts.length} pinned ABI(s), ${assets.length} assets, ${bytes} bytes. All ABI and SHA-256 hashes match.`,
);
