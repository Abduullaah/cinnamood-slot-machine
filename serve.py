#!/usr/bin/env python3
"""Tiny static server for local preview. Not part of the deployed site."""
import os, sys, functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8777


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *a):
        sys.stderr.write("%s\n" % (fmt % a))


if __name__ == "__main__":
    handler = functools.partial(Handler, directory=ROOT)
    print(f"serving {ROOT} on http://localhost:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), handler).serve_forever()
