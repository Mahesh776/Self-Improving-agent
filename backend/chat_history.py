import json
import time
from pathlib import Path

DATA_DIR = Path(__file__).parent / "staging"
CHAT_HISTORY_FILE = DATA_DIR / "chat_history.json"
MAX_MESSAGES = 200


def _load_history() -> list[dict]:
    if CHAT_HISTORY_FILE.exists():
        try:
            data = json.loads(CHAT_HISTORY_FILE.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return data
        except (json.JSONDecodeError, OSError):
            pass
    return []


def _save_history(messages: list[dict]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    trimmed = messages[-MAX_MESSAGES:]
    CHAT_HISTORY_FILE.write_text(json.dumps(trimmed, indent=2, ensure_ascii=False), encoding="utf-8")


def get_history() -> list[dict]:
    return _load_history()


def add_message(role: str, content: str, tool_calls=None, tool_call_id=None) -> None:
    messages = _load_history()
    msg = {"role": role, "content": content, "timestamp": time.time()}
    if tool_calls:
        msg["tool_calls"] = tool_calls
    if tool_call_id:
        msg["tool_call_id"] = tool_call_id
    messages.append(msg)
    _save_history(messages)


def add_messages(msgs: list[dict]) -> None:
    messages = _load_history()
    for msg in msgs:
        entry = {
            "role": msg.get("role", "user"),
            "content": msg.get("content", ""),
            "timestamp": msg.get("timestamp", time.time()),
        }
        if msg.get("tool_calls"):
            entry["tool_calls"] = msg["tool_calls"]
        if msg.get("tool_call_id"):
            entry["tool_call_id"] = msg["tool_call_id"]
        messages.append(entry)
    _save_history(messages)


def clear_history() -> None:
    _save_history([])


def get_recent_for_context(limit: int = 20) -> list[dict]:
    messages = _load_history()
    recent = messages[-limit:]
    return [{"role": m["role"], "content": m.get("content", "")} for m in recent if m.get("content")]
