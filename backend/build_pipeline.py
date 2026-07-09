import json
import logging
import subprocess
import os
from pathlib import Path

logger = logging.getLogger(__name__)

TOOLS_DIR = Path(__file__).parent / "custom_tools"

class BuildPhase:
    PLAN = "plan"
    CODEGEN = "codegen"
    VALIDATE = "validate"
    TEST = "test"
    INSTALL = "install"

PHASES = [BuildPhase.PLAN, BuildPhase.CODEGEN, BuildPhase.VALIDATE, BuildPhase.TEST, BuildPhase.INSTALL]

async def run_build_pipeline(
    plan: dict,
    code: str,
    test_code: str,
    manifest: dict,
    requirements: list[str],
    on_phase,
) -> dict:
    result = {"success": False, "phases": {}, "error": None}

    await on_phase(BuildPhase.VALIDATE, "validating_code", "Validating code structure")
    from tools_engine import validate_tool_schema, validate_manifest
    valid, msg = validate_tool_schema(code)
    if not valid:
        result["error"] = f"Code validation failed: {msg}"
        result["phases"][BuildPhase.VALIDATE] = {"status": "failed", "message": msg}
        return result
    result["phases"][BuildPhase.VALIDATE] = {"status": "passed", "message": msg}

    valid, msg = validate_manifest(manifest)
    if not valid:
        result["error"] = f"Manifest validation failed: {msg}"
        result["phases"][BuildPhase.VALIDATE] = {"status": "failed", "message": msg}
        return result

    await on_phase(BuildPhase.TEST, "running_tests", "Running sandbox tests")
    test_ok, test_msg = await _run_sandbox_test(code, test_code, requirements)
    if not test_ok:
        result["error"] = f"Test failed: {test_msg}"
        result["phases"][BuildPhase.TEST] = {"status": "failed", "message": test_msg}
        return result
    result["phases"][BuildPhase.TEST] = {"status": "passed", "message": test_msg}

    await on_phase(BuildPhase.INSTALL, "installing_tool", "Installing skill")
    from tools_engine import write_tool_files
    tool_name = manifest.get("name", plan.get("name", "unknown"))
    write_tool_files(tool_name, code, test_code, requirements, manifest)

    if requirements:
        await on_phase(BuildPhase.INSTALL, "installing_packages", f"Installing packages: {', '.join(requirements)}")
        _install_requirements(requirements)

    result["phases"][BuildPhase.INSTALL] = {"status": "passed", "message": f"Tool '{tool_name}' installed"}
    result["success"] = True
    result["tool_name"] = tool_name

    return result

async def _run_sandbox_test(code: str, test_code: str, requirements: list[str]) -> tuple[bool, str]:
    try:
        import tempfile
        with tempfile.TemporaryDirectory() as tmpdir:
            tool_path = Path(tmpdir) / "tool.py"
            tool_path.write_text(code, encoding="utf-8")

            if requirements:
                venv_path = os.environ.get("VENV_PATH", str(TOOLS_DIR / ".tool_runtime_venv"))
                python_exe = _find_venv_python(venv_path)
                try:
                    subprocess.run(
                        [python_exe, "-m", "pip", "install", "--quiet"] + requirements,
                        capture_output=True, timeout=60,
                    )
                except Exception:
                    pass

            wrapper_code = f"""import sys
sys.path.insert(0, r"{tmpdir}")
from tool import run

{test_code}
"""
            test_path = Path(tmpdir) / "test_tool.py"
            test_path.write_text(wrapper_code, encoding="utf-8")

            python_exe = _find_venv_python(
                os.environ.get("VENV_PATH", str(TOOLS_DIR / ".tool_runtime_venv"))
            )
            proc = subprocess.run(
                [python_exe, str(test_path)],
                capture_output=True, text=True, timeout=30,
                cwd=tmpdir,
            )
            if proc.returncode == 0:
                return True, proc.stdout[:500] if proc.stdout else "Tests passed"
            else:
                return False, proc.stderr[:500] if proc.stderr else "Tests failed"
    except subprocess.TimeoutExpired:
        return False, "Test execution timed out"
    except Exception as e:
        return False, f"Test error: {str(e)}"

def _find_venv_python(venv_path: str) -> str:
    venv = Path(venv_path)
    if os.name == "nt":
        exe = venv / "Scripts" / "python.exe"
    else:
        exe = venv / "bin" / "python"
    if exe.exists():
        return str(exe)
    return "python"

def _install_requirements(requirements: list[str]) -> None:
    venv_path = os.environ.get("VENV_PATH", str(TOOLS_DIR / ".tool_runtime_venv"))
    python_exe = _find_venv_python(venv_path)
    try:
        subprocess.run(
            [python_exe, "-m", "pip", "install", "--quiet"] + requirements,
            capture_output=True, timeout=120,
        )
        logger.info(f"Installed packages: {requirements}")
    except Exception as e:
        logger.warning(f"Failed to install packages {requirements}: {e}")

def get_pending_pip_installs() -> list[dict]:
    return []

def get_pending_ui_previews() -> list[dict]:
    return []
