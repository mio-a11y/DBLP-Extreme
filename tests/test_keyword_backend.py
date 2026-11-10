"""Regression test against the compiled engine, with isolated tiny XML/indexes."""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class KeywordBackendTest(unittest.TestCase):
    def test_suggestions_sorting_and_pagination(self):
        exe = Path(os.environ.get('DBLP_TEST_EXE', ROOT / 'build' / ('dblp_extreme.exe' if os.name == 'nt' else 'dblp_extreme')))
        self.assertTrue(exe.is_file(), 'Build the backend first: python scripts/build_backend.py')
        with tempfile.TemporaryDirectory(prefix='dblp-keyword-test-') as directory:
            records = []
            for i in range(24):
                title = 'Neural retrieval methods' if i == 0 else ('Neural networks' if i < 12 else 'Retrieval systems')
                records.append(f'<article key="test/{i}"><author>Test Author {i}</author><title>{title}</title><year>{2000+i}</year><journal>Test</journal></article>')
            Path(directory, 'dblp.xml').write_text('<?xml version="1.0"?><dblp>' + ''.join(records) + '</dblp>', encoding='utf-8')
            commands = 'SUGGEST neur\nBM25 neural retrieval fuzzy:off page:1 size:10\nBM25 neural retrieval fuzzy:off sort:newest page:1 size:10\nBM25 neural retrieval fuzzy:off sort:newest page:2 size:10\nQUIT\n'
            result = subprocess.run([str(exe.resolve()), '--serve', '--rebuild', 'dblp.xml'], cwd=directory, input=commands, text=True, encoding='utf-8', errors='replace', capture_output=True, timeout=45)
            self.assertEqual(result.returncode, 0, result.stderr)
            output = result.stdout.split('[SERVE] Ready', 1)[1].split('END')
            self.assertIn('neural', output[0])
            self.assertNotIn('ERROR', output[0])
            def docs(block):
                return [line.split('\t') for line in block.splitlines() if line.startswith('DOC\t')]
            relevant, newest, second = map(docs, output[1:4])
            self.assertEqual(len(newest), 10)
            self.assertEqual([int(row[3]) for row in newest], list(range(2023, 2013, -1)))
            self.assertNotEqual(relevant[0][1], newest[0][1])
            self.assertIn('BM25META\t24\t2\t10', output[3])
            self.assertIn('sort:newest', output[2])
            self.assertTrue(set(row[1] for row in newest).isdisjoint(row[1] for row in second))
            self.assertGreaterEqual(int(newest[-1][3]), int(second[0][3]))

if __name__ == '__main__':
    unittest.main()
