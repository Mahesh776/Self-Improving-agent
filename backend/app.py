import asyncio
import json
import logging
import os
import time
import uuid
from collections.abc import AsyncIterator
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

from llm_client import (
    stream_chat_completion,
    extract_stream_delta,
    format_tools_for_llm,
    is_gemini_model,
)
from tools_engine import (
    list_tools,
    tool_exists,
    read_manifest,
    execute_tool,
    delete_tool,
    validate_tool_schema,
    validate_manifest,
    read_skill_data,
    write_skill_data,
)
from tool_creator import (
    plan_tool,
    parse_tool_plan,
    generate_tool_code,
    parse_tool_code,
    revise_tool_plan,
)
from build_pipeline import run_build_pipeline
from forge_agent import create_job, get_job, run_forge_agent, list_jobs
from persona import (
    ensure_persona_layout,
    build_system_instruction,
    list_persona_files,
    read_persona_file,
    write_persona_file,
    reset_persona,
    update_memory,
    update_tools_list,
)
from gamification import (
    get_progress,
    add_chat_xp,
    add_skill_xp,
    increment_skill_count,
    increment_chat_count,
    reset_progress,
)
from prompts import get_prompt, load_prompts_config, save_prompts_config, get_all_defaults
from secrets import apply_secrets_to_environ, secrets_status, set_secret, clear_secret, load_secrets

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def load_dotenv():
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            eq = line.find("=")
            if eq < 1:
                continue
            key = line[:eq].strip()
            value = line[eq+1:].strip()
            if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
                value = value[1:-1]
            if not os.environ.get(key):
                os.environ[key] = value

load_dotenv()

