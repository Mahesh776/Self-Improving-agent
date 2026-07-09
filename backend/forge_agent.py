import asyncio
import json
import logging
import time
import uuid
from collections.abc import AsyncIterator
from pathlib import Path

from llm_client import stream_chat_completion, extract_stream_delta
from tool_creator import plan_tool, parse_tool_plan, generate_tool_code, parse_tool_code
from build_pipeline import run_build_pipeline
from tools_engine import list_tools, write_tool_files, validate_tool_schema, validate_manifest
from prompts import get_prompt

logger = logging.getLogger(__name__)

FORGE_JOBS: dict[str, dict] = {}


class ForgeJob:
    def __init__(self, job_id: str, description: str, model: str):
        self.job_id = job_id
        self.description = description
        self.model = model
        self.status = "queued"
        self.progress: list[dict] = []
        self.result: dict | None = None
        self.created_at = time.time()

    def add_progress(self, phase: str, status: str, message: str = ""):
        event = {"phase": phase, "status": status, "message": message, "time": time.time()}
        self.progress.append(event)

    def to_dict(self) -> dict:
        return {
            "job_id": self.job_id,
            "description": self.description,
            "status": self.status,
            "progress": self.progress,
            "result": self.result,
            "created_at": self.created_at,
        }


def create_job(description: str, model: str) -> str:
    job_id = str(uuid.uuid4())[:8]
    job = ForgeJob(job_id, description, model)
    FORGE_JOBS[job_id] = job
    return job_id


def get_job(job_id: str) -> dict | None:
    job = FORGE_JOBS.get(job_id)
    return job.to_dict() if job else None


def list_jobs() -> list[dict]:
    return [job.to_dict() for job in FORGE_JOBS.values()]


async def run_forge_agent(job_id: str) -> dict:
    job = FORGE_JOBS.get(job_id)
    if not job:
        return {"error": "Job not found"}

    job.status = "running"
    job.add_progress("start", "running", "Forge agent started")

    try:
        existing_tools = list_tools()
        job.add_progress("plan", "running", "Generating skill plan...")

        plan_text = ""
        async for chunk in plan_tool(job.description, existing_tools, job.model):
            plan_text += chunk

        plan = parse_tool_plan(plan_text)
        if not plan:
            job.status = "failed"
            job.add_progress("plan", "failed", "Could not generate plan")
            job.result = {"error": "Could not generate a valid plan"}
            return job.result

        job.add_progress("plan", "completed", f"Plan ready: {plan.get('name', 'unknown')}")
        job.add_progress("codegen", "running", "Generating code...")

        code_text = ""
        async for chunk in generate_tool_code(plan, job.model):
            code_text += chunk

        parsed = parse_tool_code(code_text)
        if not parsed:
            job.status = "failed"
            job.add_progress("codegen", "failed", "Could not parse generated code")
            job.result = {"error": "Could not generate valid code", "raw": code_text[:1000]}
            return job.result

        code = parsed["code"]
        test_code = parsed["test_code"]
        manifest = parsed["manifest"]
        if not manifest.get("name"):
            manifest["name"] = plan.get("name", "unknown_tool")
        if not manifest.get("description"):
            manifest["description"] = plan.get("description", "")
        requirements = plan.get("packages", [])

        job.add_progress("codegen", "completed", f"Code generated ({len(code)} chars)")
        job.add_progress("validate", "running", "Validating code...")

        valid, msg = validate_tool_schema(code)
        if not valid:
            job.status = "failed"
            job.add_progress("validate", "failed", f"Validation failed: {msg}")
            job.result = {"error": f"Code validation failed: {msg}"}
            return job.result

        valid, msg = validate_manifest(manifest)
        if not valid:
            job.status = "failed"
            job.add_progress("validate", "failed", f"Manifest invalid: {msg}")
            job.result = {"error": f"Manifest validation failed: {msg}"}
            return job.result

        job.add_progress("validate", "completed", "Validation passed")
        job.add_progress("test", "running", "Running tests...")

        test_ok, test_msg = await _run_sandbox_test(code, test_code, requirements)
        if not test_ok:
            job.add_progress("test", "failed", f"Tests failed: {test_msg}")
            job.add_progress("install", "running", "Tests failed but installing anyway...")

        job.add_progress("test", "completed" if test_ok else "warning", test_msg)
        job.add_progress("install", "running", "Installing skill...")

        tool_name = manifest.get("name", plan.get("name", "unknown"))
        write_tool_files(tool_name, code, test_code, requirements, manifest)

        job.add_progress("install", "completed", f"Skill '{tool_name}' installed!")
        job.status = "completed"
        job.result = {
            "success": True,
            "tool_name": tool_name,
            "description": manifest.get("description", ""),
            "code": code,
        }

        return job.result

    except Exception as e:
        logger.exception("Forge agent failed")
        job.status = "failed"
        job.add_progress("error", "failed", str(e))
        job.result = {"error": str(e)}
        return job.result


async def _run_sandbox_test(code: str, test_code: str, requirements: list[str]) -> tuple[bool, str]:
    try:
        import tempfile
        import subprocess
        import os
        from pathlib import Path

        TOOLS_DIR = Path(__file__).parent / "custom_tools"

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
    import os
    venv = Path(venv_path)
    if os.name == "nt":
        exe = venv / "Scripts" / "python.exe"
    else:
        exe = venv / "bin" / "python"
    if exe.exists():
        return str(exe)
    return "python"
