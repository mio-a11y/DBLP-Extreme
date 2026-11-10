"""Verify chunk-size/concurrency changes preserve real engine query results."""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class IndexBuildTest(unittest.TestCase):
    def setUp(self):
        self.exe = Path(os.environ.get('DBLP_TEST_EXE', ROOT / 'build' / ('dblp_extreme.exe' if os.name == 'nt' else 'dblp_extreme'))).resolve()
        self.assertTrue(self.exe.is_file(), 'Build the backend first')

    def test_memory_options_do_not_change_index_contents_or_warm_load(self):
        with tempfile.TemporaryDirectory(prefix='dblp-stream-test-') as directory:
            with Path(directory, 'dblp.xml').open('w', encoding='utf-8') as output:
                output.write('<dblp>')
                for i in range(6000):
                    title = 'Neural retrieval study ' + str(i) + ' ' + ('shared research words ' * 9)
                    output.write(f'<article key="test/{i}"><author>Test Author</author><title>{title}</title><year>{2000+i%25}</year><journal>Example</journal><ee>https://example.org/{i}</ee></article>')
                output.write('</dblp>')
            self.assertGreater(Path(directory, 'dblp.xml').stat().st_size, 1024 * 1024)
            commands = 'SUGGEST neur\nAUTHOR Test Author\nBM25 neural fuzzy:off sort:newest page:2 size:10\nQUIT\n'
            previous = None
            for options in [
                ['--rebuild', '--index-chunk-mb=8', '--index-workers=1', '--index-inflight=2'],
                ['--rebuild', '--index-chunk-mb=1', '--index-workers=1', '--index-inflight=1'],
                ['--rebuild', '--index-chunk-mb=1', '--index-workers=2', '--index-inflight=2'],
                [],  # Reuse the saved serving/F5 segments without changing their format.
            ]:
                with self.subTest(options=options):
                    result = subprocess.run([str(self.exe), '--serve', *options, 'dblp.xml'], input=commands, cwd=directory,
                                            text=True, encoding='utf-8', errors='replace', capture_output=True, timeout=60)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    protocol = result.stdout.split('[SERVE] Ready\n', 1)[1]
                    self.assertIn('AUTHOR\t', protocol)
                    self.assertIn('6000', protocol)
                    if previous is not None:
                        self.assertEqual(protocol, previous)
                    previous = protocol

    def test_invalid_limits_fail_before_loading_data(self):
        for option in ['--index-chunk-mb=0', '--index-chunk-mb=65', '--index-workers=-1',
                       '--index-workers=9', '--index-inflight=0', '--index-inflight=17', '--index-chunk-mb=8oops']:
            with self.subTest(option=option):
                result = subprocess.run([str(self.exe), option], capture_output=True, timeout=5)
                self.assertEqual(result.returncode, 2)
                self.assertIn(b'Invalid index option', result.stderr)

if __name__ == '__main__':
    unittest.main()
