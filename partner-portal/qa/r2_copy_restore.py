#!/usr/bin/env python3
"""Verify private synthetic evidence copies without changing application keys."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import time
import uuid

from deployed_restore import APPROVED_SOURCE_ID, fingerprint, sha, utc, validate_config

BUCKET = 'sstrx-functional-v3-qa-files'
PREFIX = 'restore-probes/'


def evidence_manifest(sql_text):
    # The full backup marker and integrity are checked before reading any keys.
    proof = fingerprint(sql_text)
    if proof['foreignKeyViolations']:
        raise ValueError('Backup has foreign key violations')
    db = sqlite3.connect(':memory:')
    try:
        db.executescript(sql_text)
        rows = db.execute('SELECT object_key,mime,size,digest FROM clinical_member_evidence ORDER BY object_key').fetchall()
        if not rows or len(rows) > 100:
            raise ValueError('A bounded non-empty synthetic evidence manifest is required')
        result = []
        for key, mime, size, digest in rows:
            if (not isinstance(key, str) or not re.fullmatch(r'[A-Za-z0-9_./-]{1,512}', key)
                    or key.startswith(('/', PREFIX)) or any(x in ('', '.', '..') for x in key.split('/'))
                    or not isinstance(size, int) or not 0 < size <= 20 * 1024 * 1024
                    or not isinstance(digest, str) or not re.fullmatch('[0-9a-f]{64}', digest)
                    or not isinstance(mime, str) or not re.fullmatch(r'[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+', mime)):
                raise ValueError('Untrusted evidence object metadata')
            result.append({'key': key, 'mime': mime, 'bytes': size, 'sha256': digest})
        if len({r['key'] for r in result}) != len(result):
            raise ValueError('Duplicate evidence keys')
        return result
    finally:
        db.close()


def verify_bytes(path, item):
    data = Path(path).read_bytes()
    if len(data) != item['bytes'] or sha(data) != item['sha256']:
        raise ValueError('Object bytes do not match the retained D1 evidence digest')


def copy_key(run_id, index):
    if not re.fullmatch('[0-9a-f]{32}', run_id) or not isinstance(index, int) or not 0 <= index < 100:
        raise ValueError('Invalid owned probe identity')
    return PREFIX + run_id + '/' + str(index)


def validate_delete(key, run_id, index):
    if key != copy_key(run_id, index):
        raise ValueError('Deletion is limited to this run\'s own exact copy key')


class R2Drill:
    def __init__(self, args):
        self.args = args
        self.out = Path(args.output).resolve()
        self.out.mkdir(exist_ok=False, parents=True)
        os.chmod(self.out, 0o700)
        self.run_id = uuid.uuid4().hex
        self.record = {'kind': 'ACTUAL_PRIVATE_R2_COPY_RESTORE', 'startedAt': utc(),
                       'sourceCommit': args.source_commit, 'sourceDeployments': json.loads(Path(args.deployments).read_text()),
                       'bucket': BUCKET, 'runId': self.run_id, 'result': 'INCOMPLETE', 'objects': [], 'steps': [],
                       'originalKeysWritten': 0, 'workerBindingsChanged': 0, 'realTransactions': 0,
                       'releaseRecoveryQualified': False,
                       'limitations': ['Retained synthetic D1 backup evidence objects only',
                                       'Owned copy keys; no application failover', 'No agreed RPO/RTO or consumer replay qualification']}
        self.save()

    def save(self):
        temp = self.out / 'receipt.tmp'
        temp.write_text(json.dumps(self.record, indent=2) + '\n')
        temp.replace(self.out / 'receipt.json')

    def command(self, name, arguments, absent=False):
        started = time.monotonic()
        command = [self.args.node, self.args.wrangler, *arguments, '--config', self.args.config]
        env = {**os.environ, 'WRANGLER_SEND_METRICS': 'false', 'NO_COLOR': '1'}
        try:
            p = subprocess.run(command, capture_output=True, text=True, env=env, timeout=60)
        except subprocess.TimeoutExpired:
            self.record['steps'].append({'name': name, 'result': 'TIMEOUT_DO_NOT_REPLAY', 'at': utc()})
            self.save()
            raise
        (self.out / (name + '.stdout')).write_text(p.stdout)
        (self.out / (name + '.stderr')).write_text(p.stderr)
        self.record['steps'].append({'name': name, 'exit': p.returncode,
                                    'seconds': round(time.monotonic() - started, 3), 'at': utc()})
        self.save()
        if absent:
            if p.returncode and re.search(r'(?:object|key).*?(?:does not exist|not found)|(?:404|NoSuchKey)', p.stdout + p.stderr, re.I | re.S):
                return p.stdout
            raise RuntimeError('Copy deletion could not be independently verified')
        if p.returncode:
            raise RuntimeError(name + ' failed; private CLI output retained')
        return p.stdout

    def run(self):
        config = json.loads(Path(self.args.config).read_text())
        validate_config(config)
        bindings = config.get('r2_buckets', [])
        if not bindings or any(b.get('bucket_name') != BUCKET for b in bindings):
            raise ValueError('Exact existing synthetic private bucket binding required')
        sql = Path(self.args.backup).read_text()
        backup_receipt = json.loads(Path(self.args.backup_receipt).read_text())
        if backup_receipt.get('sourceSqlDigest') != sha(Path(self.args.backup).read_bytes()) or not backup_receipt.get('sourceDatabaseId') == APPROVED_SOURCE_ID:
            raise ValueError('Retained backup receipt does not match these source bytes')
        manifest = evidence_manifest(sql)
        self.record['backupSqlDigest'] = sha(Path(self.args.backup).read_bytes())
        self.record['backupSourceCommit'] = backup_receipt['sourceCommit']
        self.record['expectedObjects'] = len(manifest)
        marker = json.loads(self.command('source-marker', ['d1', 'execute', 'sstrx-functional-v3-qa-db', '--remote', '--json', '--command', 'SELECT environment,database_id,synthetic_only FROM sstrx_qa_environment']))
        rows = [r for result in marker for r in result.get('results', [])]
        if rows != [{'environment': 'joined-v31', 'database_id': APPROVED_SOURCE_ID, 'synthetic_only': 1}]:
            raise ValueError('Current remote synthetic source marker mismatch')
        self.record['sourceMarkerVerified'] = True
        started = time.monotonic()
        for i, item in enumerate(manifest):
            target = copy_key(self.run_id, i)
            entry = {'keyDigest': sha(item['key'].encode()), 'copyKey': target,
                     'bytes': item['bytes'], 'sha256': item['sha256'], 'copyVerified': False, 'copyDeleted': False}
            self.record['objects'].append(entry)
            original, restored = self.out / ('original-' + str(i)), self.out / ('restored-' + str(i))
            self.command('get-original-' + str(i), ['r2', 'object', 'get', BUCKET + '/' + item['key'], '--remote', '--file', str(original)])
            verify_bytes(original, item)
            attempted = False
            try:
                # Mark before upload: an uncertain timeout still requires cleanup
                # of this owned key; it must never cause a second upload attempt.
                attempted = True
                self.command('put-copy-' + str(i), ['r2', 'object', 'put', BUCKET + '/' + target, '--remote', '--file', str(original), '--content-type', item['mime'], '--force'])
                self.command('get-copy-' + str(i), ['r2', 'object', 'get', BUCKET + '/' + target, '--remote', '--file', str(restored)])
                verify_bytes(restored, item)
                entry['copyVerified'] = True
            finally:
                if attempted:
                    validate_delete(target, self.run_id, i)
                    self.command('delete-copy-' + str(i), ['r2', 'object', 'delete', BUCKET + '/' + target, '--remote', '--force'])
                    self.command('verify-absent-' + str(i), ['r2', 'object', 'get', BUCKET + '/' + target, '--remote', '--file', str(self.out / ('deleted-' + str(i)))], absent=True)
                    entry['copyDeleted'] = True
                    self.save()
            self.save()
            print(json.dumps({'object': i + 1, 'total': len(manifest), 'copyVerified': entry['copyVerified'], 'copyDeleted': entry['copyDeleted']}), flush=True)
        self.record.update({'result': 'PASS_PRIVATE_R2_COPY_RESTORE_ONLY', 'completedAt': utc(),
                            'copyAndVerificationSeconds': round(time.monotonic() - started, 3),
                            'totalBytesVerified': sum(i['bytes'] for i in manifest)})
        self.save()


def main():
    p = argparse.ArgumentParser()
    for name in ['node', 'wrangler', 'config', 'backup', 'backup-receipt', 'deployments', 'source-commit', 'output']:
        p.add_argument('--' + name, required=True)
    drill = R2Drill(p.parse_args())
    try:
        drill.run()
    except Exception as error:
        drill.record.update({'result': 'FAIL_PRIVATE_R2_COPY_RESTORE', 'failedAt': utc(), 'error': str(error)})
        drill.save()
        raise


if __name__ == '__main__':
    main()
