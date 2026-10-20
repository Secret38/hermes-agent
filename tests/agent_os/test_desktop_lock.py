"""Real process contention, ownership transfer and recovery after process loss."""

import subprocess
import sys
import threading
import time

from agent_os.desktop_lock import InteractiveDesktopLock


def test_reservation_excludes_another_process_and_releases_from_worker(tmp_path):
    path = tmp_path / "desktop.lock"
    lock = InteractiveDesktopLock(path)
    assert lock.acquire()
    assert not InteractiveDesktopLock(path).acquire()
    code = (
        "from pathlib import Path; from agent_os.desktop_lock import InteractiveDesktopLock; "
        "import sys; lock=InteractiveDesktopLock(Path(sys.argv[1])); "
        "acquired=lock.acquire(); print(acquired); "
        "lock.release() if acquired else None"
    )
    result = subprocess.run([sys.executable, "-c", code, str(path)],
                            check=True, capture_output=True, text=True, timeout=15)
    assert result.stdout.strip() == "False"
    worker = threading.Thread(target=lock.release)
    worker.start()
    worker.join(timeout=10)
    assert not worker.is_alive()
    result = subprocess.run([sys.executable, "-c", code, str(path)],
                            check=True, capture_output=True, text=True, timeout=15)
    assert result.stdout.strip() == "True"


def test_process_loss_releases_os_reservation(tmp_path):
    path = tmp_path / "desktop.lock"
    ready = tmp_path / "ready"
    code = (
        "from pathlib import Path; from agent_os.desktop_lock import InteractiveDesktopLock; "
        "import os,sys,time; lock=InteractiveDesktopLock(Path(sys.argv[1])); "
        "assert lock.acquire(); ready=Path(sys.argv[2]); staged=ready.with_suffix('.tmp'); "
        "staged.write_text(str(os.getpid())); staged.replace(ready); time.sleep(60)"
    )
    # On Windows a venv executable can be a launcher with a separate Python
    # child. Terminating that launcher does not terminate the lock owner.
    process = subprocess.Popen([sys._base_executable, "-c", code, str(path), str(ready)])
    try:
        deadline = time.monotonic() + 15
        while not ready.exists() and process.poll() is None and time.monotonic() < deadline:
            time.sleep(0.02)
        assert ready.exists(), "holder did not acquire the reservation"
        assert int(ready.read_text()) == process.pid, "must terminate the actual lock owner"
        lock = InteractiveDesktopLock(path)
        assert not lock.acquire()
        process.terminate()
        process.wait(timeout=10)
        # OS handle cleanup can finish after process termination is signalled.
        deadline = time.monotonic() + 10
        acquired = lock.acquire()
        while not acquired and time.monotonic() < deadline:
            time.sleep(0.02)
            acquired = lock.acquire()
        assert acquired, "reservation remained held after its owner exited"
        lock.release()
    finally:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=10)
