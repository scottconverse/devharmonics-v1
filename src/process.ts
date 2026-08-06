import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

export interface ProcessRequest {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  stdin?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  /**
   * M-timeout-abort: how long to wait after sending SIGTERM (on timeout or
   * on `signal` aborting) before escalating to SIGKILL. A cooperative
   * process exits promptly on SIGTERM; one that ignores it is force-killed
   * once this grace period elapses, so a timed-out or aborted check is never
   * left running in the background. Defaults to 5s.
   */
  killGraceMs?: number;
  /**
   * R11(b)/round3: how long the Windows `taskkill /T` helper itself gets to
   * report success or failure before it is treated as failed (a hung helper
   * must never be trusted forever). Defaults to 5s. Ignored on POSIX.
   */
  windowsTaskkillDeadlineMs?: number;
  /**
   * Maximum UTF-8 bytes retained independently for stdout and stderr.
   * Older output is discarded while the most recent diagnostic tail remains.
   * Defaults to unbounded capture for backward compatibility.
   */
  maxOutputBytes?: number;
  /** Optional live-output observers. Captured output remains independently bounded. */
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  /**
   * Test-only seam: overrides how the Windows tree-kill helper (`taskkill`)
   * is spawned, so terminate()'s failure/retry/deadline/fallback paths
   * (round-3 finding "Windows taskkill failure path") can be exercised
   * deterministically without depending on a genuinely hanging or
   * genuinely un-killable real process — neither can be produced portably
   * or deterministically in a test environment. Never set by production
   * callers; ignored on non-Windows platforms.
   */
  windowsTaskkillSpawn?: (pid: number) => ChildProcess;
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
  /**
   * R11(c)/round3: true when termination fell back to killing only the
   * direct child (Windows: both taskkill attempts failed/hung; see
   * terminate()'s Windows branch). Full process-tree termination can no
   * longer be guaranteed once that fallback ran — a grandchild taskkill
   * could not reach may still be running in the background. Callers must
   * never report this as a plain, fully-confirmed timeout.
   */
  treeKillUnconfirmed: boolean;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
  /** False when stdout contained bytes that are not a well-formed UTF-8 stream. */
  stdoutUtf8Valid?: boolean;
}

