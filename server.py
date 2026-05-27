#!/usr/bin/env python3
"""
DBLP Extreme 后端 API 服务器
通过 stdin/stdout 协议驱动 C++ --serve 进程，为前端提供搜索 API
同时提供前端静态文件服务

用法: python server.py [--port 8080]
"""

import http.server
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.parse
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = ROOT_DIR / "frontend"
BUILD_DIR = ROOT_DIR / "build"
EXE_PATH = BUILD_DIR / "dblp_extreme.exe"


class CppBackend:
    """管理与 C++ --serve 进程的通信，线程安全"""

    def __init__(self):
        self._proc: subprocess.Popen | None = None
        self._lock = threading.Lock()
        self._started = False

    def start(self):
        if self._started:
            return
        print("[Backend] 启动 C++ --serve 进程...")
        self._proc = subprocess.Popen(
            [str(EXE_PATH), "--serve"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            cwd=str(BUILD_DIR),
        )
        # 等待 "[SERVE] Ready" 信号
        for line in self._proc.stdout:
            if "[SERVE] Ready" in line:
                break
            # 转发其他启动输出到终端
            if line.strip():
                print(f"  [C++] {line.rstrip()}")
        self._started = True
        print("[Backend] C++ 进程就绪")

    def stop(self):
        if self._proc and self._proc.poll() is None:
            try:
                self._proc.stdin.write("QUIT\n")
                self._proc.stdin.flush()
                self._proc.wait(timeout=5)
            except Exception:
                self._proc.kill()
        self._started = False

    def _send_command(self, cmd: str) -> list[dict]:
        """发送命令，返回解析后的结果列表 [{type, data}, ...]"""
        with self._lock:
            if not self._started or self._proc is None or self._proc.poll() is not None:
                return [{"type": "error", "message": "后端进程未就绪"}]

            try:
                self._proc.stdin.write(cmd + "\n")
                self._proc.stdin.flush()
            except BrokenPipeError:
                return [{"type": "error", "message": "后端进程已退出"}]

            results = []
            for line in self._proc.stdout:
                line = line.rstrip("\n").rstrip("\r")
                if line == "END":
                    break
                if line.startswith("ERROR\t"):
                    msg = line[6:]
                    results.append({"type": "error", "message": msg})
                elif line.startswith("AUTHOR\t"):
                    parts = line.split("\t")
                    results.append({
                        "type": "author_info",
                        "name": parts[1] if len(parts) > 1 else "",
                        "paper_count": int(parts[2]) if len(parts) > 2 else 0,
                    })
                elif line.startswith("FUZZY\t"):
                    parts = line.split("\t")
                    results.append({
                        "type": "fuzzy_info",
                        "query": parts[1] if len(parts) > 1 else "",
                        "matched": parts[2] if len(parts) > 2 else "",
                        "paper_count": int(parts[3]) if len(parts) > 3 else 0,
                    })
                elif line.startswith("EGO\t"):
                    try:
                        ego_data = json.loads(line[4:])
                        results.append({"type": "ego", "data": ego_data})
                    except json.JSONDecodeError:
                        results.append({"type": "error", "message": "EGO JSON 解析失败"})
                elif line.startswith("F6\t"):
                    try:
                        f6_data = json.loads(line[3:])
                        results.append({"type": "f6_clique", "data": f6_data})
                    except json.JSONDecodeError:
                        results.append({"type": "error", "message": "F6 JSON 解析失败"})
                elif line.startswith("BM25META\t"):
                    parts = line.split("\t")
                    meta = {"type": "bm25meta", "total_hits": 0, "page": 1, "page_size": 20}
                    if len(parts) > 1:
                        try:
                            meta["total_hits"] = int(parts[1])
                        except ValueError:
                            pass
                    if len(parts) > 2:
                        try:
                            meta["page"] = int(parts[2])
                        except ValueError:
                            pass
                    if len(parts) > 3:
                        try:
                            meta["page_size"] = int(parts[3])
                        except ValueError:
                            pass
                    # 解析额外 flags
                    for p in parts[4:]:
                        if p.startswith("mode:"):
                            meta["mode"] = p
                        elif p.startswith("fuzzy:"):
                            meta["fuzzy"] = p
                        elif p.startswith("sort:"):
                            meta["sort"] = p
                    results.append(meta)
                elif line.startswith("SUGGEST"):
                    parts = line.split("\t")
                    terms = parts[1:] if len(parts) > 1 else []
                    results.append({"type": "suggest", "terms": terms})
                elif line.startswith("DOC\t"):
                    parts = line.split("\t")
                    if len(parts) >= 7:
                        results.append({
                            "type": "doc",
                            "id": parts[1],
                            "title": parts[2],
                            "year": parts[3],
                            "journal": parts[4],
                            "authors": parts[5],
                            "ee": parts[6],
                        })
                else:
                    # 未知行，跳过（可能是空行或启动输出残留）
                    if line.strip():
                        results.append({"type": "unknown", "raw": line})
            return results

    def search_author(self, query: str) -> dict:
        results = self._send_command(f"AUTHOR {query}")
        docs = [r for r in results if r["type"] == "doc"]
        meta = next((r for r in results if r["type"] in ("author_info", "fuzzy_info")), None)
        return {
            "docs": docs,
            "total": len(docs),
            "meta": meta,
        }

    def search_title(self, query: str) -> dict:
        results = self._send_command(f"TITLE {query}")
        docs = [r for r in results if r["type"] == "doc"]
        return {
            "docs": docs,
            "total": len(docs),
        }

    def search_keyword(self, query: str) -> dict:
        results = self._send_command(f"BM25 {query}")
        docs = [r for r in results if r["type"] == "doc"]
        meta = next((r for r in results if r["type"] == "bm25meta"), None)
        resp = {
            "docs": docs,
            "total": len(docs),
        }
        if meta:
            resp["meta"] = meta
            resp["total"] = meta.get("total_hits", len(docs))
        return resp

    def search_clique(self, order: int) -> dict:
        results = self._send_command(f"CLIQUE {order}")
        f6 = next((r for r in results if r["type"] == "f6_clique"), None)
        error = next((r for r in results if r["type"] == "error"), None)
        if f6 is not None:
            return f6["data"]
        if error is not None:
            return {"error": error["message"]}
        return {"error": "未知错误"}

    def search_ego(self, name: str) -> dict:
        results = self._send_command(f"EGO {name}")
        ego = next((r for r in results if r["type"] == "ego"), None)
        error = next((r for r in results if r["type"] == "error"), None)
        if ego is not None:
            return ego["data"]
        if error is not None:
            return {"error": error["message"]}
        return {"error": "未知错误"}

    def suggest_keyword(self, prefix: str) -> dict:
        results = self._send_command(f"SUGGEST {prefix}")
        terms = []
        for r in results:
            if r["type"] == "suggest":
                terms = r["terms"]
                break
            elif r["type"] == "error":
                return {"error": r["message"]}
        return {"terms": terms}


# 全局后端实例
backend = CppBackend()


class APIHandler(http.server.SimpleHTTPRequestHandler):
    """自定义 HTTP 处理器：API + 静态文件"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(FRONTEND_DIR), **kwargs)

    def log_message(self, format, *args):
        # 精简日志
        print(f"[HTTP] {args[0]}")

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        # 数据文件路由：/build/data/ -> build/data/
        if path.startswith("/build/data/"):
            self._serve_data_file(path)
            return

        # API 路由
        if path == "/api/clique":
            try:
                order = int(qs.get("order", ["5"])[0])
            except ValueError:
                order = 5
            self._handle_api(lambda: backend.search_clique(order))
        elif path == "/api/ego":
            name = qs.get("name", [""])[0]
            if not name:
                self._handle_api(lambda: {"error": "缺少 name 参数"})
            else:
                self._handle_api(lambda: backend.search_ego(name))
        elif path == "/api/search/author":
            self._handle_api(lambda: backend.search_author(
                qs.get("q", [""])[0]
            ))
        elif path == "/api/search/title":
            self._handle_api(lambda: backend.search_title(
                qs.get("q", [""])[0]
            ))
        elif path == "/api/search/keyword":
            self._handle_api(lambda: backend.search_keyword(
                qs.get("q", [""])[0]
            ))
        elif path == "/api/suggest/keyword":
            q = qs.get("q", [""])[0]
            if not q or not q.strip():
                self._handle_api(lambda: {"terms": []})
            else:
                self._handle_api(lambda: backend.suggest_keyword(q))
        elif path == "/api/status":
            self._handle_api(lambda: {"status": "ok"})
        else:
            # 默认：提供前端静态文件
            super().do_GET()

    def _serve_data_file(self, path):
        """安全地从 build/data/ 目录提供 JSON 文件"""
        # 路径格式: /build/data/f3_top100.json 或 /build/data/ego/xxx.json
        rel = path[len("/build/data/"):]
        # 安全检查：禁止目录遍历
        if ".." in rel or rel.startswith("/"):
            self.send_error(403)
            return
        file_path = BUILD_DIR / "data" / rel
        if not file_path.is_file():
            self.send_error(404)
            return
        try:
            self.send_response(200)
            if file_path.suffix == ".json":
                self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            with open(file_path, "rb") as f:
                self.wfile.write(f.read())
        except Exception:
            self.send_error(500)

    def do_POST(self):
        # 转发到 GET 处理（也接受 POST）
        return self.do_GET()

    def _handle_api(self, fn):
        try:
            result = fn()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps(result, ensure_ascii=False).encode("utf-8"))
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            error = {"error": str(e)}
            self.wfile.write(json.dumps(error, ensure_ascii=False).encode("utf-8"))

    def do_HEAD(self):
        """处理 HEAD 请求：与 GET 相同的路由逻辑，但不返回 body"""
        # 对于数据文件路由，手动处理
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path.startswith("/build/data/"):
            self._serve_data_file_head(path)
            return
        # API 路由和静态文件：复用 GET 逻辑，HTTP 框架会自动丢弃 body
        self.do_GET()

    def _serve_data_file_head(self, path):
        rel = path[len("/build/data/"):]
        if ".." in rel or rel.startswith("/"):
            self.send_error(403)
            return
        file_path = BUILD_DIR / "data" / rel
        if not file_path.is_file():
            self.send_error(404)
            return
        try:
            self.send_response(200)
            if file_path.suffix == ".json":
                self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(file_path.stat().st_size))
            self.end_headers()
        except Exception:
            self.send_error(500)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()


def main():
    port = 8080
    if len(sys.argv) > 1:
        for arg in sys.argv[1:]:
            if arg.startswith("--port="):
                port = int(arg.split("=")[1])
            elif arg.isdigit():
                port = int(arg)

    # 启动 C++ 后端
    try:
        backend.start()
    except Exception as e:
        print(f"[FATAL] 无法启动 C++ 后端: {e}")
        print("请确保已编译 DBLP_Extreme: cd build && cmake --build .")
        sys.exit(1)

    # 启动 HTTP 服务器
    server = http.server.HTTPServer(("0.0.0.0", port), APIHandler)
    print(f"\n{'='*60}")
    print(f"  DBLP Extreme 搜索服务已启动")
    print(f"  前端地址: http://localhost:{port}/")
    print(f"  API 端点: http://localhost:{port}/api/search/author?q=...")
    print(f"            http://localhost:{port}/api/search/title?q=...")
    print(f"            http://localhost:{port}/api/search/keyword?q=...")
    print(f"{'='*60}\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[Shutdown] 正在关闭...")
    finally:
        backend.stop()
        server.shutdown()


if __name__ == "__main__":
    main()
