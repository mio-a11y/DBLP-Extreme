"""Rebuild the executable used by server.py without changing datasets or indexes."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]

def main():
    compiler = shutil.which('g++')
    if not compiler:
        raise SystemExit('g++ not found. Install a C++20 compiler and add it to PATH first.')
    target = ROOT / 'build' / ('dblp_extreme.exe' if os.name == 'nt' else 'dblp_extreme')
    target.parent.mkdir(exist_ok=True)
    sources = ['src/main.cpp', 'src/ExtremeEngine.cpp', 'src/ExtremeParser.cpp',
               'src/Analyzer.cpp', 'src/F5Profile.cpp', 'src/QuerySuite.cpp']
    # Keep the default CPU target so releases can run on other cloud nodes.
    # Relative source paths avoid MinGW Makefiles' Windows Unicode-path limitations.
    with tempfile.TemporaryDirectory(prefix='dblp-backend-') as temporary:
        output = Path(temporary) / target.name
        command = [compiler, '-std=c++20', '-O3', '-DNDEBUG', '-pthread', '-I', 'include', *sources]
        if os.name == 'nt':
            command += ['-static', '-static-libgcc', '-static-libstdc++']
        command += ['-o', str(output)]
        subprocess.run(command, cwd=ROOT, check=True)
        try:
            shutil.copy2(output, target)
        except PermissionError:
            raise SystemExit('Stop server.py / dblp_extreme first, then rebuild. The executable is in use.')
    print(f'Built: {target}')
    print('Start the updated service with: python server.py')

if __name__ == '__main__':
    main()
