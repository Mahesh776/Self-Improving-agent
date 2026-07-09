import json
import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="ManusAgent Tool Runtime")

TOOLS_DIR = Path(os.environ.get("TOOLS_DIR", "./custom_tools"))
VENV_PATH = Path(os.environ.get("VENV_PATH", "./.tool_runtime_venv"))

TOOLS_DIR.mkdir(parents=True, exist_ok=True)

class RunRequest(BaseModel):
    arguments: dict[str, Any] = Field(default_factory=dict)

class InstallRequest(BaseModel):
    tool_code: str
    test_code: str
    requirements: list[str] = Field(default_factory=list)

class PipInstallRequest(BaseModel):
    packages: list[str]

def _get_venv_python() -> str:
    if os.name == "nt":
        exe = VENV_PATH / "Scripts" / "python.exe"
    else:
        exe = VENV_PATH / "bin" / "python"
    if exe.exists():
        return str(exe)
    return "python"

def _ensure_venv() -> None:
    if VENV_PATH.exists():
        return
    try:
        subprocess.run(["python", "-m", "venv", str(VENV_PATH)], capture_output=True, timeout=30)
        logger.info("Created tool runtime venv at %s", VENV_PATH)
    except Exception as e:
        logger.warning("Failed to create venv: %s", e)

def list_tools() -> list[dict]:
    tools = []
    for py_file in TOOLS_DIR.glob("*.py"):
        if py_file.name.startswith("_"):
            continue
        name = py_file.stem
        manifest_path = TOOLS_DIR / f"{name}.manifest.json"
        if manifest_path.exists():
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                tools.append({
                    "name": name,
                    "description": manifest.get("description", ""),
                    "schema": manifest.get("parameters", {}),
                })
            except (json.JSONDecodeError, OSError):
                tools.append({"name": name, "description": "", "schema": {}})
    return tools

def run_tool(name: str, arguments: dict) -> Any:
    tool_path = TOOLS_DIR / f"{name}.py"
    if not tool_path.exists():
        raise FileNotFoundError(f"Tool '{name}' not found")

    _ensure_venv()
    python_exe = _get_venv_python()

    req_path = TOOLS_DIR / f"{name}_requirements.txt"
    if req_path.exists():
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
            except Exception:
                pass

    code = tool_path.read_text(encoding="utf-8")
    module_globals = {"__name__": f"custom_tools.{name}", "__file__": str(tool_path)}
    exec(compile(code, str(tool_path), "exec"), module_globals)

    run_func = module_globals.get("run")
    if not callable(run_func):
        raise ValueError(f"Tool '{name}' has no run() function")

    return run_func(arguments)

def install_tool(name: str, code: str, test_code: str, requirements: list[str], skip_pip: bool = False) -> tuple[bool, str]:
    try:
        TOOLS_DIR.mkdir(parents=True, exist_ok=True)
        (TOOLS_DIR / f"{name}.py").write_text(code, encoding="utf-8")
        (TOOLS_DIR / f"{name}_test.py").write_text(test_code, encoding="utf-8")

        if requirements and not skip_pip:
            _ensure_venv()
            python_exe = _get_venv_python()
            try:
                proc = subprocess.run(
                    [python_exe, "-m", "pip", "install", "--quiet"] + requirements,
                    capture_output=True, text=True, timeout=120,
                )
                if proc.returncode != 0:
                    return False, f"pip install failed: {proc.stderr[:500]}"
            except Exception as e:
                return False, f"pip install error: {e}"

        return True, f"Tool '{name}' installed successfully"
    except Exception as e:
        return False, f"Install error: {e}"

def verify_tool_in_runtime(name: str, test_code: str) -> tuple[bool, str]:
    try:
        _ensure_venv()
        python_exe = _get_venv_python()
        tool_path = TOOLS_DIR / f"{name}.py"
        if not tool_path.exists():
            return False, f"Tool '{name}' not found"

        import tempfile
        with tempfile.TemporaryDirectory() as tmpdir:
            shutil.copy2(tool_path, Path(tmpdir) / "tool.py")
            test_path = Path(tmpdir) / "test_tool.py"
            test_path.write_text(test_code, encoding="utf-8")

            proc = subprocess.run(
                [python_exe, str(test_path)],
                capture_output=True, text=True, timeout=30,
                cwd=tmpdir,
            )
            if proc.returncode == 0:
                return True, proc.stdout[:500] if proc.stdout else "Tests passed"
            return False, proc.stderr[:500] if proc.stderr else "Tests failed"
    except Exception as e:
        return False, f"Verification error: {e}"

