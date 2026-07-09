import ast
import json
import logging
import os
import re
import shutil
import subprocess
import types
from pathlib import Path

logger = logging.getLogger(__name__)

TOOLS_DIR = Path(__file__).parent / "custom_tools"
TOOLS_DIR.mkdir(exist_ok=True)
SKILL_DATA_DIR = TOOLS_DIR / "skill_data"
SKILL_DATA_DIR.mkdir(exist_ok=True)

def _validate_tool_name(name: str) -> bool:
    return bool(name and re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', name))

def list_tools() -> list[dict]:
    tools = []
    for py_file in TOOLS_DIR.glob("*.py"):
        if py_file.name.startswith("_"):
            continue
        tool_name = py_file.stem
        manifest = read_manifest(tool_name)
        if manifest:
            tools.append({
                "name": tool_name,
                "description": manifest.get("description", ""),
                "parameters": manifest.get("parameters", {}),
                "kind": manifest.get("kind", "headless"),
            })
    return tools

def tool_exists(name: str) -> bool:
    return (TOOLS_DIR / f"{name}.py").exists()

def read_manifest(name: str) -> dict | None:
    path = TOOLS_DIR / f"{name}.manifest.json"
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None
    return None

def write_tool_files(name: str, code: str, test_code: str, requirements: list[str], manifest: dict) -> None:
    TOOLS_DIR.mkdir(parents=True, exist_ok=True)
    (TOOLS_DIR / f"{name}.py").write_text(code, encoding="utf-8")
    (TOOLS_DIR / f"{name}_test.py").write_text(test_code, encoding="utf-8")
    (TOOLS_DIR / f"{name}.manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    if requirements:
        req_path = TOOLS_DIR / f"{name}_requirements.txt"
        req_path.write_text("\n".join(requirements), encoding="utf-8")

def delete_tool(name: str) -> None:
    for ext in [".py", "_test.py", ".manifest.json", "_requirements.txt"]:
        path = TOOLS_DIR / f"{name}{ext}"
        if path.exists():
            path.unlink()
    data_path = SKILL_DATA_DIR / f"{name}.json"
    if data_path.exists():
        data_path.unlink()

def execute_tool(name: str, arguments: dict) -> dict:
    tool_path = TOOLS_DIR / f"{name}.py"
    if not tool_path.exists():
        raise FileNotFoundError(f"Tool '{name}' not found")

    venv_path = os.environ.get("VENV_PATH", str(TOOLS_DIR / ".tool_runtime_venv"))
    python_exe = _find_venv_python(venv_path)

    code = tool_path.read_text(encoding="utf-8")
    manifest = read_manifest(name) or {}

    req_path = TOOLS_DIR / f"{name}_requirements.txt"
    if req_path.exists():
        _ensure_requirements(req_path, python_exe)

    module_globals = {
        "__name__": f"custom_tools.{name}",
        "__file__": str(tool_path),
    }
    exec(compile(code, str(tool_path), "exec"), module_globals)

    run_func = module_globals.get("run")
    if not callable(run_func):
        raise ValueError(f"Tool '{name}' does not have a callable run() function")

    result = run_func(arguments)
    if not isinstance(result, dict):
        result = {"result": str(result)}
    return result

def _find_venv_python(venv_path: str) -> str:
    venv = Path(venv_path)
    if os.name == "nt":
        exe = venv / "Scripts" / "python.exe"
    else:
        exe = venv / "bin" / "python"
    if exe.exists():
        return str(exe)
    return "python"

def _ensure_requirements(req_path: Path, python_exe: str) -> None:
    packages = [
        line.strip() for line in req_path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]
    if packages:
        try:
            subprocess.run(
                [python_exe, "-m", "pip", "install", "--quiet"] + packages,
                capture_output=True, timeout=120,
            )
        except (subprocess.SubprocessError, FileNotFoundError) as e:
            logger.warning("Failed to install requirements: %s", e)

def read_skill_data(name: str) -> dict:
    data_path = SKILL_DATA_DIR / f"{name}.json"
    if data_path.exists():
        try:
            return json.loads(data_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {"records": []}

def write_skill_data(name: str, data: dict) -> None:
    SKILL_DATA_DIR.mkdir(parents=True, exist_ok=True)
    data_path = SKILL_DATA_DIR / f"{name}.json"
    data_path.write_text(json.dumps(data, indent=2), encoding="utf-8")

def validate_tool_schema(code: str) -> tuple[bool, str]:
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return False, f"Syntax error: {e}"

    has_run = False
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "run":
            has_run = True
            break
    if not has_run:
        return False, "No run() function found"
    return True, "OK"

def validate_manifest(manifest: dict) -> tuple[bool, str]:
    if not manifest.get("name"):
        return False, "Manifest missing 'name'"
    if not manifest.get("description"):
        return False, "Manifest missing 'description'"
    return True, "OK"

async def fix_tool(name: str, error: str, model: str) -> tuple[bool, str]:
    from llm_client import stream_chat_completion, extract_stream_delta
    from prompts import get_prompt

    tool_path = TOOLS_DIR / f"{name}.py"
    if not tool_path.exists():
        return False, f"Tool '{name}' not found"

    code = tool_path.read_text(encoding="utf-8")
    manifest = read_manifest(name) or {}
    system = get_prompt("forge_fix")
    user_msg = f"""This tool has an error when executed. Fix the code.

Tool name: {name}
Description: {manifest.get('description', '')}

ERROR:
{error}

CURRENT CODE:
```python
{code}
```

Fix the code and return ONLY the corrected Python code in a ```python block.
Keep the same run(arguments: dict) -> dict signature.
Return ONLY the fixed code, no explanation."""

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_msg},
    ]

    full_response = ""
    async for chunk in stream_chat_completion(model, messages, temperature=0.2):
        delta = extract_stream_delta(chunk)
        if delta["content"]:
            full_response += delta["content"]
        if delta.get("finish_reason") == "error":
            return False, f"LLM error: {delta['content']}"

    fixed_code = _extract_fixed_code(full_response)
    if not fixed_code:
        return False, "Could not extract fixed code from response"

    if "def run" not in fixed_code:
        return False, "Fixed code missing run() function"

    try:
        import ast
        ast.parse(fixed_code)
    except SyntaxError as e:
        return False, f"Fixed code has syntax error: {e}"

    tool_path.write_text(fixed_code, encoding="utf-8")
    return True, f"Tool '{name}' fixed successfully"

def _extract_fixed_code(response: str) -> str | None:
    import re
    code_blocks = []
    for m in re.finditer(r'```(?:python|py)?\s*\n(.*?)```', response, re.DOTALL):
        block = m.group(1).strip()
        if block:
            code_blocks.append(block)
    for block in code_blocks:
        if 'def run' in block:
            return block
    if code_blocks:
        return code_blocks[0]
    return None