export async function runProcess(request: ProcessRequest): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const stdoutCapture = createOutputCapture();
    const stderrCapture = createOutputCapture();
    const stdoutDecoder = new StringDecoder("utf8");
    const stdoutUtf8Validator = new TextDecoder("utf-8", { fatal: true });
    let stdoutUtf8Valid = true;
    let stdoutFlushed = false;
    let settled = false;
    let timedOut = false;
    // M-timeout-abort: true once we've sent SIGTERM ourselves (from the
    // timeout timer or an aborted `signal`) — guards against sending it
    // twice and gates the SIGKILL escalation below.
    let terminating = false;
    // R11(c)/round3: see ProcessResult.treeKillUnconfirmed.
    let treeKillUnconfirmed = false;
    // round4: on win32, resolves once the taskkill state machine reaches a
    // terminal state (confirmed success, or the flagged direct-child
    // fallback) — see terminate()'s win32 branch. The direct child's own
    // 'close' event can fire independently and BEFORE this concludes (e.g.
    // the child was already exiting on its own while taskkill was still
    // mid-flight); the close handler below awaits this (bounded by a hard
    // cap) instead of publishing treeKillUnconfirmed's not-yet-final value.
    // Stays null on POSIX and in the no-pid win32 branch, where there is
    // nothing async left to wait for.
    let windowsTerminationSettled: Promise<void> | null = null;

    const resolved = resolveCommand(request.command, request.args);
    const maxOutputBytes = request.maxOutputBytes ?? Number.POSITIVE_INFINITY;
    if (
      maxOutputBytes !== Number.POSITIVE_INFINITY &&
      (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1)
    ) {
      reject(new Error("maxOutputBytes must be a positive safe integer"));
      return;
    }
    // The child is NOT spawned with `signal` directly: Node's own
    // signal-kills the process with a single SIGTERM and no escalation. We
    // manage termination ourselves below so a process that ignores SIGTERM
    // is still confirmed dead via SIGKILL before this promise settles.
    // R11b: on POSIX, the child is its own process group leader (detached)
    // so termination below can signal the WHOLE tree via a negative pid
    // (process.kill(-pid, ...)), not just this direct child — a grandchild
    // (e.g. a shell wrapper's real worker) would otherwise survive a
    // SIGTERM/SIGKILL sent only to the direct child. `detached` only
    // affects process-group leadership here; stdio piping is unaffected
    // since stdio is still explicitly piped below. Windows has no POSIX
    // process groups — its tree-kill instead goes through `taskkill /T`.
    const child = spawn(resolved.command, resolved.args, {
      cwd: request.cwd,
      env: request.env ?? process.env,
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      // Set only for the cmd.exe wrapper form, where resolveCommand has
      // already built a correctly quoted command line.
      windowsVerbatimArguments: resolved.verbatim === true,
    });

    const killGraceMs = request.killGraceMs ?? 5_000;
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    let drainTimer: ReturnType<typeof setTimeout> | null = null;

    // SIGTERM now, SIGKILL after killGraceMs if the process is still alive —
    // a timeout or an external abort must always end with the process
    // confirmed dead, never left running because it ignored SIGTERM.
    //
    // On win32, provider CLIs are frequently cmd/shim processes whose real
    // work happens in a GRANDCHILD that inherits the stdio pipes (e.g. a
    // .cmd wrapper that execs node in the foreground). child.kill() only
    // terminates the direct child; the orphaned grandchild keeps the
    // inherited stdout/stderr pipe handles open, so 'close' never fires and
    // this promise never settles. `taskkill /T` kills the whole process
    // tree, so it must run FIRST — while the direct child is still alive
    // for taskkill to enumerate its descendants — rather than after
    // child.kill().
    function terminate(): void {
      if (terminating) return;
      terminating = true;
      if (process.platform === "win32") {
        const pid = child.pid;
        if (typeof pid !== "number") {
          // No pid was ever assigned — nothing to enumerate a tree from.
          // Fall straight back to killing the direct child so 'exit' still
          // fires and this promise doesn't hang forever.
          try {
            child.kill("SIGKILL");
          } catch {
            // already gone
          }
          return;
        }
        // R11a: `spawn("taskkill", ...)` is itself just another child
        // process — a launch failure normally arrives asynchronously as an
        // 'error' event, not a thrown exception. With no listener, that
        // becomes an unhandled EventEmitter error. And even when taskkill
        // does launch, a nonzero exit means the tree was NOT actually torn
        // down (e.g. the pid it targeted was already gone). Either way, we
        // must fall back to killing the direct child so 'exit' (and the
        // drain backstop below) still fires and runProcess always settles —
        // never silently trust that taskkill worked.
        //
        // R11(b)/round3: a launch failure or nonzero exit is retried ONCE
        // (the direct child may still be alive for a second attempt to
        // reach) before falling back — a single transient taskkill failure
        // must not immediately give up on a full tree kill. taskkill also
        // gets its OWN deadline: a helper that launches but never emits
        // 'error' or 'exit' (hung) is treated as failed too, never trusted
        // forever.
        const spawnTaskkill =
          request.windowsTaskkillSpawn ??
          ((targetPid: number) => spawn("taskkill", ["/pid", String(targetPid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }));
        const taskkillDeadlineMs = request.windowsTaskkillDeadlineMs ?? 5_000;

        // round4: created up front so the close handler below can always
        // await it once terminate() has taken the win32 tree-kill path,
        // regardless of which branch (success/retry/fallback) ultimately
        // resolves it.
        let resolveWindowsTermination: (() => void) | null = null;
        windowsTerminationSettled = new Promise<void>((resolve) => {
          resolveWindowsTermination = resolve;
        });

        const fallbackToDirectChild = (): void => {
          // R11(c)/round3: from here on, full tree termination cannot be
          // guaranteed — taskkill's /T tree enumeration needs the target
          // pid to still be alive and reachable, and both attempts above
          // either failed or never confirmed. A grandchild taskkill could
          // not reach may still be running once this fallback fires.
          treeKillUnconfirmed = true;
          try {
            child.kill("SIGKILL");
          } catch {
            // already gone
          }
          // round4: the flag above is now final — safe for the close
          // handler to read.
          resolveWindowsTermination?.();
        };

        const attemptTaskkill = (isRetry: boolean): void => {
          let attemptSettled = false;
          let deadline: ReturnType<typeof setTimeout> | null = null;
          const finish = (succeeded: boolean): void => {
            if (attemptSettled) return;
            attemptSettled = true;
            if (deadline) clearTimeout(deadline);
            if (succeeded) {
              // round4: confirmed tree-kill success — treeKillUnconfirmed
              // stays false, and that's now final, so unblock the close
              // handler if it's waiting on us.
              resolveWindowsTermination?.();
              return;
            }
            if (!isRetry) {
              attemptTaskkill(true);
              return;
            }
            fallbackToDirectChild();
          };
          let killer: ChildProcess;
          try {
            killer = spawnTaskkill(pid);
          } catch {
            finish(false);
            return;
          }
          deadline = setTimeout(() => finish(false), taskkillDeadlineMs);
          killer.on("error", () => finish(false));
          killer.on("exit", (code) => finish(code === 0));
        };
        attemptTaskkill(false);
      } else {
        // R11b: signal the whole process group (negative pid) so a
        // grandchild spawned by the direct child is torn down too, not just
        // the direct child itself. Fall back to child.kill() if the group
        // kill throws (e.g. the group is already gone, or this pid/platform
        // shape doesn't support it).
        const pid = child.pid;
        const killGroup = (signal: NodeJS.Signals): void => {
          if (typeof pid === "number") {
            try {
              process.kill(-pid, signal);
              return;
            } catch {
              // fall through to the direct-child fallback below
            }
          }
          try {
            child.kill(signal);
          } catch {
            // already gone
          }
        };
        killGroup("SIGTERM");
        killTimer = setTimeout(() => {
          killGroup("SIGKILL");
        }, killGraceMs);
      }
    }

    // R11(a)/round3: on POSIX, the direct child exiting does NOT mean the
    // whole process group is dead — a SIGTERM-cooperative direct child can
    // exit promptly while a SIGTERM-ignoring grandchild in the same group
    // survives. `close`/`exit` arriving before killGraceMs elapses used to
    // just cancel the scheduled group SIGKILL (`killTimer`) via
    // cleanupTimers() below, silently letting that grandchild live. Fire an
    // immediate, idempotent group SIGKILL sweep instead — signalling an
    // already-dead group throws ESRCH, swallowed, so a redundant sweep after
    // a genuinely clean tree exit is harmless.
    function sweepGroupKill(): void {
      if (process.platform === "win32") return;
      const pid = child.pid;
      if (typeof pid !== "number") return;
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // ESRCH (group already gone) or any other benign race — nothing to do.
      }
    }

    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, request.timeoutMs);

    const onAbort = () => {
      timedOut = true;
      terminate();
    };
    if (request.signal) {
      if (request.signal.aborted) onAbort();
      else request.signal.addEventListener("abort", onAbort, { once: true });
    }

    function cleanupTimers(): void {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (drainTimer) clearTimeout(drainTimer);
      request.signal?.removeEventListener("abort", onAbort);
    }

    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdoutUtf8Valid) {
        try {
          stdoutUtf8Validator.decode(chunk, { stream: true });
        } catch {
          stdoutUtf8Valid = false;
        }
      }
      const text = stdoutDecoder.write(chunk);
      if (!text) return;
      request.onStdout?.(text);
      appendCapturedTail(stdoutCapture, text, maxOutputBytes);
    });
    child.stderr.on("data", (chunk: string) => {
      request.onStderr?.(chunk);
      appendCapturedTail(stderrCapture, chunk, maxOutputBytes);
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      cleanupTimers();
      if (settled) return;
      settled = true;
      reject(error);
    });

    // Backstop: a tree-kill can still race (a grandchild that double-forked,
    // or a stdio handle duplicated somewhere else), so 'close' is not
    // guaranteed to follow 'exit' promptly even after termination. Once the
    // direct child has exited AND we initiated termination, give the tree
    // kill a short drain window, then force the stdio streams closed so
    // 'close' can fire. The promise still only ever resolves from the
    // 'close' handler below — this only guarantees close can arrive.
    child.on("exit", () => {
      if (!terminating || settled) return;
      // R11(a)/round3: fire the group sweep now, as soon as the direct
      // child is confirmed exited — see sweepGroupKill() above. Doing this
      // here (rather than only relying on the scheduled killTimer) means a
      // SIGTERM-ignoring grandchild is swept even when the direct child
      // exits well before killGraceMs elapses.
      sweepGroupKill();
      drainTimer = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
      }, 1_000);
    });

    // Only 'close' (stdio streams flushed AND the process confirmed exited)
    // settles this promise — including after a SIGKILL escalation — so a
    // caller awaiting a timed-out or aborted check learns the external
    // process is actually dead, not merely that we asked it to stop.
    function finalizeClose(code: number | null): void {
      cleanupTimers();
      if (!settled) {
        if (!stdoutFlushed) {
          stdoutFlushed = true;
          const tail = stdoutDecoder.end();
          if (tail) {
            request.onStdout?.(tail);
            appendCapturedTail(stdoutCapture, tail, maxOutputBytes);
          }
          if (stdoutUtf8Valid) {
            try {
              stdoutUtf8Validator.decode();
            } catch {
              stdoutUtf8Valid = false;
            }
          }
        }
        settled = true;
        resolve({
          stdout: capturedOutput(stdoutCapture),
          stderr: capturedOutput(stderrCapture),
          exitCode: code ?? (timedOut ? 124 : 1),
          durationMs: Date.now() - startedAt,
          timedOut,
          treeKillUnconfirmed,
          stdoutTruncated: stdoutCapture.truncated,
          stderrTruncated: stderrCapture.truncated,
          stdoutUtf8Valid,
        });
      }
    }

    child.on("close", (code) => {
      // round4: on win32, the direct child's 'close' can fire independently
      // of — and BEFORE — the taskkill state machine reaching a terminal
      // state (e.g. the direct child was already exiting on its own while
      // the first taskkill attempt was still mid-flight). Resolving here
      // immediately would publish treeKillUnconfirmed's CURRENT value,
      // which may still flip to true once the fallback runs — false
      // confidence. Wait for windowsTerminationSettled first, bounded by a
      // hard cap (both attempts' deadlines + a margin) so this can never
      // hang unboundedly; if the cap is hit, resolve conservatively with
      // treeKillUnconfirmed: true rather than trust an unconcluded flag.
      // A non-terminating (normal) close is unaffected — it never took the
      // win32 terminate() path, so windowsTerminationSettled is null.
      if (process.platform === "win32" && windowsTerminationSettled) {
        const hardCapMs = 2 * (request.windowsTaskkillDeadlineMs ?? 5_000) + 1_000;
        let raced = false;
        let capTimer: ReturnType<typeof setTimeout> | null = null;
        windowsTerminationSettled.then(() => {
          if (raced) return;
          raced = true;
          if (capTimer) clearTimeout(capTimer);
          finalizeClose(code);
        });
        capTimer = setTimeout(() => {
          if (raced) return;
          raced = true;
          treeKillUnconfirmed = true;
          finalizeClose(code);
        }, hardCapMs);
        return;
      }
      finalizeClose(code);
    });

    child.stdin.on("error", () => {
      // A CLI may close stdin as soon as it has enough input.
    });
    child.stdin.end(request.stdin ?? "");
  });
}

