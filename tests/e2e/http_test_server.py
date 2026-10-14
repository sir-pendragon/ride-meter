"""Concurrent local fixture server; Chrome can open several connections at once."""
import socketserver

class TestServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True
    request_queue_size = 128
