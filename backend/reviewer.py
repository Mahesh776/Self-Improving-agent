import ast
import json
import re
import traceback
from collections.abc import AsyncIterator

from llm_client import stream_chat_completion, extract_stream_delta
from prompts import get_prompt


async def review_code(code: str, test_code: str, plan: dict, model: str) -> AsyncIterator[str]:
    system = get_prompt("forge_review")
    user_msg = f"""Review this Python tool code for errors, bugs, and bad practices.

Tool name: {plan.get('name', 'unknown')}
Description: {plan.get('description', '')}

CODE:
```python
{code}
```

TEST CODE:
```python
{test_code}
```

Check for:
1. Syntax errors
2. Missing imports
3. Wrong function signatures (must have `run(arguments: dict) -> dict`)
4. Missing error handling
5. Logic bugs
6. Security issues
7. Does run() return a dict with "result" key?

If code is GOOD, respond with ONLY: {{"status": "ok"}}
If code has ERRORS, respond with ONLY: {{"status": "errors", "issues": ["issue1", "issue2"], "fixed_code": "corrected code here"}}

NO explanation. ONLY the JSON."""

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_msg},
    ]

    full_response = ""
    async for chunk in stream_chat_completion(model, messages, temperature=0.2):
        delta = extract_stream_delta(chunk)
        if delta["content"]:
            full_response += delta["content"]
            yield delta["content"]
        if delta.get("finish_reason") == "error":
            yield f"\nError: {delta['content']}"
            return


def parse_review_result(text: str) -> dict:
    try:
        start = text.index('{')
        depth = 0
        for i in range(start, len(text)):
            if text[i] == '{':
                depth += 1
            elif text[i] == '}':
                depth -= 1
            if depth == 0:
                return json.loads(text[start:i+1])
    except (ValueError, json.JSONDecodeError):
        pass

    json_match = re.search(r'\{[^{}]*"status"\s*:\s*"(ok|errors)"[^{}]*\}', text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(0))
        except json.JSONDecodeError:
            pass

    if '"status": "ok"' in text or '"status":"ok"' in text:
        return {"status": "ok"}

    return {"status": "unknown", "raw": text[:500]}


def static_check_code(code: str) -> list[str]:
    issues = []
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        issues.append(f"Syntax error at line {e.lineno}: {e.msg}")
        return issues

    has_run = False
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "run":
            has_run = True
            args = node.args.args
            if len(args) != 1:
                issues.append(f"run() must have exactly 1 argument (arguments: dict), found {len(args)}")
            break

    if not has_run:
        issues.append("Missing required `run(arguments: dict) -> dict` function")

    if "import " not in code and "from " not in code:
        if "requests" in code or "urllib" in code:
            issues.append("Using HTTP libraries but missing import statement")

    if "subprocess" in code and "shell=True" in code:
        issues.append("Security: shell=True in subprocess is dangerous")

    if "eval(" in code or "exec(" in code:
        issues.append("Security: eval/exec usage detected - potential security risk")

    if "os.system(" in code:
        issues.append("Security: os.system() usage - prefer subprocess")

    return issues