app = FastAPI(title="ManusAgent Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

TOOLS_DIR = Path(__file__).parent / "custom_tools"
TOOLS_DIR.mkdir(exist_ok=True)

PENDING_PLANS: dict[str, dict] = {}
RUN_CANCEL_FLAGS: set[str] = set()
MAX_TOOL_ITERATIONS = 5

CREATE_SKILL_TOOL = {
    "type": "function",
    "function": {
        "name": "create_skill",
        "description": "Create and install a new skill/tool. Call this when the user asks to create, add, or forge a new skill/tool/capability. This will generate code, validate it, test it, and install it automatically.",
        "parameters": {
            "type": "object",
            "properties": {
                "description": {
                    "type": "string",
                    "description": "Detailed description of what the skill should do, including any constraints (e.g. no API key, free only)"
                }
            },
            "required": ["description"]
        }
    }
}

FORGE_SKILL_TOOL = {
    "type": "function",
    "function": {
        "name": "forge_skill",
        "description": "Forge a new skill in the background using the Forge Agent. Use this instead of create_skill when the user asks to create/add/forge a skill. Returns a job ID. The agent will plan, generate code, validate, test, and install the skill automatically in the background.",
        "parameters": {
            "type": "object",
            "properties": {
                "description": {
                    "type": "string",
                    "description": "Detailed description of what the skill should do. Include constraints like 'no API key', 'free only', etc."
                }
            },
            "required": ["description"]
        }
    }
}

@app.on_event("startup")
async def startup():
    apply_secrets_to_environ()
    ensure_persona_layout()
    logger.info("ManusAgent backend started")

def litellm_headers() -> dict[str, str]:
    return {"Content-Type": "application/json"}

@app.get("/api/config")
async def get_config():
    tools = list_tools()
    return {
        "status": "ok",
        "tools": tools,
        "tool_count": len(tools),
        "persona_files": list_persona_files(),
    }

async def _handle_create_skill(args: dict, model: str) -> dict:
    description = args.get("description", "")
    if not description:
        return {"error": "No description provided for the skill"}

    try:
        existing_tools = list_tools()

        plan_text = ""
        async for chunk in plan_tool(description, existing_tools, model):
            plan_text += chunk

        plan = parse_tool_plan(plan_text)
        if not plan:
            return {"error": "Could not generate a valid plan for the skill"}

        code_text = ""
        async for chunk in generate_tool_code(plan, model):
            code_text += chunk

        parsed = parse_tool_code(code_text)
        if not parsed:
            return {"error": "Could not generate valid code for the skill", "raw_response": code_text[:2000]}

        code = parsed["code"]
        test_code = parsed["test_code"]
        manifest = parsed["manifest"]
        if not manifest.get("name"):
            manifest["name"] = plan.get("name", "unknown_tool")
        if not manifest.get("description"):
            manifest["description"] = plan.get("description", "")
        requirements = plan.get("packages", [])

        result = await run_build_pipeline(
            plan, code, test_code, manifest, requirements,
            lambda phase, status, message: asyncio.sleep(0),
        )

        if result["success"]:
            tool_name = result.get("tool_name", manifest.get("name", "unknown"))
            add_skill_xp()
            increment_skill_count()
            tools = list_tools()
            update_tools_list(tools)
            update_memory(f"Installed new skill: {tool_name}")
            return {
                "result": f"Skill '{tool_name}' created and installed successfully!",
                "tool_name": tool_name,
                "description": manifest.get("description", ""),
                "code": code,
            }
        else:
            return {"error": f"Build failed: {result.get('error', 'Unknown error')}"}

    except Exception as e:
        logger.exception("create_skill failed")
        return {"error": f"Failed to create skill: {str(e)}"}


async def _handle_forge_skill(args: dict, model: str) -> dict:
    description = args.get("description", "")
    if not description:
        return {"error": "No description provided"}

    job_id = create_job(description, model)

    asyncio.create_task(_run_forge_background(job_id))

    return {
        "job_id": job_id,
        "status": "queued",
        "message": f"Forge agent started! Job ID: {job_id}. Check progress at /api/forge/{job_id}/progress",
    }


async def _run_forge_background(job_id: str):
    try:
        result = await run_forge_agent(job_id)
        if result.get("success"):
            tool_name = result.get("tool_name", "unknown")
            add_skill_xp()
            increment_skill_count()
            tools = list_tools()
            update_tools_list(tools)
            update_memory(f"Forge agent installed skill: {tool_name}")
    except Exception as e:
        logger.exception(f"Forge background job {job_id} failed")
        from forge_agent import FORGE_JOBS
        job = FORGE_JOBS.get(job_id)
        if job:
            job.status = "failed"
            job.result = {"error": str(e)}

@app.get("/api/models")
async def get_models():
    models = []
    secrets = load_secrets()
    has_openrouter = bool(os.environ.get("OPENROUTER_API_KEY") or secrets.get("OPENROUTER_API_KEY"))
    has_gemini = bool(os.environ.get("GEMINI_API_KEY") or secrets.get("GEMINI_API_KEY"))
    has_opencode_zen = bool(os.environ.get("OPENCODE_ZEN_API_KEY") or secrets.get("OPENCODE_ZEN_API_KEY"))

    if has_openrouter:
        models.extend([
            {"id": "openrouter/free", "name": "Auto Router (Free)", "provider": "openrouter"},
            {"id": "meta-llama/llama-3.3-70b-instruct:free", "name": "Llama 3.3 70B (Free)", "provider": "openrouter"},
            {"id": "nvidia/nemotron-3-super-120b-a12b:free", "name": "Nemotron 3 Super 120B (Free)", "provider": "openrouter"},
            {"id": "nvidia/nemotron-3-ultra-550b-a55b:free", "name": "Nemotron 3 Ultra 550B (Free)", "provider": "openrouter"},
            {"id": "openai/gpt-oss-120b:free", "name": "GPT-OSS 120B (Free)", "provider": "openrouter"},
            {"id": "qwen/qwen3-coder:free", "name": "Qwen3 Coder (Free)", "provider": "openrouter"},
            {"id": "qwen/qwen3-next-80b-a3b-instruct:free", "name": "Qwen3 Next 80B (Free)", "provider": "openrouter"},
            {"id": "google/gemma-4-26b-a4b-it:free", "name": "Gemma 4 26B (Free)", "provider": "openrouter"},
            {"id": "google/gemma-4-31b-it:free", "name": "Gemma 4 31B (Free)", "provider": "openrouter"},
            {"id": "poolside/laguna-m.1:free", "name": "Laguna M.1 Coding (Free)", "provider": "openrouter"},
            {"id": "cohere/north-mini-code:free", "name": "North Mini Code (Free)", "provider": "openrouter"},
            {"id": "nousresearch/hermes-3-llama-3.1-405b:free", "name": "Hermes 3 405B (Free)", "provider": "openrouter"},
            {"id": "tencent/hy3:free", "name": "Tencent Hy3 (Free)", "provider": "openrouter"},
        ])
    if has_gemini:
        models.extend([
            {"id": "gemini/gemini-2.0-flash", "name": "Gemini 2.0 Flash", "provider": "gemini"},
            {"id": "gemini/gemini-1.5-flash", "name": "Gemini 1.5 Flash", "provider": "gemini"},
        ])
    if has_opencode_zen:
        models.extend([
            {"id": "zen/deepseek-v4-flash-free", "name": "DeepSeek V4 Flash (Free)", "provider": "opencode_zen"},
            {"id": "zen/deepseek-v3-0324-free", "name": "DeepSeek V3 (Free)", "provider": "opencode_zen"},
            {"id": "zen/llama-3.3-70b-free", "name": "Llama 3.3 70B (Free)", "provider": "opencode_zen"},
            {"id": "zen/gemma-3-27b-it-free", "name": "Gemma 3 27B (Free)", "provider": "opencode_zen"},
            {"id": "zen/minimax-m2.5", "name": "MiniMax M2.5", "provider": "opencode_zen"},
        ])
    return {"models": models}

@app.post("/api/chat")
async def chat(request: Request):
    body = await request.json()
    messages = body.get("messages", [])
    model = body.get("model", os.environ.get("SCOUT_MODEL", "openai/gpt-4o-mini"))
    run_id = body.get("run_id", str(uuid.uuid4()))

    tools = list_tools()
    llm_tools = format_tools_for_llm(tools) if tools else []
    llm_tools.append(CREATE_SKILL_TOOL)
    llm_tools.append(FORGE_SKILL_TOOL)

    system_instruction = build_system_instruction()
    full_messages = [{"role": "system", "content": system_instruction}] + messages

    async def event_stream():
        tool_iterations = 0
        current_messages = list(full_messages)

        while tool_iterations < MAX_TOOL_ITERATIONS:
            tool_calls_acc: dict[int, dict] = {}
            content_acc = ""
            saw_tool_call = False

            async for chunk in stream_chat_completion(model, current_messages, tools=llm_tools):
                if "error" in chunk:
                    yield f"data: {json.dumps({'error': chunk['error']})}\n\n"
                    return

                delta = extract_stream_delta(chunk)
                if delta["content"]:
                    content_acc += delta["content"]
                    if not saw_tool_call:
                        yield f"data: {json.dumps({'type': 'content', 'content': delta['content']})}\n\n"

                if delta["tool_calls"]:
                    saw_tool_call = True
                    for tc in delta["tool_calls"]:
                        idx = tc.get("index", 0)
                        if idx not in tool_calls_acc:
                            tool_calls_acc[idx] = {
                                "id": tc.get("id", f"call_{uuid.uuid4().hex[:8]}"),
                                "type": "function",
                                "function": {"name": "", "arguments": ""},
                            }
                        func = tc.get("function", {})
                        if func.get("name"):
                            tool_calls_acc[idx]["function"]["name"] = func["name"]
                        if func.get("arguments"):
                            tool_calls_acc[idx]["function"]["arguments"] += func["arguments"]

                if delta.get("finish_reason") == "stop" and not saw_tool_call:
                    break
                if delta.get("finish_reason") == "error":
                    yield f"data: {json.dumps({'type': 'error', 'content': delta['content']})}\n\n"
                    return

            if not tool_calls_acc:
                break

            assistant_msg = {"role": "assistant", "content": content_acc or None}
            assistant_msg["tool_calls"] = list(tool_calls_acc.values())
            current_messages.append(assistant_msg)

            yield f"data: {json.dumps({'type': 'tool_calls', 'tool_calls': list(tool_calls_acc.values())})}\n\n"

            for tc in tool_calls_acc.values():
                func_name = tc["function"]["name"]
                try:
                    args = json.loads(tc["function"]["arguments"])
                except json.JSONDecodeError:
                    args = {}

                yield f"data: {json.dumps({'type': 'tool_start', 'tool': func_name, 'arguments': args})}\n\n"

                if func_name == "create_skill":
                    result = await _handle_create_skill(args, model)
                elif func_name == "forge_skill":
                    result = await _handle_forge_skill(args, model)
                elif not tool_exists(func_name):
                    result = {"error": f"Tool '{func_name}' not found"}
                else:
                    try:
                        result = execute_tool(func_name, args)
                    except Exception as e:
                        result = {"error": str(e)}

                result_str = json.dumps(result)
                yield f"data: {json.dumps({'type': 'tool_result', 'tool': func_name, 'result': result})}\n\n"

                current_messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": result_str,
                })

            tool_iterations += 1

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    increment_chat_count()
    xp_result = add_chat_xp()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

