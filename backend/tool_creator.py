import json
import re
from collections.abc import AsyncIterator

from llm_client import stream_chat_completion, extract_stream_delta
from prompts import get_prompt

async def plan_tool(user_request: str, existing_tools: list[dict], model: str) -> AsyncIterator[str]:
    system = get_prompt("forge_plan")
    tools_summary = "\n".join(f"- {t['name']}: {t['description']}" for t in existing_tools) if existing_tools else "None"
    user_msg = f"""Create a plan for a new tool based on this request:

{user_request}

Existing tools:
{tools_summary}

Respond with a JSON object containing:
- name: tool name (snake_case)
- description: what it does
- parameters: JSON Schema for inputs
- packages: list of pip packages needed (empty list if none)
- approach: implementation description"""

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_msg},
    ]

    full_response = ""
    async for chunk in stream_chat_completion(model, messages, temperature=0.3):
        delta = extract_stream_delta(chunk)
        if delta["content"]:
            full_response += delta["content"]
            yield delta["content"]
        if delta.get("finish_reason") == "error":
            yield f"\nError: {delta['content']}"
            return

def parse_tool_plan(text: str) -> dict | None:
    json_match = re.search(r'```(?:json)?\s*\n(.*?)\n```', text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass
    try:
        start = text.index('{')
        end = text.rindex('}') + 1
        return json.loads(text[start:end])
    except (ValueError, json.JSONDecodeError):
        pass
    return None

async def generate_tool_code(plan: dict, model: str) -> AsyncIterator[str]:
    system = get_prompt("forge_code")
    user_msg = f"""Generate complete Python code for this tool:

Name: {plan.get('name', 'unnamed')}
Description: {plan.get('description', '')}
Parameters: {json.dumps(plan.get('parameters', {}), indent=2)}
Packages needed: {plan.get('packages', [])}
Approach: {plan.get('approach', '')}

Generate:
1. The main tool code with a run(arguments: dict) -> dict function
2. Test code
3. A manifest JSON

Format your response as:
```python
# TOOL CODE
<code>
```

```python
# TEST CODE
<test code>
```

```json
# MANIFEST
{{
  "name": "...",
  "description": "...",
  "parameters": {{...}},
  "kind": "headless"
}}
```"""

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_msg},
    ]

    full_response = ""
    async for chunk in stream_chat_completion(model, messages, temperature=0.4):
        delta = extract_stream_delta(chunk)
        if delta["content"]:
            full_response += delta["content"]
            yield delta["content"]
        if delta.get("finish_reason") == "error":
            yield f"\nError: {delta['content']}"
            return

def parse_tool_code(response: str) -> dict | None:
    code_match = re.search(r'```python\s*\n# TOOL CODE\s*\n(.*?)```', response, re.DOTALL)
    test_match = re.search(r'```python\s*\n# TEST CODE\s*\n(.*?)```', response, re.DOTALL)
    manifest_match = re.search(r'```json\s*\n# MANIFEST\s*\n(.*?)```', response, re.DOTALL)

    if not code_match:
        code_match = re.search(r'```python\s*\n(.*?)```', response, re.DOTALL)

    if not code_match:
        return None

    code = code_match.group(1).strip()
    test_code = test_match.group(1).strip() if test_match else _default_test(code)
    manifest = {}
    if manifest_match:
        try:
            manifest = json.loads(manifest_match.group(1).strip())
        except json.JSONDecodeError:
            manifest = {}

    return {
        "code": code,
        "test_code": test_code,
        "manifest": manifest,
    }

def _default_test(code: str) -> str:
    return '''def test_run():
    result = run({})
    assert isinstance(result, dict)
    assert "result" in result
    print("Test passed!")

if __name__ == "__main__":
    test_run()
'''

async def revise_tool_plan(plan: dict, feedback: str, model: str) -> AsyncIterator[str]:
    system = get_prompt("forge_revise")
    user_msg = f"""Revise this tool plan based on feedback:

Current plan:
{json.dumps(plan, indent=2)}

User feedback:
{feedback}

Provide the revised plan as a JSON object with the same structure."""

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_msg},
    ]

    full_response = ""
    async for chunk in stream_chat_completion(model, messages, temperature=0.3):
        delta = extract_stream_delta(chunk)
        if delta["content"]:
            full_response += delta["content"]
            yield delta["content"]
        if delta.get("finish_reason") == "error":
            yield f"\nError: {delta['content']}"
            return

def extract_search_sources(text: str) -> list[dict]:
    sources = []
    url_pattern = re.compile(r'https?://[^\s\)\]>]+')
    for match in url_pattern.finditer(text):
        url = match.group(0)
        sources.append({"title": url, "url": url})
    return sources