interface OutputCapture {
  chunks: string[];
  byteLengths: number[];
  head: number;
  totalBytes: number;
  truncated: boolean;
}

function createOutputCapture(): OutputCapture {
  return { chunks: [], byteLengths: [], head: 0, totalBytes: 0, truncated: false };
}

function appendCapturedTail(capture: OutputCapture, chunk: string, maxBytes: number): void {
  const chunkBytes = Buffer.byteLength(chunk);
  capture.chunks.push(chunk);
  capture.byteLengths.push(chunkBytes);
  capture.totalBytes += chunkBytes;
  if (maxBytes === Number.POSITIVE_INFINITY || capture.totalBytes <= maxBytes) return;
  capture.truncated = true;

  while (capture.totalBytes > maxBytes && capture.head < capture.chunks.length) {
    const excess = capture.totalBytes - maxBytes;
    const firstBytes = capture.byteLengths[capture.head]!;
    if (firstBytes <= excess) {
      capture.totalBytes -= firstBytes;
      capture.head++;
      continue;
    }
    const retained = utf8Tail(capture.chunks[capture.head]!, firstBytes - excess);
    const retainedBytes = Buffer.byteLength(retained);
    capture.chunks[capture.head] = retained;
    capture.byteLengths[capture.head] = retainedBytes;
    capture.totalBytes = capture.totalBytes - firstBytes + retainedBytes;
  }

  if (capture.head > 1_024 && capture.head * 2 > capture.chunks.length) {
    capture.chunks = capture.chunks.slice(capture.head);
    capture.byteLengths = capture.byteLengths.slice(capture.head);
    capture.head = 0;
  }
}

