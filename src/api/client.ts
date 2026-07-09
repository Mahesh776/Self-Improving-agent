const API_BASE = '/api';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  kind?: string;
}

export interface Model {
  id: string;
  name: string;
  provider: string;
}

export interface Plan {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  packages: string[];
  approach: string;
}

export interface Progress {
  xp: number;
  level: number;
  rank: string;
  xp_in_level: number;
  xp_to_next: number;
  skills_unlocked: number;
  chat_count: number;
}

export interface SecretStatus {
  key: string;
  configured: boolean;
  preview: string;
}

async function fetchJSON(url: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Request failed');
  }
  return res.json();
}

export async function getConfig() {
  return fetchJSON('/config');
}

export async function getModels(): Promise<{ models: Model[] }> {
  return fetchJSON('/models');
}

export async function getTools(): Promise<{ tools: Tool[] }> {
  return fetchJSON('/tools');
}

export async function deleteTool(name: string) {
  return fetchJSON(`/tools/${name}`, { method: 'DELETE' });
}

export async function getProgress(): Promise<Progress> {
  return fetchJSON('/progress');
}

export async function resetProgress() {
  return fetchJSON('/progress/reset', { method: 'POST' });
}

export async function getPersona() {
  return fetchJSON('/persona');
}

export async function updatePersona(name: string, content: string) {
  return fetchJSON('/persona', {
    method: 'PUT',
    body: JSON.stringify({ name, content }),
  });
}

export async function resetPersona() {
  return fetchJSON('/persona/reset', { method: 'POST' });
}

export async function getSecrets(): Promise<{ secrets: SecretStatus[] }> {
  return fetchJSON('/secrets');
}

export async function setSecret(key: string, value: string) {
  return fetchJSON('/secrets', {
    method: 'PUT',
    body: JSON.stringify({ key, value }),
  });
}

export async function deleteSecret(key: string) {
  return fetchJSON(`/secrets/${key}`, { method: 'DELETE' });
}

export async function getPrompts() {
  return fetchJSON('/prompts');
}

export async function updatePrompts(prompts: Record<string, string>) {
  return fetchJSON('/prompts', {
    method: 'PUT',
    body: JSON.stringify(prompts),
  });
}

export async function resetPrompts() {
  return fetchJSON('/prompts/reset', { method: 'POST' });
}

export function streamChat(
  messages: ChatMessage[],
  model: string,
  onContent: (text: string) => void,
  onToolCalls: (calls: ToolCall[]) => void,
  onToolResult: (tool: string, result: unknown) => void,
  onDone: () => void,
  onError: (err: string) => void,
) {
  const runId = crypto.randomUUID();
  const controller = new AbortController();

  fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, model, run_id: runId }),
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      onError(err.detail || 'Chat request failed');
      return;
    }
    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'content') onContent(parsed.content);
          else if (parsed.type === 'tool_calls') onToolCalls(parsed.tool_calls);
          else if (parsed.type === 'tool_result') onToolResult(parsed.tool, parsed.result);
          else if (parsed.type === 'done') onDone();
          else if (parsed.type === 'error') onError(parsed.content);
        } catch {}
      }
    }
  }).catch((err) => {
    if (err.name !== 'AbortError') onError(err.message);
  });

  return controller;
}

export function streamProposeTool(
  request: string,
  model: string,
  onChunk: (text: string) => void,
  onPlan: (planId: string, plan: Plan) => void,
  onError: (err: string) => void,
) {
  const controller = new AbortController();

  fetch(`${API_BASE}/propose_tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request, model }),
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok) {
      onError('Propose tool request failed');
      return;
    }
    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const parsed = JSON.parse(line.slice(6));
          if (parsed.type === 'plan_chunk') onChunk(parsed.content);
          else if (parsed.type === 'plan_ready') onPlan(parsed.plan_id, parsed.plan);
          else if (parsed.type === 'error') onError(parsed.content);
        } catch {}
      }
    }
  }).catch((err) => {
    if (err.name !== 'AbortError') onError(err.message);
  });

  return controller;
}

export function streamApproveTool(
  planId: string,
  model: string,
  onPhase: (phase: string, status: string, message?: string) => void,
  onComplete: (toolName: string) => void,
  onFailed: (error: string) => void,
  onDone: (success: boolean) => void,
) {
  const controller = new AbortController();

  fetch(`${API_BASE}/approve_tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan_id: planId, model }),
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok) {
      onFailed('Approve tool request failed');
      return;
    }
    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const parsed = JSON.parse(line.slice(6));
          if (parsed.type === 'phase') onPhase(parsed.phase, parsed.status, parsed.message);
          else if (parsed.type === 'build_complete') onComplete(parsed.tool_name);
          else if (parsed.type === 'build_failed') onFailed(parsed.error);
          else if (parsed.type === 'done') onDone(parsed.success);
        } catch {}
      }
    }
  }).catch((err) => {
    if (err.name !== 'AbortError') onFailed(err.message);
  });

  return controller;
}

export function streamForgeProgress(
  jobId: string,
  onProgress: (phase: string, status: string, message: string) => void,
  onDone: (status: string, result: unknown) => void,
  onError: (message: string) => void,
) {
  const controller = new AbortController();

  fetch(`${API_BASE}/forge/${jobId}/progress`, {
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok) {
      onError('Failed to connect to forge progress');
      return;
    }
    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const parsed = JSON.parse(line.slice(6));
          if (parsed.type === 'progress') onProgress(parsed.phase, parsed.status, parsed.message);
          else if (parsed.type === 'done') onDone(parsed.status, parsed.result);
          else if (parsed.type === 'error') onError(parsed.message);
        } catch {}
      }
    }
  }).catch((err) => {
    if (err.name !== 'AbortError') onError(err.message);
  });

  return controller;
}

export async function getForgeJob(jobId: string) {
  return fetchJSON(`/forge/${jobId}`);
}

export async function getForgeJobs() {
  return fetchJSON('/forge/jobs');
}
