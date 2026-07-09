import json
import os
import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx

OPENROUTER_BASE = "https://openrouter.ai/api/v1"
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"

SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
}

def get_openrouter_key() -> str:
    return os.environ.get("OPENROUTER_API_KEY", "")

def get_gemini_key() -> str:
    return os.environ.get("GEMINI_API_KEY", "")

def is_gemini_model(model: str) -> bool:
    return model.startswith("gemini/")

def resolve_model_provider(model: str) -> str:
    if is_gemini_model(model):
        return "gemini"
    return "openrouter"

async def stream_chat_completion(
    model: str,
    messages: list[dict],
    tools: list[dict] | None = None,
    *,
    temperature: float = 0.7,
    max_tokens: int = 4096,
) -> AsyncIterator[dict]:
    provider = resolve_model_provider(model)
    if provider == "gemini":
        async for chunk in _stream_gemini(model, messages, tools, temperature, max_tokens):
            yield chunk
    else:
        async for chunk in _stream_openrouter(model, messages, tools, temperature, max_tokens):
            yield chunk

async def _stream_openrouter(
    model: str,
    messages: list[dict],
    tools: list[dict] | None,
    temperature: float,
    max_tokens: int,
) -> AsyncIterator[dict]:
    api_key = get_openrouter_key()
    if not api_key:
        yield {"error": "OPENROUTER_API_KEY not set"}
        return

    or_model = model
    # OpenRouter models keep their full ID (e.g. google/gemini-2.0-flash-exp:free)
    # Only prefix if it looks like a bare model name without provider
    if "/" not in or_model:
        or_model = f"openai/{model}"

    payload: dict[str, Any] = {
        "model": or_model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/manus-agent",
        "X-Title": "ManusAgent",
    }

    async with httpx.AsyncClient(timeout=120) as client:
        async with client.stream(
            "POST",
            f"{OPENROUTER_BASE}/chat/completions",
            json=payload,
            headers=headers,
        ) as response:
            if response.status_code != 200:
                body = await response.aread()
                yield {"error": f"OpenRouter error {response.status_code}: {body.decode()[:500]}"}
                return
            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data_str = line[6:]
                if data_str.strip() == "[DONE]":
                    yield {"done": True}
                    return
                try:
                    chunk = json.loads(data_str)
                    yield chunk
                except json.JSONDecodeError:
                    continue

async def _stream_gemini(
    model: str,
    messages: list[dict],
    tools: list[dict] | None,
    temperature: float,
    max_tokens: int,
) -> AsyncIterator[dict]:
    api_key = get_gemini_key()
    if not api_key:
        yield {"error": "GEMINI_API_KEY not set"}
        return

    gemini_model = model.replace("gemini/", "")
    url = f"{GEMINI_BASE}/models/{gemini_model}:streamGenerateContent?alt=sse&key={api_key}"

    contents = _convert_messages_to_gemini(messages)
    payload: dict[str, Any] = {
        "contents": contents,
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
        },
    }

    if tools:
        gemini_tools = _convert_tools_to_gemini(tools)
        if gemini_tools:
            payload["tools"] = gemini_tools

    async with httpx.AsyncClient(timeout=120) as client:
        async with client.stream("POST", url, json=payload) as response:
            if response.status_code != 200:
                body = await response.aread()
                yield {"error": f"Gemini error {response.status_code}: {body.decode()[:500]}"}
                return
            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data_str = line[6:]
                try:
                    chunk = json.loads(data_str)
                    yield _convert_gemini_chunk(chunk)
                except json.JSONDecodeError:
                    continue
            yield {"done": True}

def _convert_messages_to_gemini(messages: list[dict]) -> list[dict]:
    contents = []
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role == "system":
            contents.insert(0, {
                "role": "user",
                "parts": [{"text": content}],
            })
            contents.insert(1, {
                "role": "model",
                "parts": [{"text": "Understood."}],
            })
        elif role == "assistant":
            contents.append({
                "role": "model",
                "parts": [{"text": content or ""}],
            })
        else:
            contents.append({
                "role": "user",
                "parts": [{"text": content or ""}],
            })
    return contents

def _convert_tools_to_gemini(tools: list[dict]) -> list[dict]:
    functions = []
    for tool in tools:
        if tool.get("type") == "function":
            func = tool.get("function", {})
            functions.append({
                "functionDeclarations": [{
                    "name": func.get("name", ""),
                    "description": func.get("description", ""),
                    "parameters": func.get("parameters", {}),
                }]
            })
    return [{"functionDeclarations": [f["functionDeclarations"][0]] for f in functions}] if functions else []

def _convert_gemini_chunk(chunk: dict) -> dict:
    try:
        candidates = chunk.get("candidates", [])
        if not candidates:
            return {}
        content = candidates[0].get("content", {})
        parts = content.get("parts", [])
        text = ""
        tool_calls = []
        for part in parts:
            if "text" in part:
                text += part["text"]
            if "functionCall" in part:
                fc = part["functionCall"]
                tool_calls.append({
                    "id": f"call_{uuid.uuid4().hex[:8]}",
                    "type": "function",
                    "function": {
                        "name": fc.get("name", ""),
                        "arguments": json.dumps(fc.get("args", {})),
                    },
                })
        result = {}
        if text:
            result["choices"] = [{"delta": {"content": text}}]
        if tool_calls:
            result["choices"] = result.get("choices", []) + [{"delta": {"tool_calls": tool_calls}}]
        return result
    except Exception:
        return {}

def extract_stream_delta(chunk: dict) -> dict:
    content = ""
    tool_calls = []
    finish_reason = None
    if "error" in chunk:
        return {"content": f"Error: {chunk['error']}", "tool_calls": [], "finish_reason": "error"}
    choices = chunk.get("choices", [])
    if not choices:
        return {"content": "", "tool_calls": [], "finish_reason": None}
    delta = choices[0].get("delta", {})
    content = delta.get("content", "") or ""
    tc = delta.get("tool_calls", [])
    if tc:
        tool_calls = tc
    finish_reason = choices[0].get("finish_reason")
    return {"content": content, "tool_calls": tool_calls, "finish_reason": finish_reason}

def format_tools_for_llm(tools: list[dict]) -> list[dict]:
    formatted = []
    for tool in tools:
        formatted.append({
            "type": "function",
            "function": {
                "name": tool.get("name", ""),
                "description": tool.get("description", ""),
                "parameters": tool.get("parameters", {"type": "object", "properties": {}}),
            },
        })
    return formatted
