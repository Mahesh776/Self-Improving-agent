import json
import shutil
from pathlib import Path

PERSONA_DIR = Path(__file__).parent / "staging" / "persona"
DEFAULTS_DIR = Path(__file__).parent.parent / "persona_defaults"

PERSONA_FILES = [
    "AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md",
    "MEMORY.md", "TOOLS.md", "BOOTSTRAP.md",
]

def ensure_persona_layout() -> None:
    PERSONA_DIR.mkdir(parents=True, exist_ok=True)
    for fname in PERSONA_FILES:
        dest = PERSONA_DIR / fname
        if not dest.exists():
            default = DEFAULTS_DIR / fname
            if default.exists():
                shutil.copy2(default, dest)
            else:
                dest.write_text(f"# {fname.replace('.md', '')}\n\n", encoding="utf-8")

def read_persona_file(name: str) -> str:
    path = PERSONA_DIR / name
    if path.exists():
        return path.read_text(encoding="utf-8")
    return ""

def write_persona_file(name: str, content: str) -> None:
    PERSONA_DIR.mkdir(parents=True, exist_ok=True)
    path = PERSONA_DIR / name
    path.write_text(content, encoding="utf-8")

def list_persona_files() -> list[dict]:
    ensure_persona_layout()
    files = []
    for fname in PERSONA_FILES:
        path = PERSONA_DIR / fname
        files.append({
            "name": fname,
            "exists": path.exists(),
            "size": path.stat().st_size if path.exists() else 0,
        })
    return files

def reset_persona() -> None:
    if PERSONA_DIR.exists():
        shutil.rmtree(PERSONA_DIR)
    ensure_persona_layout()

def build_system_instruction() -> str:
    parts = []
    for fname in ["SOUL.md", "IDENTITY.md", "USER.md", "MEMORY.md", "AGENTS.md", "TOOLS.md"]:
        content = read_persona_file(fname)
        if content.strip():
            parts.append(content.strip())
    return "\n\n---\n\n".join(parts) if parts else "You are Manus, a helpful AI assistant."

def update_memory(addition: str) -> None:
    memory = read_persona_file("MEMORY.md")
    if not memory.strip():
        memory = "# Memory\n\n## Session Log\n\n"
    memory += f"\n- {addition}"
    write_persona_file("MEMORY.md", memory)

def update_tools_list(tools: list[dict]) -> None:
    lines = ["# Installed Tools\n"]
    if not tools:
        lines.append("\nNo tools installed yet.")
    else:
        for t in tools:
            lines.append(f"\n## {t.get('name', 'unknown')}\n")
            lines.append(f"- **Description:** {t.get('description', 'N/A')}")
            if t.get('parameters'):
                lines.append(f"- **Parameters:** {json.dumps(t['parameters'], indent=2)}")
    write_persona_file("TOOLS.md", "\n".join(lines))
