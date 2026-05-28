#!/usr/bin/env python3
"""siliconflow-healthcheck.py — 硅基流动 API 三项能力测试
测试: LLM / Embedding / Vision
参数: sys.argv[1] = 时间标签 (如 "01:00")
输出: 追加到 memory/siliconflow-health-log.jsonl
"""

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request

HOME = os.path.expanduser("~")
CONFIG_PATH = os.path.join(HOME, ".openclaw/openclaw.json")
WORKSPACE = os.path.join(HOME, ".openclaw/workspace")
LOG_FILE = os.path.join(WORKSPACE, "memory/siliconflow-health-log.jsonl")
BASE_URL = "https://api.siliconflow.cn/v1"

TIME_LABEL = sys.argv[1] if len(sys.argv) > 1 else "unknown"
TIMESTAMP = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

# Read API key
with open(CONFIG_PATH) as f:
    cfg = json.load(f)
API_KEY = cfg["models"]["providers"]["siliconflow"]["apiKey"]
HEADERS = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {API_KEY}",
}


def api_call(url, body, timeout=30):
    """Make POST request, return (status_code, text)."""
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=HEADERS, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:500]
    except Exception as e:
        return 0, str(e)


def test_llm():
    """Test chat completions with DeepSeek-V3.2."""
    url = f"{BASE_URL}/chat/completions"
    body = {
        "model": "deepseek-ai/DeepSeek-V3.2",
        "messages": [{"role": "user", "content": "回复 OK 即可"}],
        "max_tokens": 10,
        "temperature": 0.1,
    }
    status, text = api_call(url, body)
    if status != 200:
        return False, f"HTTP {status}: {text[:200]}", status

    try:
        result = json.loads(text)
        content = result["choices"][0]["message"]["content"]
        ok = content.strip() == "OK"
        return ok, f"OK" if ok else f"unexpected: {content.strip()[:50]}", status
    except Exception as e:
        return False, f"parse error: {e}", status


def test_embedding():
    """Test embedding with Qwen3-Embedding-4B."""
    url = f"{BASE_URL}/embeddings"
    body = {
        "model": "Qwen/Qwen3-Embedding-4B",
        "input": "API 连通性测试",
    }
    status, text = api_call(url, body)
    if status != 200:
        return False, f"HTTP {status}: {text[:200]}", status, 0

    try:
        result = json.loads(text)
        vec = result["data"][0]["embedding"]
        dim = len(vec)
        return dim > 0, f"OK (dim={dim})", status, dim
    except Exception as e:
        return False, f"parse error: {e}", status, 0


def _generate_test_png(size=28):
    """Generate a small transparent PNG for vision testing."""
    try:
        from PIL import Image
        import io
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode()
    except ImportError:
        # Fallback: hardcoded 28x28 transparent PNG
        return "iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAYAAAByDd+UAAAAGklEQVR4nO3BMQEAAADCoPVPbQhfoAAAAH4DDFwAAf7ywOgAAAAASUVORK5CYII="


def test_vision():
    """Test vision model with Qwen3-VL-32B-Instruct using a 28x28 PNG."""
    url = f"{BASE_URL}/chat/completions"
    test_image_b64 = _generate_test_png()
    body = {
        "model": "Qwen/Qwen3-VL-32B-Instruct",
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{test_image_b64}"}},
                    {"type": "text", "text": "Describe this image"},
                ],
            }
        ],
        "max_tokens": 50,
    }
    status, text = api_call(url, body, timeout=60)
    if status != 200:
        return False, f"HTTP {status}: {text[:200]}", status

    try:
        result = json.loads(text)
        content = result["choices"][0]["message"]["content"]
        return bool(content.strip()), f"OK ({content.strip()[:50]})", status
    except Exception as e:
        return False, f"parse error: {e}", status


def main():
    # Run tests
    llm_ok, llm_msg, llm_code = test_llm()
    emb_ok, emb_msg, emb_code, emb_dim = test_embedding()
    vis_ok, vis_msg, vis_code = test_vision()

    # Build log entry
    entry = {
        "timestamp": TIMESTAMP,
        "time_label": TIME_LABEL,
        "tests": {
            "llm": {"ok": llm_ok, "msg": llm_msg, "http_code": llm_code},
            "embedding": {"ok": emb_ok, "msg": emb_msg, "http_code": emb_code, "dim": emb_dim},
            "vision": {"ok": vis_ok, "msg": vis_msg, "http_code": vis_code},
        },
    }

    # Append to log file
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    with open(LOG_FILE, "a") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    # Console output
    status_line = (
        f"[{TIME_LABEL}] ═══ SiliconFlow Health Check ═══\n"
        f"  LLM:      {'✅' if llm_ok else '❌'}  {llm_msg}\n"
        f"  Embedding: {'✅' if emb_ok else '❌'}  {emb_msg}\n"
        f"  Vision:    {'✅' if vis_ok else '❌'}  {vis_msg}"
    )
    print(status_line)

    # Exit code
    sys.exit(0 if (llm_ok and emb_ok and vis_ok) else 1)


if __name__ == "__main__":
    main()
