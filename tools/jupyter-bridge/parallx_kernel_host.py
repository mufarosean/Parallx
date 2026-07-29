"""parallx_kernel_host.py — owns a Jupyter kernel, speaks JSON lines (M96).

Why this exists at all
----------------------
A Jupyter kernel is driven over ZeroMQ with a multi-part, HMAC-signed wire
protocol. Implementing that in Node would mean a native `zeromq` dependency
(electron-rebuild, per-platform binaries, a whole class of build failures) and
a hand-rolled reimplementation of a protocol that `jupyter_client` already
implements correctly.

So the ZeroMQ side stays in Python, where the reference implementation lives,
and this process translates it to newline-delimited JSON on stdio. Node spawns
it exactly the way it spawns any other workspace script. Same shape as
`tools/docling-bridge`.

Contract
--------
stdin  — one JSON object per line, each a command:
    {"id": "<requestId>", "type": "execute",   "code": "..."}
    {"id": "...",         "type": "complete",  "code": "...", "cursorPos": 4}
    {"id": "...",         "type": "inspect",   "code": "...", "cursorPos": 4}
    {"id": "...",         "type": "interrupt"}
    {"id": "...",         "type": "restart"}
    {"id": "...",         "type": "shutdown"}

stdout — one JSON object per line, each an event. Every event carries
    `requestId` when it belongs to a request, so the front end can route
    output to the cell that asked for it rather than to whichever cell
    happens to be selected:
    {"type": "ready",          "pid": 123, "pythonVersion": "3.13.7"}
    {"type": "status",         "state": "busy"|"idle"|"starting"}
    {"type": "stream",         "requestId": "...", "name": "stdout", "text": "..."}
    {"type": "execute_input",  "requestId": "...", "executionCount": 1}
    {"type": "execute_result", "requestId": "...", "executionCount": 1, "data": {...}}
    {"type": "display_data",   "requestId": "...", "data": {...}}
    {"type": "clear_output",   "requestId": "...", "wait": false}
    {"type": "error",          "requestId": "...", "ename": "...", "evalue": "...",
                               "traceback": ["...", ...]}
    {"type": "reply",          "requestId": "...", "status": "ok"|"error"|"abort", ...}
    {"type": "fatal",          "message": "..."}

Anything written to this process's stderr is diagnostics for the Electron log,
never protocol.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import traceback
from queue import Empty

# ── stdout discipline ────────────────────────────────────────────────────────
#
# stdout IS the protocol channel. If any imported library prints a banner or a
# warning to it, the front end receives a line that is not JSON and the stream
# desynchronises. Claim the real stdout here, before importing anything heavy,
# and redirect sys.stdout to stderr so stray prints are merely logged.

_PROTOCOL_OUT = sys.stdout
sys.stdout = sys.stderr

_write_lock = threading.Lock()


def emit(event: dict) -> None:
    """Write one protocol event. Thread-safe; never raises."""
    try:
        # default=str so an unexpected datetime in a kernel message degrades to
        # a string instead of killing the bridge mid-execution.
        line = json.dumps(event, default=str, ensure_ascii=False)
    except Exception as exc:  # pragma: no cover - defensive
        line = json.dumps({"type": "fatal", "message": f"unserialisable event: {exc}"})
    with _write_lock:
        try:
            _PROTOCOL_OUT.write(line + "\n")
            _PROTOCOL_OUT.flush()
        except Exception:
            # The parent went away. Nothing useful left to do.
            pass


def log(message: str) -> None:
    print(f"[kernel-host] {message}", file=sys.stderr, flush=True)


# ── Imports that may fail ────────────────────────────────────────────────────

try:
    from jupyter_client.kernelspec import KernelSpecManager
    from jupyter_client.manager import KernelManager
except Exception as exc:
    emit({
        "type": "fatal",
        "message": (
            "jupyter_client is not installed in this workspace environment. "
            f"Install 'ipykernel' to enable notebooks. ({exc})"
        ),
        "code": "MISSING_DEPENDENCY",
    })
    sys.exit(1)


# ── Kernel spec ──────────────────────────────────────────────────────────────


def build_kernel_spec_dir(base_dir: str) -> str:
    """Write a kernelspec whose argv is THIS interpreter, and return its parent.

    Deliberately not relying on the `python3` kernelspec that ipykernel's wheel
    installs: that spec's argv starts with a bare `python`, resolved off PATH.
    Correct here by luck (the workspace venv is first on PATH), but it is luck,
    and a wrong resolution would silently execute the user's notebook against a
    different interpreter than the one holding their packages.

    `sys.executable` is unambiguous.
    """
    spec_root = os.path.join(base_dir, "parallx-kernels")
    spec_dir = os.path.join(spec_root, "parallx")
    os.makedirs(spec_dir, exist_ok=True)
    spec = {
        "argv": [sys.executable, "-m", "ipykernel_launcher", "-f", "{connection_file}"],
        "display_name": "Parallx workspace",
        "language": "python",
        # "signal", stated explicitly rather than left to default, because the
        # obvious-looking alternative is wrong and someone will try it.
        #
        # Measured on Windows / ipykernel 7.3.0 / jupyter_client 8.9.1:
        #
        #   mode      CPU-bound loop        blocking time.sleep
        #   signal    interrupted in 0.1s   not interrupted
        #   message   not interrupted       not interrupted
        #
        # "message" looks like the portable choice — it routes interrupt_request
        # over the control channel instead of relying on OS signals — but
        # ipykernel's handler only forwards interrupts to CHILD processes, and
        # on Windows it logs "Interrupt message not supported on Windows" and
        # does nothing. Choosing it makes interrupt fail everywhere instead of
        # only for blocking calls.
        #
        # The residual gap is CPython's, not ours: on Windows a thread blocked
        # in time.sleep() does not wake from interrupt_main(). Jupyter has the
        # same behaviour there. The pane surfaces Restart when an interrupt
        # does not take effect.
        "interrupt_mode": "signal",
        "metadata": {"debugger": False},
    }
    with open(os.path.join(spec_dir, "kernel.json"), "w", encoding="utf-8") as handle:
        json.dump(spec, handle, indent=2)
    return spec_root


# ── Host ─────────────────────────────────────────────────────────────────────


class KernelHost:
    def __init__(self, workspace_root: str, spec_base_dir: str) -> None:
        self._workspace_root = workspace_root
        self._spec_base_dir = spec_base_dir
        self._km: KernelManager | None = None
        self._kc = None
        self._stop = threading.Event()
        self._threads: list[threading.Thread] = []

        # Pump lifetime is SEPARATE from host lifetime, and has to be.
        # `wait_for_ready()` works by sending kernel_info_request and waiting
        # for the reply on the shell channel — but a running pump has already
        # consumed it, so the wait blocks until it times out. Startup avoids
        # this by chance (pumps start after the wait); restart does not.
        # Restarting therefore stops the pumps, waits, and starts fresh ones.
        self._pump_stop = threading.Event()

        # Suppresses the liveness watcher while the kernel is intentionally
        # down. Without it, a restart races the watcher into reporting
        # KERNEL_DIED for a kernel that is merely being replaced.
        self._restarting = False

        # msg_id → requestId. Every iopub message carries the originating
        # msg_id in parent_header, which is the only reliable way to attribute
        # output to a cell — a kernel may still be flushing output from cell 3
        # while cell 4 is already running.
        self._pending: dict[str, str] = {}
        self._pending_lock = threading.Lock()

    # ── Lifecycle ──

    def start(self) -> None:
        spec_root = build_kernel_spec_dir(self._spec_base_dir)
        ksm = KernelSpecManager()
        ksm.kernel_dirs.insert(0, spec_root)

        self._km = KernelManager(kernel_name="parallx", kernel_spec_manager=ksm)
        self._km.start_kernel(cwd=self._workspace_root)
        self._kc = self._km.client()
        self._kc.start_channels()

        try:
            self._kc.wait_for_ready(timeout=60)
        except RuntimeError as exc:
            raise RuntimeError(f"kernel did not become ready: {exc}") from exc

        self._start_pumps()
        self._spawn(self._watch_liveness, "liveness")

        emit({
            "type": "ready",
            "pid": self._km.provisioner.process.pid if getattr(self._km, "provisioner", None) else None,
            "pythonVersion": "%d.%d.%d" % sys.version_info[:3],
            "executable": sys.executable,
        })

    def _spawn(self, target, name: str, *args) -> None:
        thread = threading.Thread(target=target, name=name, args=args, daemon=True)
        thread.start()
        self._threads.append(thread)

    def _start_pumps(self) -> None:
        """Start channel pumps against a fresh stop-event."""
        self._pump_stop = threading.Event()
        # The event is passed in rather than read off self: a lingering thread
        # from a previous generation would otherwise see the NEW event, find it
        # unset, and keep draining channels the new pumps are reading.
        self._spawn(self._pump_iopub, "iopub", self._pump_stop)
        self._spawn(self._pump_shell, "shell", self._pump_stop)

    def _stop_pumps(self) -> None:
        self._pump_stop.set()
        for thread in list(self._threads):
            if thread.name in ("iopub", "shell"):
                thread.join(timeout=3)
                self._threads.remove(thread)

    def shutdown(self) -> None:
        self._stop.set()
        self._pump_stop.set()
        try:
            if self._kc is not None:
                self._kc.stop_channels()
        except Exception:
            pass
        try:
            if self._km is not None:
                self._km.shutdown_kernel(now=True)
        except Exception:
            pass

    # ── Request correlation ──

    def _track(self, msg_id: str, request_id: str) -> None:
        with self._pending_lock:
            self._pending[msg_id] = request_id

    def _resolve(self, msg: dict) -> str | None:
        parent = msg.get("parent_header") or {}
        msg_id = parent.get("msg_id")
        if not msg_id:
            return None
        with self._pending_lock:
            return self._pending.get(msg_id)

    def _forget(self, msg_id: str) -> None:
        with self._pending_lock:
            self._pending.pop(msg_id, None)

    # ── Channel pumps ──

    def _pump_iopub(self, stop_event: threading.Event) -> None:
        while not stop_event.is_set():
            try:
                msg = self._kc.get_iopub_msg(timeout=0.4)
            except Empty:
                continue
            except Exception as exc:
                if not stop_event.is_set():
                    log(f"iopub pump error: {exc}")
                return
            try:
                self._handle_iopub(msg)
            except Exception:
                log("iopub handler failed:\n" + traceback.format_exc())

    def _handle_iopub(self, msg: dict) -> None:
        msg_type = msg.get("msg_type") or msg.get("header", {}).get("msg_type")
        content = msg.get("content") or {}
        request_id = self._resolve(msg)

        if msg_type == "status":
            # Kernel-wide, not per-request: drives the "busy" indicator.
            emit({"type": "status", "state": content.get("execution_state", "unknown")})

        elif msg_type == "stream":
            emit({
                "type": "stream",
                "requestId": request_id,
                "name": content.get("name", "stdout"),
                "text": content.get("text", ""),
            })

        elif msg_type == "execute_input":
            # Arrives before any output, so the cell can show its [n] prompt
            # the moment it starts rather than when it finishes.
            emit({
                "type": "execute_input",
                "requestId": request_id,
                "executionCount": content.get("execution_count"),
            })

        elif msg_type == "execute_result":
            emit({
                "type": "execute_result",
                "requestId": request_id,
                "executionCount": content.get("execution_count"),
                "data": content.get("data", {}),
                "metadata": content.get("metadata", {}),
            })

        elif msg_type == "display_data":
            emit({
                "type": "display_data",
                "requestId": request_id,
                "data": content.get("data", {}),
                "metadata": content.get("metadata", {}),
            })

        elif msg_type == "update_display_data":
            emit({
                "type": "display_data",
                "requestId": request_id,
                "data": content.get("data", {}),
                "metadata": content.get("metadata", {}),
                "update": True,
            })

        elif msg_type == "error":
            emit({
                "type": "error",
                "requestId": request_id,
                "ename": content.get("ename", ""),
                "evalue": content.get("evalue", ""),
                "traceback": content.get("traceback", []),
            })

        elif msg_type == "clear_output":
            emit({
                "type": "clear_output",
                "requestId": request_id,
                "wait": bool(content.get("wait", False)),
            })

    def _pump_shell(self, stop_event: threading.Event) -> None:
        while not stop_event.is_set():
            try:
                msg = self._kc.get_shell_msg(timeout=0.4)
            except Empty:
                continue
            except Exception as exc:
                if not stop_event.is_set():
                    log(f"shell pump error: {exc}")
                return
            try:
                self._handle_shell(msg)
            except Exception:
                log("shell handler failed:\n" + traceback.format_exc())

    def _handle_shell(self, msg: dict) -> None:
        msg_type = msg.get("msg_type") or msg.get("header", {}).get("msg_type")
        content = msg.get("content") or {}
        request_id = self._resolve(msg)
        parent_id = (msg.get("parent_header") or {}).get("msg_id")

        if msg_type == "execute_reply":
            emit({
                "type": "reply",
                "requestId": request_id,
                "of": "execute",
                "status": content.get("status", "ok"),
                "executionCount": content.get("execution_count"),
            })
        elif msg_type == "complete_reply":
            emit({
                "type": "reply",
                "requestId": request_id,
                "of": "complete",
                "status": content.get("status", "ok"),
                "matches": content.get("matches", []),
                "cursorStart": content.get("cursor_start"),
                "cursorEnd": content.get("cursor_end"),
            })
        elif msg_type == "inspect_reply":
            emit({
                "type": "reply",
                "requestId": request_id,
                "of": "inspect",
                "status": content.get("status", "ok"),
                "found": content.get("found", False),
                "data": content.get("data", {}),
            })
        else:
            return

        # The reply is the last message for this request on the shell channel.
        # iopub output for it has already been emitted (the kernel sends idle
        # before the reply), so dropping the correlation here cannot orphan
        # output that is still in flight.
        if parent_id:
            self._forget(parent_id)

    def _watch_liveness(self) -> None:
        """Report a kernel that dies on its own (segfault, OOM, os._exit)."""
        while not self._stop.is_set():
            if self._stop.wait(1.0):
                return
            if self._restarting:
                continue
            try:
                alive = self._km is not None and self._km.is_alive()
            except Exception:
                alive = False
            if not alive:
                emit({
                    "type": "fatal",
                    "code": "KERNEL_DIED",
                    "message": "The kernel stopped unexpectedly. Restart it to keep working.",
                })
                self._stop.set()
                return

    # ── Commands ──

    def handle_command(self, command: dict) -> None:
        request_id = command.get("id") or ""
        kind = command.get("type")

        if kind == "execute":
            # allow_stdin=False is deliberate. With stdin enabled, a stray
            # input() in a cell parks the kernel forever waiting on a channel
            # this front end does not yet answer, and the user's only recourse
            # is killing the process. Raising StdinNotImplementedError instead
            # produces an ordinary traceback in the cell, which is recoverable.
            msg_id = self._kc.execute(
                command.get("code", ""),
                silent=False,
                store_history=True,
                allow_stdin=False,
                stop_on_error=True,
            )
            self._track(msg_id, request_id)

        elif kind == "complete":
            msg_id = self._kc.complete(
                command.get("code", ""),
                command.get("cursorPos", len(command.get("code", ""))),
            )
            self._track(msg_id, request_id)

        elif kind == "inspect":
            msg_id = self._kc.inspect(
                command.get("code", ""),
                command.get("cursorPos", 0),
                detail_level=command.get("detailLevel", 0),
            )
            self._track(msg_id, request_id)

        elif kind == "interrupt":
            self._km.interrupt_kernel()
            emit({"type": "reply", "requestId": request_id, "of": "interrupt", "status": "ok"})

        elif kind == "restart":
            # Correlations belong to the dead kernel; keeping them would
            # attribute the new kernel's output to old cells.
            with self._pending_lock:
                self._pending.clear()

            # Order matters throughout. The pumps must be down before
            # wait_for_ready, or they eat its kernel_info_reply and it blocks
            # until timeout. The _restarting flag must be set before the
            # kernel goes away, or the liveness watcher reports KERNEL_DIED
            # for a kernel that is only being replaced.
            self._restarting = True
            try:
                self._stop_pumps()
                self._km.restart_kernel(now=True)
                self._kc.wait_for_ready(timeout=60)
            finally:
                self._restarting = False
                self._start_pumps()

            emit({"type": "reply", "requestId": request_id, "of": "restart", "status": "ok"})
            emit({"type": "status", "state": "idle"})

        elif kind == "shutdown":
            emit({"type": "reply", "requestId": request_id, "of": "shutdown", "status": "ok"})
            self.shutdown()
            raise SystemExit(0)

        else:
            emit({
                "type": "reply",
                "requestId": request_id,
                "status": "error",
                "message": f"unknown command type: {kind!r}",
            })


def main() -> int:
    workspace_root = os.environ.get("PARALLX_WORKSPACE") or os.getcwd()
    spec_base = os.environ.get("TMPDIR") or os.environ.get("TEMP") or workspace_root

    host = KernelHost(workspace_root, spec_base)
    try:
        host.start()
    except Exception as exc:
        emit({
            "type": "fatal",
            "code": "START_FAILED",
            "message": f"Could not start the kernel: {exc}",
        })
        log(traceback.format_exc())
        return 1

    try:
        for raw in sys.stdin:
            line = raw.strip()
            if not line:
                continue
            try:
                command = json.loads(line)
            except json.JSONDecodeError as exc:
                emit({"type": "fatal", "code": "BAD_COMMAND", "message": f"malformed command: {exc}"})
                continue
            try:
                host.handle_command(command)
            except SystemExit:
                return 0
            except Exception as exc:
                emit({
                    "type": "reply",
                    "requestId": command.get("id"),
                    "status": "error",
                    "message": str(exc),
                })
                log(traceback.format_exc())
    except KeyboardInterrupt:
        pass
    finally:
        host.shutdown()

    return 0


if __name__ == "__main__":
    sys.exit(main())
