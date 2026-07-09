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

Respond with ONLY a JSON object. No markdown, no explanation. Just the JSON."""

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
    brace_depth = 0
    start_idx = -1
    for i, ch in enumerate(text):
        if ch == '{':
            if brace_depth == 0:
                start_idx = i
            brace_depth += 1
        elif ch == '}':
            brace_depth -= 1
            if brace_depth == 0 and start_idx >= 0:
                try:
                    return json.loads(text[start_idx:i+1])
                except json.JSONDecodeError:
                    start_idx = -1
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
    code = _extract_code_block(response)
    if not code:
        return None

    test_code = _extract_test_block(response) or _default_test(code)
    manifest = _extract_manifest(response)

    return {
        "code": code,
        "test_code": test_code,
        "manifest": manifest,
    }

def _extract_code_block(response: str) -> str | None:
    code_blocks = []
    for m in re.finditer(r'```(?:python|py)?\s*\n(.*?)```', response, re.DOTALL):
        block = m.group(1).strip()
        if block:
            code_blocks.append(block)
    for block in code_blocks:
        if 'def run' in block:
            return block
    for block in code_blocks:
        if 'def ' in block and ('import' in block or 'return' in block):
            return block
    for block in code_blocks:
        if len(block) > 50 and ('import' in block or 'def ' in block):
            return block
    if code_blocks:
        return code_blocks[0]
    lines = response.split('\n')
    code_lines = []
    in_code = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith('```') and not in_code:
            in_code = True
            continue
        elif stripped == '```' and in_code:
            break
        elif in_code:
            code_lines.append(line)
    if code_lines:
        code = '\n'.join(code_lines).strip()
        if len(code) > 30:
            return code
    return None

def _extract_test_block(response: str) -> str | None:
    patterns = [
        r'```python\s*\n# TEST CODE\s*\n(.*?)```',
        r'```python\s*\n# ?test.*?\n(.*?)```',
    ]
    for pat in patterns:
        m = re.search(pat, response, re.DOTALL | re.IGNORECASE)
        if m:
            return m.group(1).strip()
    return None

def _extract_manifest(response: str) -> dict:
    patterns = [
        r'```json\s*\n# MANIFEST\s*\n(.*?)```',
        r'```json\s*\n(.*?)```',
    ]
    for pat in patterns:
        m = re.search(pat, response, re.DOTALL)
        if m:
            try:
                data = json.loads(m.group(1).strip())
                if isinstance(data, dict) and (data.get("name") or data.get("description")):
                    return data
            except json.JSONDecodeError:
                pass
    try:
        start = response.index('{')
        depth = 0
        for i in range(start, len(response)):
            if response[i] == '{': depth += 1
            elif response[i] == '}': depth -= 1
            if depth == 0:
                return json.loads(response[start:i+1])
    except (ValueError, json.JSONDecodeError):
        pass
    return {}

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