@app.post("/api/propose_tool")
async def propose_tool(request: Request):
    body = await request.json()
    user_request = body.get("request", "")
    model = body.get("model", os.environ.get("SCOUT_MODEL", "openai/gpt-4o-mini"))

    plan_id = str(uuid.uuid4())
    existing_tools = list_tools()

    async def event_stream():
        plan_text = ""
        async for chunk in plan_tool(user_request, existing_tools, model):
            plan_text += chunk
            yield f"data: {json.dumps({'type': 'plan_chunk', 'content': chunk})}\n\n"

        plan = parse_tool_plan(plan_text)
        if plan:
            PENDING_PLANS[plan_id] = {
                "id": plan_id,
                "plan": plan,
                "raw_text": plan_text,
                "created_at": time.time(),
            }
            yield f"data: {json.dumps({'type': 'plan_ready', 'plan_id': plan_id, 'plan': plan})}\n\n"
        else:
            yield f"data: {json.dumps({'type': 'error', 'content': 'Could not parse tool plan'})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )

@app.post("/api/approve_tool")
async def approve_tool(request: Request):
    body = await request.json()
    plan_id = body.get("plan_id", "")
    model = body.get("model", os.environ.get("FORGE_MODEL", "openai/gpt-4o-mini"))

    pending = PENDING_PLANS.get(plan_id)
    if not pending:
        raise HTTPException(status_code=404, detail="Plan not found or expired")

    plan = pending["plan"]

    async def event_stream():
        yield f"data: {json.dumps({'type': 'build_start', 'plan': plan})}\n\n"

        yield f"data: {json.dumps({'type': 'phase', 'phase': 'codegen', 'status': 'running'})}\n\n"
        code_text = ""
        async for chunk in generate_tool_code(plan, model):
            code_text += chunk
            yield f"data: {json.dumps({'type': 'codegen_chunk', 'content': chunk})}\n\n"

        parsed = parse_tool_code(code_text)
        if not parsed:
            yield f"data: {json.dumps({'type': 'phase', 'phase': 'codegen', 'status': 'failed', 'message': 'Could not parse generated code'})}\n\n"
            yield f"data: {json.dumps({'type': 'done', 'success': False})}\n\n"
            return

        code = parsed["code"]
        test_code = parsed["test_code"]
        manifest = parsed["manifest"]
        if not manifest.get("name"):
            manifest["name"] = plan.get("name", "unknown_tool")
        if not manifest.get("description"):
            manifest["description"] = plan.get("description", "")

        requirements = plan.get("packages", [])

        yield f"data: {json.dumps({'type': 'phase', 'phase': 'codegen', 'status': 'completed'})}\n\n"

        async def on_phase(phase, status, message):
            yield f"data: {json.dumps({'type': 'phase', 'phase': phase, 'status': status, 'message': message})}\n\n"

        build_result = await run_build_pipeline(
            plan, code, test_code, manifest, requirements, on_phase,
        )

        if build_result["success"]:
            tool_name = build_result.get("tool_name", manifest.get("name", "unknown"))
            add_skill_xp()
            increment_skill_count()
            tools = list_tools()
            update_tools_list(tools)
            update_memory(f"Installed new skill: {tool_name}")

            PENDING_PLANS.pop(plan_id, None)
            yield f"data: {json.dumps({'type': 'build_complete', 'tool_name': tool_name})}\n\n"
        else:
            yield f"data: {json.dumps({'type': 'build_failed', 'error': build_result.get('error', 'Unknown error')})}\n\n"

        yield f"data: {json.dumps({'type': 'done', 'success': build_result['success']})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )

