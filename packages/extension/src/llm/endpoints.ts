/**
 * Endpoint resolution per official API specifications.
 *
 * Each API family defines its endpoints as paths relative to a base URL
 * (the convention used by the official SDKs — e.g. the OpenAI SDK's `baseURL`):
 *
 *  - OpenAI Chat Completions API:  POST {base}/chat/completions   (base ends in /v1)
 *  - OpenAI Responses API:         POST {base}/responses          (base ends in /v1)
 *  - Anthropic Messages API:       POST {base}/messages           (base ends in /v1)
 *  - Google Gemini:                officially exposed through an OpenAI-compatible
 *                                  base (https://generativelanguage.googleapis.com/v1beta/openai),
 *                                  so it rides the Chat Completions spec.
 *
 * Users routinely paste the FULL endpoint URL into the Base URL field. Per spec the
 * endpoint path is fixed, so if the pasted URL already ends with the canonical path
 * we treat everything before it as the base instead of doubling the path.
 */

function join(baseUrl: string, canonicalPath: string): string {
  let base = baseUrl.trim().replace(/\/+$/, '');
  const lower = base.toLowerCase();
  if (lower.endsWith(canonicalPath)) {
    base = base.slice(0, base.length - canonicalPath.length).replace(/\/+$/, '');
  }
  return `${base}${canonicalPath}`;
}

/** OpenAI Chat Completions API (OpenAI, DeepSeek, Qwen, GLM, Kimi, Ollama, Gemini-compat, gateways). */
export const chatCompletionsUrl = (baseUrl: string): string => join(baseUrl, '/chat/completions');

/** OpenAI Responses API. */
export const responsesUrl = (baseUrl: string): string => join(baseUrl, '/responses');

/** Anthropic Messages API. */
export const anthropicMessagesUrl = (baseUrl: string): string => join(baseUrl, '/messages');
