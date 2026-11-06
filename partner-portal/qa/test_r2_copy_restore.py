import hashlib
from pathlib import Path
import tempfile
import unittest

from r2_copy_restore import evidence_manifest, verify_bytes, copy_key, validate_delete
from deployed_restore import APPROVED_SOURCE_ID


def backup(key='clinical/fictional/photo.png', size=3, digest=None, marker=APPROVED_SOURCE_ID):
    digest = digest or hashlib.sha256(b'abc').hexdigest()
    return f'''CREATE TABLE sstrx_qa_environment(environment TEXT,database_id TEXT,synthetic_only INTEGER);
INSERT INTO sstrx_qa_environment VALUES('joined-v31','{marker}',1);
CREATE TABLE clinical_member_evidence(object_key TEXT,mime TEXT,size INTEGER,digest TEXT);
INSERT INTO clinical_member_evidence VALUES('{key}','image/png',{size},'{digest}');'''


class SafetyGuards(unittest.TestCase):
    def test_exact_manifest(self):
        self.assertEqual(evidence_manifest(backup())[0]['bytes'], 3)

    def test_marker_mismatch(self):
        with self.assertRaises(ValueError):
            evidence_manifest(backup(marker='different-database'))

    def test_untrusted_keys(self):
        for key in ['../private', '/clinical/file', 'clinical//file', 'restore-probes/old/file', 'clinical/./file', 'clinical/file?x']:
            with self.subTest(key=key), self.assertRaises(ValueError):
                evidence_manifest(backup(key=key))

    def test_bad_digest_and_size(self):
        for args in [{'digest': 'not-a-digest'}, {'size': 0}, {'size': -1}, {'size': 30 * 1024 * 1024}]:
            with self.subTest(args=args), self.assertRaises(ValueError):
                evidence_manifest(backup(**args))

    def test_missing_objects_cannot_pass(self):
        with self.assertRaises(ValueError):
            evidence_manifest(backup().split('INSERT INTO clinical_member_evidence')[0])

    def test_hash_and_size_both_checked(self):
        item = evidence_manifest(backup())[0]
        with tempfile.TemporaryDirectory() as folder:
            p = Path(folder) / 'object'
            p.write_bytes(b'abc');verify_bytes(p, item)
            p.write_bytes(b'abd')
            with self.assertRaises(ValueError):verify_bytes(p, item)
            p.write_bytes(b'abcd')
            with self.assertRaises(ValueError):verify_bytes(p, item)

    def test_cleanup_cannot_delete_original_or_other_run(self):
        run = 'a' * 32
        validate_delete(copy_key(run, 0), run, 0)
        for key in ['clinical/fictional/photo.png', copy_key('b' * 32, 0), copy_key(run, 1)]:
            with self.subTest(key=key), self.assertRaises(ValueError):validate_delete(key, run, 0)

    def test_owned_identity_is_bounded(self):
        for run, index in [('wrong', 0), ('a' * 32, -1), ('a' * 32, 100)]:
            with self.subTest(run=run, index=index), self.assertRaises(ValueError):copy_key(run, index)


if __name__ == '__main__':
    unittest.main()
