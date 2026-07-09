import json
from pathlib import Path

DATA_DIR = Path(__file__).parent / "staging"
GAMIFICATION_FILE = DATA_DIR / "gamification.json"

RANKS = [
    (1, "Initiate"),
    (5, "Apprentice"),
    (11, "Operator"),
    (21, "Architect"),
    (31, "Synthesist"),
    (41, "Apex"),
]

XP_PER_LEVEL = 500
MAX_LEVEL = 50
MAX_XP = MAX_LEVEL * XP_PER_LEVEL

def _load_data() -> dict:
    if GAMIFICATION_FILE.exists():
        try:
            return json.loads(GAMIFICATION_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {"xp": 0, "level": 1, "skills_unlocked": 0, "chat_count": 0}

def _save_data(data: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    GAMIFICATION_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")

def get_progress() -> dict:
    data = _load_data()
    xp = data.get("xp", 0)
    level = xp_to_level(xp)
    rank = get_rank(level)
    xp_in_level = xp % XP_PER_LEVEL
    xp_to_next = XP_PER_LEVEL - xp_in_level
    from tools_engine import list_tools
    actual_skills = len(list_tools())
    return {
        "xp": xp,
        "level": level,
        "rank": rank,
        "xp_in_level": xp_in_level,
        "xp_to_next": xp_to_next,
        "skills_unlocked": actual_skills,
        "chat_count": data.get("chat_count", 0),
    }

def add_xp(amount: int, reason: str = "") -> dict:
    data = _load_data()
    old_level = xp_to_level(data.get("xp", 0))
    data["xp"] = min(data.get("xp", 0) + amount, MAX_XP)
    new_level = xp_to_level(data["xp"])
    _save_data(data)
    return {
        "xp_added": amount,
        "reason": reason,
        "old_level": old_level,
        "new_level": new_level,
        "level_up": new_level > old_level,
        **get_progress(),
    }

def add_chat_xp() -> dict:
    return add_xp(30, "chat_completion")

def add_skill_xp() -> dict:
    return add_xp(180, "skill_unlock")

def increment_skill_count() -> None:
    data = _load_data()
    data["skills_unlocked"] = data.get("skills_unlocked", 0) + 1
    _save_data(data)

def increment_chat_count() -> None:
    data = _load_data()
    data["chat_count"] = data.get("chat_count", 0) + 1
    _save_data(data)

def reset_progress() -> None:
    _save_data({"xp": 0, "level": 1, "skills_unlocked": 0, "chat_count": 0})

def xp_to_level(xp: int) -> int:
    return min((xp // XP_PER_LEVEL) + 1, MAX_LEVEL)

def get_rank(level: int) -> str:
    rank = RANKS[0][1]
    for min_level, name in RANKS:
        if level >= min_level:
            rank = name
    return rank
