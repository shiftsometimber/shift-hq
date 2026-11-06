#!/usr/bin/env python3
"""D1 export/import recovery drill on an unbound, disposable synthetic copy.

The source is read only. This does not restore an application service, change a
Worker binding, measure live RPO, or certify proposed RPO/RTO targets.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import time
import uuid

APPROVED_SOURCE_ID = "3a891880-ea14-4a57-a02e-7f6f3de7f785"
SOURCE_NAME = "sstrx-functional-v3-qa-db"
COPY_PREFIX = "sstrx-qa-restore-"


def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def validate_config(config):
    variables = config.get("vars", {})
    databases = config.get("d1_databases", [])
    if (variables.get("SSTRX_ENVIRONMENT") != "synthetic"
            or variables.get("SSTRX_QA_STACK") != "joined-v31"
            or variables.get("SSTRX_QA_DATABASE_ID") != APPROVED_SOURCE_ID
            or len(databases) != 1
            or databases[0].get("database_id") != APPROVED_SOURCE_ID
            or databases[0].get("database_name") != SOURCE_NAME
            or config.get("name") != "sstrx-functional-v3-qa-core"):
        raise ValueError("Exact approved isolated QA source configuration required")


def quote_identifier(name):
    return '"' + name.replace('"', '""') + '"'


def cell(value):
    if isinstance(value, bytes):
        return {"type": "blob", "hex": value.hex()}
    return {"type": type(value).__name__, "value": value}


def fingerprint(sql_text):
    """Compare complete application rows and schema; disclose FK failures."""
    db = sqlite3.connect(":memory:")
    try:
        db.execute("PRAGMA foreign_keys=OFF")
        db.executescript(sql_text)
        tables = {}
        names = [r[0] for r in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name")]
        for name in names:
            identifier = quote_identifier(name)
            columns = [list(r) for r in db.execute("PRAGMA table_info(" + identifier + ")")]
            payloads = sorted(json.dumps([cell(v) for v in row], sort_keys=True,
                                        separators=(",", ":"), ensure_ascii=False)
                              for row in db.execute("SELECT * FROM " + identifier))
            schema = [list(r) for r in db.execute(
                "SELECT type,name,sql FROM sqlite_master WHERE tbl_name=? "
                "AND sql IS NOT NULL ORDER BY type,name", (name,))]
            tables[name] = {"rows": len(payloads), "columns": columns,
                            "schemaDigest": sha(json.dumps(schema, sort_keys=True).encode()),
                            "rowsDigest": sha("\n".join(payloads).encode())}
        violations = [list(r) for r in db.execute("PRAGMA foreign_key_check")]
        marker = db.execute(
            "SELECT environment,database_id,synthetic_only FROM sstrx_qa_environment"
        ).fetchall()
        if marker != [("joined-v31", APPROVED_SOURCE_ID, 1)]:
            raise ValueError("Export is not the approved synthetic database")
        return {"tables": tables, "tableCount": len(tables),
                "rowCount": sum(t["rows"] for t in tables.values()),
                "foreignKeyViolations": violations,
                "digest": sha(json.dumps(tables, sort_keys=True).encode()),
                "excludedProviderInternals": ["sqlite_*", "_cf_*"],
                "sourceMarkerVerified": True}
    finally:
        db.close()


def extract_database_id(output):
    match = re.search(r'"database_id"\s*:\s*"([a-f0-9-]{36})"', output)
    if not match:
        match = re.search(r'database_id\s*=\s*"([a-f0-9-]{36})"', output)
    if not match or match.group(1) == APPROVED_SOURCE_ID:
        raise RuntimeError("Created copy identity unconfirmed; do not replay create")
    return match.group(1)


class Drill:
    def __init__(self, args):
        self.args = args
        self.output = Path(args.output).resolve()
        self.output.mkdir(parents=True, exist_ok=False)
        os.chmod(self.output, 0o700)
        self.record = {"kind": "ACTUAL_REMOTE_D1_EXPORT_IMPORT_DRILL",
                       "startedAt": utc(), "sourceCommit": args.source_commit,
                       "sourceDeployments": json.loads(Path(args.deployments).read_text()),
                       "sourceDatabaseId": APPROVED_SOURCE_ID,
                       "copyName": COPY_PREFIX + uuid.uuid4().hex[:16],
                       "copyDatabaseId": None, "steps": [], "result": "INCOMPLETE",
                       "sourceWrites": 0, "workerBindingsChanged": 0,
                       "externalMessages": 0, "realTransactions": 0,
                       "rpoSeconds": None, "signedTargetsQualified": False,
                       "limitations": ["Unbound copy; no application traffic failover",
                                       "No R2 object restoration or consumer replay certification",
                                       "Actual RPO and agreed RPO/RTO targets remain unqualified"]}
        self.save()

    def save(self):
        destination = self.output / "receipt.json"
        temporary = self.output / "receipt.tmp"
        temporary.write_text(json.dumps(self.record, indent=2) + "\n")
        temporary.replace(destination)

    def command(self, name, arguments, config=None, timeout=90):
        started = time.monotonic()
        command = [self.args.node, self.args.wrangler, *arguments]
        if config:
            command.extend(["--config", str(config)])
        environment = {**os.environ, "WRANGLER_SEND_METRICS": "false", "NO_COLOR": "1"}
        process = subprocess.run(command, capture_output=True, text=True,
                                 timeout=timeout, env=environment)
        (self.output / (name + ".stdout")).write_text(process.stdout)
        (self.output / (name + ".stderr")).write_text(process.stderr)
        self.record["steps"].append({"name": name, "at": utc(),
                                    "seconds": round(time.monotonic() - started, 3),
                                    "exit": process.returncode,
                                    "stdoutDigest": sha(process.stdout.encode())})
        self.save()
        print(json.dumps({"step": name, "exit": process.returncode}), flush=True)
        if process.returncode:
            raise RuntimeError(name + " failed; retained private CLI output")
        return process.stdout

    def run(self):
        config = Path(self.args.config).resolve()
        validate_config(json.loads(config.read_text()))
        self.record["sourceConfigDigest"] = sha(config.read_bytes())
        marker = self.command("source-marker", ["d1", "execute", SOURCE_NAME,
            "--remote", "--json", "--command",
            "SELECT environment,database_id,synthetic_only FROM sstrx_qa_environment"], config)
        data = json.loads(marker)
        marker_rows = [r for result in data for r in result.get("results", [])]
        if marker_rows != [{"environment": "joined-v31", "database_id": APPROVED_SOURCE_ID,
                            "synthetic_only": 1}]:
            raise RuntimeError("Remote synthetic marker mismatch")
        source_sql = self.output / "source.sql"
        self.command("source-export", ["d1", "export", SOURCE_NAME, "--remote",
                     "--output", str(source_sql), "--skip-confirmation"], config)
        original = fingerprint(source_sql.read_text())
        self.record["snapshotCompletedAt"] = utc()
        self.record["sourceSqlDigest"] = sha(source_sql.read_bytes())
        self.record["expected"] = original
        self.save()
        created = self.command("create-copy", ["d1", "create", self.record["copyName"],
                               "--location", "weur", "--update-config=false"], config)
        copy_id = extract_database_id(created)
        self.record["copyDatabaseId"] = copy_id
        copy_config = self.output / "copy.json"
        copy_config.write_text(json.dumps({"name": "sstrx-qa-restore-evidence",
            "compatibility_date": "2026-10-01", "account_id": self.args.account_id,
            "d1_databases": [{"binding": "RESTORE_COPY", "database_name": self.record["copyName"],
                              "database_id": copy_id}]}, indent=2))
        self.save()
        recovery_started = time.monotonic()
        try:
            self.command("restore-import", ["d1", "execute", self.record["copyName"],
                         "--remote", "--file", str(source_sql), "--yes"], copy_config, 180)
            restored_sql = self.output / "restored.sql"
            self.command("restored-export", ["d1", "export", self.record["copyName"],
                         "--remote", "--output", str(restored_sql), "--skip-confirmation"], copy_config)
            actual = fingerprint(restored_sql.read_text())
            self.record["actual"] = actual
            self.record["restoredSqlDigest"] = sha(restored_sql.read_bytes())
            self.record["recoveryAndVerificationSeconds"] = round(time.monotonic() - recovery_started, 3)
            self.record["completeRowsAndSchemaMatch"] = original == actual
            self.record["foreignKeyIntegrityPassed"] = not actual["foreignKeyViolations"]
            if original != actual:
                raise RuntimeError("Restored application schema or row digest mismatch")
            if actual["foreignKeyViolations"]:
                raise RuntimeError("Source and copy share pre-existing foreign key violations")
            self.record["result"] = "PASS_REMOTE_D1_COPY_RESTORE_ONLY"
        finally:
            # Only the exact disposable identity created by this invocation is deleted.
            if (self.record["copyName"].startswith(COPY_PREFIX)
                    and self.record["copyDatabaseId"] == copy_id
                    and copy_id != APPROVED_SOURCE_ID):
                self.command("delete-owned-copy", ["d1", "delete", self.record["copyName"],
                             "--skip-confirmation"], copy_config)
                self.record["copyDeleted"] = True
                self.save()
        self.record["completedAt"] = utc()
        self.save()
        print(json.dumps({k: self.record[k] for k in ["result", "sourceCommit", "copyDatabaseId",
              "completeRowsAndSchemaMatch", "foreignKeyIntegrityPassed", "recoveryAndVerificationSeconds",
              "copyDeleted"]}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["config", "output", "node", "wrangler", "source-commit", "deployments", "account-id"]:
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    if not args.execute:
        parser.error("--execute required for the isolated recovery drill")
    if not re.fullmatch(r"[a-f0-9]{40}", args.source_commit):
        parser.error("Exact tested source commit required")
    drill = Drill(args)
    try:
        drill.run()
    except Exception as error:
        drill.record.update(result="FAIL", error=str(error), completedAt=utc())
        drill.save()
        raise


if __name__ == "__main__":
    main()