@app.post("/api/revise_tool")
async def revise_tool_endpoint(request: Request):
    body = await request.json()
    plan_id = body.get("plan_id", "")
    feedback = body.get("feedback", "")
    model = body.get("model", os.environ.get("SCOUT_MODEL", "openai/gpt-4o-mini"))

    pending = PENDING_PLANS.get(plan_id)
    if not pending:
        raise HTTPException(status_code=404, detail="Plan not found or expired")

    plan = pending["plan"]

    async def event_stream():
        revised_text = ""
        async for chunk in revise_tool_plan(plan, feedback, model):
            revised_text += chunk
            yield f"data: {json.dumps({'type': 'plan_chunk', 'content': chunk})}\n\n"

        revised_plan = parse_tool_plan(revised_text)
        if revised_plan:
            PENDING_PLANS[plan_id]["plan"] = revised_plan
            PENDING_PLANS[plan_id]["raw_text"] = revised_text
            yield f"data: {json.dumps({'type': 'plan_ready', 'plan_id': plan_id, 'plan': revised_plan})}\n\n"
        else:
            yield f"data: {json.dumps({'type': 'error', 'content': 'Could not parse revised plan'})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )

@app.post("/api/reject_tool")
async def reject_tool(request: Request):
    body = await request.json()
    plan_id = body.get("plan_id", "")
    PENDING_PLANS.pop(plan_id, None)
    return {"status": "rejected"}

