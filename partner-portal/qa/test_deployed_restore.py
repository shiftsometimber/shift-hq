import unittest
from deployed_restore import APPROVED_SOURCE_ID, validate_config, fingerprint, extract_database_id, ordered_restore_sql


def snapshot(extra=""):
    return ("CREATE TABLE sstrx_qa_environment(environment TEXT,database_id TEXT,synthetic_only INTEGER);"
            "INSERT INTO sstrx_qa_environment VALUES('joined-v31','" + APPROVED_SOURCE_ID + "',1);"
            "CREATE TABLE orders(id TEXT PRIMARY KEY,member INTEGER,amount INTEGER,body BLOB);"
            "INSERT INTO orders VALUES('A',42,100,X'0011');"
            "INSERT INTO orders VALUES('B',42,200,X'22FF');" + extra)


class RestoreChecks(unittest.TestCase):
    def test_all_rows_are_compared_independent_of_insert_order(self):
        original = snapshot()
        reordered = original.replace("INSERT INTO orders VALUES('A',42,100,X'0011');", "")
        reordered += "INSERT INTO orders VALUES('A',42,100,X'0011');"
        self.assertEqual(fingerprint(original), fingerprint(reordered))

    def test_missing_event_changed_money_and_blob_corruption_are_detected(self):
        original = fingerprint(snapshot())
        for change in ["DELETE FROM orders WHERE id='A';", "UPDATE orders SET amount=0 WHERE id='B';",
                       "UPDATE orders SET body=X'0012' WHERE id='A';"]:
            self.assertNotEqual(original, fingerprint(snapshot(change)))

    def test_schema_change_is_detected(self):
        self.assertNotEqual(fingerprint(snapshot()), fingerprint(snapshot("ALTER TABLE orders ADD COLUMN token TEXT;")))

    def test_wrong_synthetic_marker_is_rejected(self):
        with self.assertRaises(ValueError):
            fingerprint(snapshot().replace("'joined-v31'", "'production'"))

    def test_foreign_key_failure_is_explicit(self):
        data = fingerprint(snapshot("CREATE TABLE events(order_id TEXT REFERENCES orders(id));"
                                    "INSERT INTO events VALUES('MISSING');"))
        self.assertEqual(len(data["foreignKeyViolations"]), 1)

    def test_config_cannot_target_unmarked_or_production_database(self):
        config = {"name": "sstrx-functional-v3-qa-core", "vars": {"SSTRX_ENVIRONMENT": "synthetic",
                  "SSTRX_QA_STACK": "joined-v31", "SSTRX_QA_DATABASE_ID": APPROVED_SOURCE_ID},
                  "d1_databases": [{"database_name": "sstrx-functional-v3-qa-db", "database_id": APPROVED_SOURCE_ID}]}
        validate_config(config)
        config["vars"]["SSTRX_ENVIRONMENT"] = "production"
        with self.assertRaises(ValueError):
            validate_config(config)

    def test_uncertain_create_receipt_never_guesses_source_identity(self):
        for receipt in ['{"database_id":"' + APPROVED_SOURCE_ID + '"}', 'Request timed out']:
            with self.assertRaises(RuntimeError):
                extract_database_id(receipt)

    def test_restore_creates_late_parent_before_any_insert_and_preserves_semicolon(self):
        sql = snapshot("CREATE TABLE child(id TEXT, parent_id TEXT REFERENCES parent(id));"
                       "INSERT INTO child VALUES('semi;colon','P');"
                       "CREATE TABLE parent(id TEXT PRIMARY KEY);INSERT INTO parent VALUES('P');")
        # Native exports use LF-separated complete statements.
        sql = sql.replace(";", ";\n").replace("semi;\ncolon", "semi;colon")
        ordered = ordered_restore_sql(sql)
        self.assertLess(ordered.index("CREATE TABLE parent"), ordered.index("INSERT INTO child"))
        self.assertLess(ordered.index("INSERT INTO parent"), ordered.index("INSERT INTO child"))
        self.assertEqual(fingerprint(sql), fingerprint(ordered))

    def test_trigger_definition_and_saved_history_are_preserved_without_replaying_hook(self):
        sql = snapshot("CREATE TABLE audit(id TEXT);INSERT INTO audit VALUES('saved');"
                       "CREATE TRIGGER protect_audit BEFORE UPDATE ON audit BEGIN "
                       "SELECT RAISE(ABORT,'immutable; audit');END;")
        sql = sql.replace(";", ";\n").replace("immutable;\n audit", "immutable; audit")
        self.assertEqual(fingerprint(sql), fingerprint(ordered_restore_sql(sql)))

    def test_unknown_statement_is_rejected_before_remote_copy_creation(self):
        sql = snapshot().replace(";", ";\n") + "DELETE FROM orders;\n"
        with self.assertRaisesRegex(ValueError, "Unsupported SQL"):
            ordered_restore_sql(sql)

    def test_explicit_autoincrement_watermark_survives_ordering_and_is_compared(self):
        sql = snapshot("CREATE TABLE jobs(id INTEGER PRIMARY KEY AUTOINCREMENT);"
                       "INSERT INTO jobs VALUES(1);DELETE FROM sqlite_sequence;"
                       "INSERT INTO sqlite_sequence VALUES('jobs',200);")
        expected = fingerprint(sql)
        self.assertEqual(expected["autoIncrementSequences"], [["jobs", 200]])
        self.assertEqual(expected, fingerprint(ordered_restore_sql(sql)))
        self.assertNotEqual(expected, fingerprint(sql.replace("'jobs',200", "'jobs',201")))


if __name__ == "__main__":
    unittest.main()