function capturedOutput(capture: OutputCapture): string {
  return capture.chunks.slice(capture.head).join("");
}

function utf8Tail(value: string, maxBytes: number): string {
  let start = value.length;
  let bytes = 0;
  while (start > 0) {
    const low = value.charCodeAt(start - 1);
    const characterStart =
      low >= 0xdc00 &&
      low <= 0xdfff &&
      start > 1 &&
      value.charCodeAt(start - 2) >= 0xd800 &&
      value.charCodeAt(start - 2) <= 0xdbff
        ? start - 2
        : start - 1;
    const character = value.slice(characterStart, start);
    const characterBytes = Buffer.byteLength(character);
    if (bytes + characterBytes > maxBytes) break;
    bytes += characterBytes;
    start = characterStart;
  }
  return value.slice(start);
}

interface ResolvedCommand {
  command: string;
  args: string[];
  /**
   * True when `args` is already a fully-quoted command line that Node must
   * pass through untouched. Node's own per-argument quoting is wrong for the
   * `cmd.exe /s /c` form — see windowsCommand below.
   */
  verbatim?: boolean;
}

function resolveCommand(command: string, args: string[]): ResolvedCommand {
  if (process.platform !== "win32") return { command, args };

  const explicit = path.isAbsolute(command) || command.includes("\\") || command.includes("/");
  if (explicit) return windowsCommand(command, args);

  const directories = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const directory of directories) {
    for (const extension of [".exe", ".com", ".cmd", ".bat", ".ps1"]) {
      const candidate = path.join(directory.replace(/^"|"$/g, ""), `${command}${extension}`);
      if (existsSync(candidate)) return windowsCommand(candidate, args);
    }
  }
  return { command, args };
}

