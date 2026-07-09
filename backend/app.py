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
from secrets import apply_secrets_to_environ, secrets_status, set_secret, clear_secret

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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

@app.get("/api/models")
async def get_models():
    models = []
    if os.environ.get("OPENROUTER_API_KEY"):
        models.extend([
            {"id": "openai/gpt-4o", "name": "GPT-4o", "provider": "openrouter"},
            {"id": "openai/gpt-4o-mini", "name": "GPT-4o Mini", "provider": "openrouter"},
            {"id": "anthropic/claude-3.5-sonnet", "name": "Claude 3.5 Sonnet", "provider": "openrouter"},
            {"id": "anthropic/claude-3-haiku", "name": "Claude 3 Haiku", "provider": "openrouter"},
            {"id": "meta-llama/llama-3.1-70b-instruct", "name": "Llama 3.1 70B", "provider": "openrouter"},
            {"id": "google/gemini-2.0-flash-001", "name": "Gemini 2.0 Flash", "provider": "openrouter"},
        ])
    if os.environ.get("GEMINI_API_KEY"):
        models.extend([
            {"id": "gemini/gemini-2.0-flash", "name": "Gemini 2.0 Flash", "provider": "gemini"},
            {"id": "gemini/gemini-1.5-pro", "name": "Gemini 1.5 Pro", "provider": "gemini"},
            {"id": "gemini/gemini-1.5-flash", "name": "Gemini 1.5 Flash", "provider": "gemini"},
        ])
    return {"models": models}

@app.post("/api/chat")
async def chat(request: Request):
    body = await request.json()
    messages = body.get("messages", [])
    model = body.get("model", os.environ.get("SCOUT_MODEL", "openai/gpt-4o-mini"))
    run_id = body.get("run_id", str(uuid.uuid4()))

    tools = list_tools()
    llm_tools = format_tools_for_llm(tools) if tools else None

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

                if not tool_exists(func_name):
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
