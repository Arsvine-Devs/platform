import argparse
import json
import os
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from arsvine_ops.data import initialize_environment, provision
from arsvine_ops.data.initialize_environment import seed_files


def postgres_site(site: str, port: int) -> dict[str, object]:
    return {
        "id": site,
        "repository": "example/platform",
        "runtime": "node",
        "productionRef": "main",
        "localServices": ["postgres"],
        "production": {"hostname": f"{site}.example.com", "port": port},
    }


def test_content_requires_a_core_database_in_the_same_environment(tmp_path: Path) -> None:
    registry = tmp_path / "sites.json"
    content = postgres_site("content", 12006)
    content["preview"] = {
        "hostname": "preview-content.example.com",
        "port": 12007,
        "accessAudience": "a" * 64,
    }
    registry.write_text(json.dumps({"sites": [content, postgres_site("api", 12004)]}))
    with pytest.raises(ValueError, match="Content preview requires the same-environment API"):
        provision.registered_slots(registry)


def test_provision_enrolls_content_reader_without_an_independent_database(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    registry = tmp_path / "sites.json"
    registry.write_text(
        json.dumps({"sites": [postgres_site("content", 12006), postgres_site("api", 12004)]})
    )
    monkeypatch.setattr(provision, "CONFIG", tmp_path)
    monkeypatch.setattr(provision.os, "geteuid", lambda: 0, raising=False)
    monkeypatch.setattr(
        provision,
        "psql",
        lambda *args, **kwargs: subprocess.CompletedProcess(args, 0, "127.0.0.1\n", ""),
    )
    owner = provision.role("api", "production")
    reader = provision.role("content", "production")
    credentials = {"postgres": {owner: "api-fixture", reader: "reader-fixture"}, "valkey": {}}
    monkeypatch.setattr(provision, "get_credentials", lambda *args: credentials)
    events: list[tuple[str, ...]] = []

    def setup(identifier: str, password: str):
        events.append((identifier, password))

    def grant(identifier: str, database: str, password: str):
        events.append((identifier, database, password))
        return True

    monkeypatch.setattr(provision, "postgres_setup", setup)
    monkeypatch.setattr(provision, "postgres_content_reader", grant)
    environment = tmp_path / "env/content-production.env"
    environment.parent.mkdir()
    environment.write_text("CONTENT_PUBLISH_TOKEN=fixture-old\n")
    provision.provision(registry)
    assert events == [(owner, "api-fixture"), (reader, owner, "reader-fixture")]
    assert environment.read_text().splitlines() == [
        "CONTENT_PUBLISH_TOKEN=fixture-old",
        f"CORE_DATABASE_URL=postgresql://{reader}:reader-fixture@127.0.0.1:5432/{owner}",
    ]


def test_content_reader_scope_plans_and_reconciles_only_the_registered_reader(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    registry = tmp_path / "sites.json"
    cache_user = postgres_site("cache-user", 12002)
    cache_user["localServices"] = ["valkey"]
    registry.write_text(
        json.dumps(
            {"sites": [cache_user, postgres_site("content", 12006), postgres_site("api", 12004)]}
        )
    )
    monkeypatch.setattr(provision, "CONFIG", tmp_path)
    monkeypatch.setattr(provision.os, "geteuid", lambda: 0, raising=False)
    owner = provision.role("api", "production")
    reader = provision.role("content", "production")
    credential_path = tmp_path / "data-credentials.json"
    previous = {"postgres": {owner: "writer"}, "valkey": {"untouched": "cache-credential"}}
    credential_path.write_text(json.dumps(previous))
    env = tmp_path / "env"
    env.mkdir()
    api_env = env / "api-production.env"
    api_env.write_text("CORE_DATABASE_URL=unchanged\n")
    content_env = env / "content-production.env"
    content_env.write_text("UNRELATED_SETTING=kept\n")
    parser = argparse.ArgumentParser()
    provision.add_arguments(parser)
    selection = ["--sites", str(registry), "--content-reader"]
    calls: list[tuple[str, str]] = []

    def unexpected(*args: object, **kwargs: object) -> None:
        pytest.fail("Content reader provisioning touched an unrelated service")

    def reconcile(identifier: str, database: str, password: str) -> bool:
        assert password
        calls.append((identifier, database))
        return True

    monkeypatch.setattr(provision.shutil, "which", unexpected)
    monkeypatch.setattr(provision, "postgres_setup", unexpected)
    monkeypatch.setattr(provision, "apply_valkey", unexpected)
    monkeypatch.setattr(provision, "restore", unexpected)
    monkeypatch.setattr(provision, "postgres_content_reader", reconcile)
    monkeypatch.setattr(
        provision,
        "psql",
        lambda *args, **kwargs: subprocess.CompletedProcess(args, 0, "127.0.0.1\n", ""),
    )
    provision.command(parser.parse_args(selection), parser)
    assert json.loads(capsys.readouterr().out) == {"postgres_readers": {reader: owner}}
    assert calls == []
    assert json.loads(credential_path.read_text()) == previous
    assert content_env.read_text() == "UNRELATED_SETTING=kept\n"

    provision.command(parser.parse_args([*selection, "--apply"]), parser)
    assert calls == [(reader, owner)]
    current = json.loads(credential_path.read_text())
    assert current["valkey"] == previous["valkey"]
    assert current["postgres"][owner] == "writer"
    password = current["postgres"][reader]
    assert content_env.read_text().splitlines() == [
        "UNRELATED_SETTING=kept",
        f"CORE_DATABASE_URL=postgresql://{reader}:{password}@127.0.0.1:5432/{owner}",
    ]
    assert api_env.read_text() == "CORE_DATABASE_URL=unchanged\n"
    assert set(env.iterdir()) == {api_env, content_env}


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
    content = tmp_path / "realm/catalog/current.json"
    content.parent.mkdir(parents=True)
    content.write_text('{"version":"already-active"}', encoding="utf-8")
    contents = {"realm/catalog/current.json": {"version": "initial"}, "missing/catalog.json": {}}
    seed_files(tmp_path, contents, 0, 0)
    seed_files(tmp_path, contents, 0, 0)
    assert content.read_text(encoding="utf-8") == '{"version":"already-active"}'
    assert (tmp_path / "missing/catalog.json").is_file()


@pytest.mark.skipif(os.name != "posix", reason="Uses POSIX catalog ownership")
def test_realm_seed_exposes_only_a_complete_private_catalog(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import pwd

    monkeypatch.setattr(initialize_environment, "STATE", tmp_path)
    monkeypatch.setattr(pwd, "getpwnam", lambda _: SimpleNamespace(pw_gid=os.getgid()))
    (tmp_path / "media/preview/private").mkdir(parents=True)
    initialize_environment.seed_empty("preview")
    private = tmp_path / "media/preview/private/realm/catalog"
    version = json.loads((private / "current.json").read_text())["version"]
    catalog = private / "versions" / version
    assert {item.name for item in catalog.iterdir()} == {
        "audio.json",
        "collections.json",
        "home.json",
        "links.json",
        "static-assets.json",
        "works.json",
    }
    assert not (tmp_path / "media/preview/public").exists()