def pip_install(packages: list[str]) -> tuple[bool, str]:
    _ensure_venv()
    python_exe = _get_venv_python()
    try:
        proc = subprocess.run(
            [python_exe, "-m", "pip", "install", "--quiet"] + packages,
            capture_output=True, text=True, timeout=120,
        )
        if proc.returncode == 0:
            return True, "Packages installed"
        return False, proc.stderr[:500]
    except Exception as e:
        return False, str(e)

def pip_uninstall(package: str) -> tuple[bool, str]:
    _ensure_venv()
    python_exe = _get_venv_python()
    try:
        proc = subprocess.run(
            [python_exe, "-m", "pip", "uninstall", "-y", package],
            capture_output=True, text=True, timeout=30,
        )
        if proc.returncode == 0:
            return True, f"Uninstalled {package}"
        return False, proc.stderr[:500]
    except Exception as e:
        return False, str(e)

def list_installed_packages() -> list[str]:
    _ensure_venv()
    python_exe = _get_venv_python()
    try:
        proc = subprocess.run(
            [python_exe, "-m", "pip", "list", "--format=freeze"],
            capture_output=True, text=True, timeout=15,
        )
        if proc.returncode == 0:
            return [
                line.split("==")[0] for line in proc.stdout.strip().splitlines()
                if "==" in line
            ]
        return []
    except Exception:
        return []

def delete_tool(name: str) -> None:
    for ext in [".py", "_test.py", ".manifest.json", "_requirements.txt"]:
        path = TOOLS_DIR / f"{name}{ext}"
        if path.exists():
            path.unlink()

@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}

@app.get("/tools")
async def get_tools() -> dict:
    return {"tools": list_tools()}

@app.post("/tools/{name}/run")
async def execute_tool_endpoint(name: str, payload: RunRequest) -> dict:
    try:
        result = run_tool(name, payload.arguments)
        return {"status": "ok", "result": result}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception("Tool run failed: %s", name)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/tools/{name}/install")
async def install_endpoint(name: str, payload: InstallRequest) -> dict:
    ok, logs = install_tool(name, payload.tool_code, payload.test_code, payload.requirements)
    if not ok:
        raise HTTPException(status_code=502, detail=logs)
    return {"status": "ok", "logs": logs}

@app.post("/tools/{name}/verify")
async def verify_endpoint(name: str, request: Request) -> dict:
    body = await request.json()
    test_code = body.get("test_code", "")
    if not test_code.strip():
        raise HTTPException(status_code=400, detail="test_code required")
    ok, logs = verify_tool_in_runtime(name, test_code)
    if not ok:
        raise HTTPException(status_code=502, detail=logs)
    return {"status": "ok", "logs": logs}

@app.post("/pip/install")
async def pip_install_endpoint(payload: PipInstallRequest) -> dict:
    packages = [p.strip() for p in payload.packages if p.strip()]
    if not packages:
        raise HTTPException(status_code=400, detail="No packages specified")
    ok, logs = pip_install(packages)
    if not ok:
        raise HTTPException(status_code=502, detail=logs)
    return {"status": "ok", "logs": logs}

@app.get("/pip/packages")
async def list_pip_packages() -> dict:
    return {"packages": list_installed_packages()}

@app.delete("/pip/packages/{package_name}")
async def uninstall_pip_package(package_name: str) -> dict:
    ok, logs = pip_uninstall(package_name)
    if not ok:
        raise HTTPException(status_code=502, detail=logs)
    return {"status": "ok", "logs": logs, "packages": list_installed_packages()}

@app.delete("/tools/{name}")
async def remove_tool_endpoint(name: str) -> dict:
    delete_tool(name)
    return {"status": "deleted", "tool_name": name}