@app.get("/api/tools")
async def get_tools():
    return {"tools": list_tools()}

@app.delete("/api/tools/{name}")
async def remove_tool(name: str):
    delete_tool(name)
    tools = list_tools()
    update_tools_list(tools)
    return {"status": "deleted", "tool_name": name}

@app.post("/api/tools/{name}/run")
async def run_tool(name: str, request: Request):
    body = await request.json()
    arguments = body.get("arguments", {})
    try:
        result = execute_tool(name, arguments)
        return {"status": "ok", "result": result}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/skills/{name}/data")
async def get_skill_data(name: str):
    return read_skill_data(name)

@app.get("/api/forge/jobs")
async def get_forge_jobs():
    return {"jobs": list_jobs()}

@app.get("/api/forge/{job_id}")
async def get_forge_job(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job

@app.get("/api/forge/{job_id}/progress")
async def forge_progress_stream(job_id: str):
    async def event_stream():
        import asyncio as _asyncio
        last_idx = 0
        while True:
            job = get_job(job_id)
            if not job:
                yield f"data: {json.dumps({'type': 'error', 'message': 'Job not found'})}\n\n"
                return

            progress = job.get("progress", [])
            while last_idx < len(progress):
                event = progress[last_idx]
                yield f"data: {json.dumps({'type': 'progress', **event})}\n\n"
                last_idx += 1

            if job.get("status") in ("completed", "failed"):
                yield f"data: {json.dumps({'type': 'done', 'status': job['status'], 'result': job.get('result')})}\n\n"
                return

            await _asyncio.sleep(1)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )

@app.get("/api/persona")
async def get_persona():
    files = list_persona_files()
    contents = {}
    for f in files:
        contents[f["name"]] = read_persona_file(f["name"])
    return {"files": files, "contents": contents}

@app.put("/api/persona")
async def update_persona(request: Request):
    body = await request.json()
    name = body.get("name", "")
    content = body.get("content", "")
    if not name:
        raise HTTPException(status_code=400, detail="File name required")
    write_persona_file(name, content)
    return {"status": "ok"}

@app.post("/api/persona/reset")
async def reset_persona_endpoint():
    reset_persona()
    return {"status": "reset"}

@app.get("/api/progress")
async def get_progress_endpoint():
    return get_progress()

@app.post("/api/progress/reset")
async def reset_progress_endpoint():
    reset_progress()
    return {"status": "reset"}

@app.get("/api/secrets")
async def get_secrets():
    return {"secrets": secrets_status()}

@app.put("/api/secrets")
async def update_secrets(request: Request):
    body = await request.json()
    key = body.get("key", "")
    value = body.get("value", "")
    if not key:
        raise HTTPException(status_code=400, detail="Key required")
    set_secret(key, value)
    return {"status": "ok"}

@app.delete("/api/secrets/{key}")
async def delete_secret(key: str):
    clear_secret(key)
    return {"status": "deleted"}

@app.get("/api/prompts")
async def get_prompts():
    config = load_prompts_config()
    defaults = get_all_defaults()
    merged = {**defaults, **config}
    return {"prompts": merged, "defaults": defaults}

@app.put("/api/prompts")
async def update_prompts(request: Request):
    body = await request.json()
    save_prompts_config(body)
    return {"status": "ok"}

@app.post("/api/prompts/reset")
async def reset_prompts():
    from prompts import PROMPTS_FILE
    if PROMPTS_FILE.exists():
        PROMPTS_FILE.unlink()
    return {"status": "reset"}

@app.get("/api/persona/status")
async def persona_status():
    files = list_persona_files()
    has_content = any(
        read_persona_file(f["name"]).strip()
        for f in files
        if f["name"] in ["SOUL.md", "IDENTITY.md"]
    )
    return {"bootstrapped": has_content, "file_count": len(files)}

@app.post("/api/cancel_run")
async def cancel_run(request: Request):
    body = await request.json()
    run_id = body.get("run_id", "")
    if run_id:
        RUN_CANCEL_FLAGS.add(run_id)
    return {"status": "cancelled"}
