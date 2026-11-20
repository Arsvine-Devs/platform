import subprocess
from pathlib import Path

import pytest

from arsvine_ops.data import provision
from arsvine_ops.data.initialize_environment import seed_files


def test_valkey_configuration_is_retried_until_running(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(provision, "CONFIG", tmp_path)
    monkeypatch.setattr(provision, "VALKEY_UNIT", tmp_path / "test.service")
    starts: list[str] = []

    def run(*args: str) -> subprocess.CompletedProcess[str]:
        action = args[1]
        if action in {"start", "restart"}:
            starts.append(action)
        if starts == ["restart"]:
            raise subprocess.CalledProcessError(1, args)
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(provision, "run", run)
    with pytest.raises(subprocess.CalledProcessError):
        provision.apply_valkey("/bin/valkey-server", "bind 127.0.0.1\n")
    assert (tmp_path / "valkey.conf").is_file()
    assert not (tmp_path / "valkey.applied").exists()
    starts.append("retry")
    provision.apply_valkey("/bin/valkey-server", "bind 127.0.0.1\n")
    assert (tmp_path / "valkey.applied").is_file()
    provision.apply_valkey("/bin/valkey-server", "bind 127.0.0.1\n")
    provision.apply_valkey("/opt/valkey/bin/valkey-server", "bind 127.0.0.1\n")
    assert starts == ["restart", "retry", "restart", "start", "restart"]


def test_seeding_keeps_active_files_and_can_be_retried(tmp_path: Path) -> None:
    content = tmp_path / "realm-content/current.json"
    content.parent.mkdir()
    content.write_text('{"releaseId":"already-active"}', encoding="utf-8")
    contents = {"realm-content/current.json": {"releaseId": "initial"}, "missing/manifest.json": {}}
    seed_files(tmp_path, contents, 0, 0)
    seed_files(tmp_path, contents, 0, 0)
    assert content.read_text(encoding="utf-8") == '{"releaseId":"already-active"}'
    assert (tmp_path / "missing/manifest.json").is_file()
