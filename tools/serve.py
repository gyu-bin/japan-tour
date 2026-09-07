#!/usr/bin/env python3
"""개발용 정적 서버 — 캐시를 끈다.

`python3 -m http.server` 는 캐시 헤더를 안 보내서, 브라우저가 ES 모듈(js/*.js)을
공격적으로 캐시한다. 파일을 고쳐도 옛 코드가 돌아 디버깅을 헛돌게 만든다.

    python3 tools/serve.py [포트]      기본 8080
"""
import functools
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        if '200' not in (args[1] if len(args) > 1 else ''):
            super().log_message(fmt, *args)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    handler = functools.partial(NoCache, directory=ROOT)
    print(f'http://localhost:{port}  (캐시 없음)')
    http.server.ThreadingHTTPServer(('', port), handler).serve_forever()