/**
 * Quote one token for cmd.exe. Empty strings still need quotes or they vanish
 * from the command line entirely.
 */
function quoteForCmd(value: string): string {
  if (value === "") return '""';
  if (!/[\s"&|<>^()%!]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function windowsCommand(command: string, args: string[]): ResolvedCommand {
  const extension = path.extname(command).toLowerCase();
  if (extension === ".ps1") {
    return {
      command: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        command,
        ...args,
      ],
    };
  }
  if (extension === ".cmd" || extension === ".bat") {
    // `/s` strips the FIRST and LAST quote character of everything after `/c`
    // and leaves the middle untouched. Passing the script path and its
    // arguments as separate spawn arguments therefore breaks the moment the
    // path contains a space: Node quotes the path on its own, `/s` strips that
    // very pair, and cmd sees `C:\Program Files\...` as the command
    // `C:\Program`. The default Windows Node install lives in
    // `C:\Program Files\nodejs`, so `npm.cmd` — every npm-based validator —
    // failed with "'C:\Program' is not recognized".
    //
    // The correct form is one already-quoted command line wrapped in an outer
    // pair of quotes for `/s` to strip, passed through verbatim so Node does
    // not re-quote it.
    const line = [command, ...args].map(quoteForCmd).join(" ");
    return {
      command: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", `"${line}"`],
      verbatim: true,
    };
  }
  return { command, args };
}

export function subscriptionEnvironment(provider: "codex" | "claude" | "gemini"): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const remove = (names: string[]) => {
    for (const name of names) delete env[name];
  };

  if (provider === "codex") {
    remove(["OPENAI_API_KEY", "CODEX_API_KEY"]);
  } else if (provider === "claude") {
    remove([
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "CLAUDE_CODE_USE_BEDROCK",
      "CLAUDE_CODE_USE_VERTEX",
      "CLAUDE_CODE_USE_FOUNDRY",
    ]);
  } else {
    remove([
      "GEMINI_API_KEY",
      "GOOGLE_API_KEY",
      "GOOGLE_APPLICATION_CREDENTIALS",
      "GOOGLE_GENAI_USE_VERTEXAI",
    ]);
  }

  return env;
}
