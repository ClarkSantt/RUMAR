"""Generate release fixtures only from artifacts/phase6/schema8-fixture."""
import hashlib
import json
import time
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
source = root / "artifacts/phase6/schema8-fixture/rumo.db"
output = root / "artifacts/phase6/final-cases"
output.mkdir(parents=True, exist_ok=True)
assert not list(output.iterdir()), "Use a new empty fixture directory"
database = source.read_bytes()
manifest = dict(app="RUMO", appVersion="0.1.0", schemaVersion=8,
                createdAt=str(int(time.time())), database="rumo.db",
                sha256=hashlib.sha256(database).hexdigest(), kind="manual")
encode = lambda value: json.dumps(value).encode("utf-8")

def archive(name, files):
    with zipfile.ZipFile(output / name, "w", zipfile.ZIP_DEFLATED) as result:
        for filename, content in files:
            result.writestr(filename, content)

archive("old-schema8.zip", [("manifest.json", encode(manifest)), ("rumo.db", database)])
archive("missing-manifest.zip", [("rumo.db", database)])
archive("missing-database.zip", [("manifest.json", encode(manifest))])
archive("corrupt-database.zip", [("manifest.json", encode({**manifest, "sha256": hashlib.sha256(b"bad").hexdigest()})), ("rumo.db", b"bad")])
archive("wrong-hash.zip", [("manifest.json", encode({**manifest, "sha256": "0" * 64})), ("rumo.db", database)])
archive("future-schema.zip", [("manifest.json", encode({**manifest, "schemaVersion": 10})), ("rumo.db", database)])
archive("zip-slip.zip", [("manifest.json", encode(manifest)), ("../rumo.db", database)])
archive("extra-path.zip", [("manifest.json", encode(manifest)), ("rumo.db", database), ("../../other.txt", b"bad")])
(output / "renamed-random.zip").write_bytes(b"not a zip")
print(output)
