"""Create isolated release backup fixtures; never reads or changes the production profile."""
import hashlib
import json
import sqlite3
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "artifacts" / "phase6"
OUTPUT.mkdir(parents=True, exist_ok=True)
OLD_DB = OUTPUT / "old-phase4.db"
assert not OLD_DB.exists(), "Fixture already exists; use a new isolated profile"
snapshot = json.loads((OUTPUT / "migration-metadata.json").read_text(encoding="utf-8"))
assert snapshot["identifier"] == "com.rumo.validation.phase6"
schema_sql = snapshot["schemaSql"]
metadata = [
    (row["version"], row["description"], row["installed_on"], row["success"], bytes.fromhex(row["checksum"]), row["execution_time"])
    for row in snapshot["rows"] if row["version"] <= 5
]
assert len(metadata) == 5

with sqlite3.connect(OLD_DB) as old:
    old.execute("PRAGMA foreign_keys=ON")
    for version in range(1, 6):
        migration = next((ROOT / "src-tauri" / "migrations").glob(f"{version:04d}_*.sql"))
        old.executescript(migration.read_text(encoding="utf-8"))
    old.execute(schema_sql)
    old.executemany(
        "INSERT INTO _sqlx_migrations(version,description,installed_on,success,checksum,execution_time) "
        "VALUES(?,?,?,?,?,?)", metadata
    )
    old.execute("UPDATE settings SET value='Backup da Fase 4' WHERE key='name'")
    stamp = "2026-09-27T12:00:00Z"
    old.execute("INSERT INTO tasks(id,title,created_at,updated_at) VALUES('old-task','Tarefa da Fase 4',?,?)", (stamp, stamp))
    old.execute("INSERT INTO projects(id,name,created_at,updated_at) VALUES('old-project','Projeto da Fase 4',?,?)", (stamp, stamp))
    old.execute("INSERT INTO thoughts(id,title,content,created_at,updated_at) VALUES('old-thought','Pensamento antigo','Conteúdo preservado',?,?)", (stamp, stamp))
    old.execute("INSERT INTO workout_plans(id,name,created_at,updated_at) VALUES('old-plan','Plano antigo',?,?)", (stamp, stamp))
    old.execute("INSERT INTO meals(id,name,created_at,updated_at) VALUES('old-meal','Refeição antiga',?,?)", (stamp, stamp))
    assert old.execute("PRAGMA integrity_check").fetchone()[0] == "ok"

database = OLD_DB.read_bytes()
manifest = {
    "app": "RUMO",
    "appVersion": "0.1.0",
    "schemaVersion": 5,
    "createdAt": str(int(time.time())),
    "database": "rumo.db",
    "sha256": hashlib.sha256(database).hexdigest(),
    "kind": "manual",
}


def archive(name, files):
    path = OUTPUT / name
    assert not path.exists(), f"Fixture already exists: {path}"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as result:
        for filename, content in files:
            result.writestr(filename, content)
    return path


def encode(value):
    return json.dumps(value, ensure_ascii=False).encode("utf-8")


valid = archive("old-phase4.zip", [("manifest.json", encode(manifest)), ("rumo.db", database)])
archive("missing-manifest.zip", [("rumo.db", database)])
archive("missing-database.zip", [("manifest.json", encode(manifest))])
archive("corrupt-database.zip", [("manifest.json", encode({**manifest, "sha256": hashlib.sha256(b"not sqlite").hexdigest()})), ("rumo.db", b"not sqlite")])
archive("wrong-hash.zip", [("manifest.json", encode({**manifest, "sha256": "0" * 64})), ("rumo.db", database)])
archive("future-schema.zip", [("manifest.json", encode({**manifest, "schemaVersion": 10})), ("rumo.db", database)])
archive("zip-slip.zip", [("manifest.json", encode(manifest)), ("../rumo.db", database)])
archive("extra-path.zip", [("manifest.json", encode(manifest)), ("rumo.db", database), ("../../other.txt", b"bad")])
(OUTPUT / "renamed-random.zip").write_bytes(b"arbitrary content")
print(valid)
