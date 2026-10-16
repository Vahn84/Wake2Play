#!/usr/bin/env python3
"""Evaluate a JS expression in a Steam CEF tab via the DevTools protocol.

Stdlib only (SteamOS has no websocket module). Usage on the Deck:
    python3 cdp_eval.py <tab-title> '<js expression>'
"""
import base64
import json
import os
import socket
import struct
import sys
import urllib.request


def ws_connect(url):
    host_port, path = url[len("ws://"):].split("/", 1)
    host, port = host_port.split(":")
    s = socket.create_connection((host, int(port)), timeout=15)
    key = base64.b64encode(os.urandom(16)).decode()
    s.sendall((f"GET /{path} HTTP/1.1\r\nHost: {host_port}\r\nUpgrade: websocket\r\n"
               f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
               "Sec-WebSocket-Version: 13\r\n\r\n").encode())
    buf = b""
    while b"\r\n\r\n" not in buf:
        buf += s.recv(4096)
    return s, buf.split(b"\r\n\r\n", 1)[1]


def ws_send(s, text):
    data = text.encode()
    hdr = bytearray([0x81])
    n = len(data)
    if n < 126:
        hdr.append(0x80 | n)
    elif n < 65536:
        hdr += bytes([0x80 | 126]) + struct.pack(">H", n)
    else:
        hdr += bytes([0x80 | 127]) + struct.pack(">Q", n)
    mask = os.urandom(4)
    s.sendall(bytes(hdr) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))


def ws_recv(s, buf):
    def need(k):
        nonlocal buf
        while len(buf) < k:
            chunk = s.recv(65536)
            if not chunk:
                raise ConnectionError("closed")
            buf += chunk
    msg = b""
    while True:
        need(2)
        fin, n = buf[0] & 0x80, buf[1] & 0x7F
        off = 2
        if n == 126:
            need(4); n = struct.unpack(">H", buf[2:4])[0]; off = 4
        elif n == 127:
            need(10); n = struct.unpack(">Q", buf[2:10])[0]; off = 10
        need(off + n)
        msg += buf[off:off + n]
        buf = buf[off + n:]
        if fin:
            return msg.decode(errors="replace"), buf


def main():
    title, expr = sys.argv[1], sys.argv[2]
    tabs = json.load(urllib.request.urlopen("http://127.0.0.1:8080/json", timeout=5))
    url = next(t["webSocketDebuggerUrl"] for t in tabs if t["title"] == title)
    s, buf = ws_connect(url)
    ws_send(s, json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {
        "expression": expr, "awaitPromise": True, "returnByValue": True}}))
    while True:
        msg, buf = ws_recv(s, buf)
        obj = json.loads(msg)
        if obj.get("id") == 1:
            res = obj.get("result", {})
            if "exceptionDetails" in res:
                print("EXCEPTION:", json.dumps(res["exceptionDetails"])[:2000])
            else:
                print(json.dumps(res.get("result", {}).get("value"), indent=1))
            return


if __name__ == "__main__":
    main()
