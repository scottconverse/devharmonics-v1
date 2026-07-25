import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DeliveryService } from "../dist/src/delivery.js";
import { Ledger } from "../dist/src/ledger.js";

const execFileAsync = promisify(execFile);
const corpusRoot = process.env.CIVICSUITE_ORG_READALL;

if (!corpusRoot) {
  console.error("CIVICSUITE_ORG_READALL must name the local read-only CivicSuite clone directory.");
  process.exit(1);
}

const expectations = [
  ["civic311", "b65d21c7d19aa1b3f458e56333481bb75f6ef584", "0.1.1"],
  ["civicboards", "845e777f432ad512953ed49be994c366b87a6070", "0.1.1"],
  ["civicbudget", "731a6b4802cfd8593a00180c37ca3d76a7236de0", "0.1.2"],
  ["civicclerk", "dae807ec9d1370dd22cf6aba88e4c6fc6b4168d5", "1.0.4"],
  ["civiccode", "05994fe716fa904682ec91b574a35e7cef066aa1", "1.0.8"],
  ["civiccomms", "73be36fdcd3b7d429321fbe8d51cec07a466e16b", "0.1.1"],
  ["civiccontracts", "23bcee99a09e1d58441775f2a03b7dcda870ed21", "0.1.1"],
  ["civiccore", "aca61910a3dd58325d4cfc02da10df90fb6b9efa", "1.2.1"],
  ["civiccourt", "666525cb1e646127a8150894deec1e97fa64912d", "0.1.2"],
  ["civicdata", "5d8378d59bd4e5a7f68d0df48e794c5721d0c8eb", "0.1.2"],
  ["civicelections", "c532f6ceaeba9ed6399e848ce067c50c3789cb74", "0.1.1"],
  ["civicgrants", "5b01d8c6b9c2952591b28f2c5f09039382d4573a", "0.2.0"],
  ["civichr", "7cd481b75f6d97eb3f28c68c78e12940f5879cdd", "0.1.1"],
  ["civicinspect", "02f7912bfb492988d740f303f694d9b782a4a139", "0.2.2"],
  ["civiclegal", "ac511514ed1d52a8e9c1433e757f8a97ddb53f64", "0.1.2"],
  ["civiclibrary", "d7699189707f6dc9b75ad33c5a498d88cb572ab5", "0.1.1"],
  ["civicparks", "7b9b5147c6a265184b713f5bb71f430a81810085", "0.1.1"],
  ["civicpermit", "3d0998ae40930e71094f511471689846abc350f1", "0.2.2"],
  ["civicplan", "252f23cc83638944fadd303955cda11e13bee674", "0.2.2"],
  ["civicprocure", "5836032f396cb901769e9f2ff7a168e30aefb2f6", "0.2.0"],
  ["civicrecords-ai", "538766523ad90ee7553b0ffa75b626d3d4850b17", null, "DEFERRED_P0_2_NESTED_MANIFEST"],
  ["civicsafety", "38038f9cab7857b278250ff41946f4d1777715f1", "0.1.1"],
  ["civicutility", "4342098cfc72d5cbd52326fa9fc5db8ec3fde346", "0.1.1"],
  ["civiczone", "1d37826d909a601eea5a10f4ebce0b31a605f5d0", "0.2.2"],
];

async function git(cwd, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    timeout: 30_000,
    windowsHide: true,
  });
  return stdout.trim();
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "devharmonics-version-corpus-"));
const ledger = new Ledger(path.join(temporaryRoot, "devharmonics.db"));
const delivery = new DeliveryService(ledger);
const failures = [];

try {
  for (const [name, oid, expected, disposition = "AUTHORITATIVE_ROOT_VERSION"] of expectations) {
    const repositoryPath = path.join(path.resolve(corpusRoot), name);
    try {
      const info = await stat(repositoryPath);
      if (!info.isDirectory()) throw new Error("path is not a directory");
      const statusBefore = await git(repositoryPath, ["status", "--porcelain=v1", "--untracked-files=all"]);
      if (statusBefore) throw new Error(`worktree is dirty before verification: ${JSON.stringify(statusBefore)}`);
      await git(repositoryPath, ["cat-file", "-e", `${oid}^{commit}`]);

      const actual = await delivery.declaredVersionAtCommit(repositoryPath, oid);
      if (actual !== expected) {
        throw new Error(`expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
      }

      const statusAfter = await git(repositoryPath, ["status", "--porcelain=v1", "--untracked-files=all"]);
      if (statusAfter) throw new Error(`worktree changed during verification: ${JSON.stringify(statusAfter)}`);
      console.log(`${name} ${oid} ${disposition} ${actual ?? "null"}`);
    } catch (error) {
      failures.push(`${name} ${oid}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} finally {
  ledger.close();
  await rm(temporaryRoot, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`Version-authority corpus failed (${failures.length}/${expectations.length}):\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Version-authority corpus passed: ${expectations.length}/${expectations.length} clean immutable repositories; no corpus writes or network operations.`);
}
