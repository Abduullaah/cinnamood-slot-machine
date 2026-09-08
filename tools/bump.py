#!/usr/bin/env python3
"""Stamp every asset URL with one build number.

WHY THIS EXISTS
GitHub Pages serves each file with a ten minute browser cache and gives no way
to change that. After a publish, a reload can therefore fetch some files fresh
and take others from the cache — and the machine ends up running half of one
build and half of another. That happened once in testing: new form code calling
a function that only existed in the new lead code, which the page had not got.
It was caught only because the machine logs its own crashes.

A build number in every URL makes a new build a different set of files, so old
and new can never be mixed no matter what any cache decides to keep.
"""
import re, sys, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
sw = root / 'site' / 'sw.js'
idx = root / 'site' / 'index.html'

cur = int(re.search(r"const CACHE = 'cinnamood-v(\d+)';", sw.read_text()).group(1))
new = int(sys.argv[1]) if len(sys.argv) > 1 else cur + 1

s = idx.read_text()
s = re.sub(r'(src="shared/[a-z0-9.]+\.js)(\?v=\d+)?"', rf'\1?v={new}"', s)
s = re.sub(r'(href="shared/base\.css)(\?v=\d+)?"', rf'\1?v={new}"', s)
idx.write_text(s)

s = sw.read_text()
s = re.sub(r"const CACHE = 'cinnamood-v\d+';", f"const CACHE = 'cinnamood-v{new}';", s)
s = re.sub(r"'\./(shared/[a-z0-9./]+\.(?:js|css))(\?v=\d+)?'", rf"'./\1?v={new}'", s)
sw.write_text(s)

print(f'build {cur} -> {new}')
