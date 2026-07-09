import json
from pathlib import Path

DATA_DIR = Path(__file__).parent / "staging"
SECRETS_FILE = DATA_DIR / "secrets.json"

SUPPORTED_PROVIDERS = ["OPENROUTER_API_KEY", "GEMINI_API_KEY"]

def load_secrets() -> dict:
    if SECRETS_FILE.exists():
        try:
            return json.loads(SECRETS_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {}

def save_secrets(secrets: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SECRETS_FILE.write_text(json.dumps(secrets, indent=2), encoding="utf-8")

def set_secret(key: str, value: str) -> None:
    secrets = load_secrets()
    secrets[key] = value
    save_secrets(secrets)
    import os
    os.environ[key] = value

def clear_secret(key: str) -> None:
    secrets = load_secrets()
    secrets.pop(key, None)
    save_secrets(secrets)
    import os
    os.environ.pop(key, None)

def secrets_status() -> list[dict]:
    secrets = load_secrets()
    import os
    result = []
    for key in SUPPORTED_PROVIDERS:
        env_val = os.environ.get(key, "")
        secret_val = secrets.get(key, "")
        has_key = bool(env_val or secret_val)
        result.append({
            "key": key,
            "configured": has_key,
            "preview": (secret_val or env_val)[:8] + "..." if has_key else "",
        })
    return result

def apply_secrets_to_environ() -> None:
    import os
    secrets = load_secrets()
    for key, value in secrets.items():
        if value and not os.environ.get(key):
            os.environ[key] = value
