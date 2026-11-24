# Intro

This plugin extends Templater to interact with large language models. It works with OpenAI-compatible endpoints (OpenAI, OpenRouter, Ollama, LM Studio, OpenCode, and similar services) and with native Anthropic endpoints through the Anthropic Messages API.

For example, in Templater, you can use the following command to ask your selected provider's model a question:

`<%tp.ai.chat("Is it cloudy today?")%>`

For detailed instructions on the use of this plugin, please see: [https://tfthacker.com/AIT]

# How it works?
## Pre-requisites
[Templater plugin](https://community.obsidian.md/plugins/templater-obsidian)

## How to use?
1. Install and enable the plugin.
2. Set or unlock a password before saving an API key. This password protects API keys at rest and is not recoverable.
3. Configure and select your providers' endpoints, API keys and models. The API key is optional for endpoints that do not require authentication, such as local Ollama or LM Studio servers.
4. Use await tp.ai.chat() inside a template.
5. Trigger the template and see the results.

### Examples
Append the response directly on the note:
```javascript
<% tR += await tp.ai.chat('What should I ask myself today?') %>
```

Assign the response to a const:
```javascript
<%* const response = await tp.ai.chat('Say a gigachad phrase to write in a poster') 
tR += '> ' + response -%>
```

### tp.ai.chat parameters
```javascript
await tp.ai.chat(
  promptOrMessages,
  model,
  systemMessage,
  maxTokens,
  maxOutgoingCharacters,
  baseURL,
  apiKey,
  organization,
)
```

- `promptOrMessages`: a prompt string or an OpenAI-style messages array.
- `model`: optional model id; defaults to the selected model in Settings.
- `systemMessage`: optional override for the default system message.
- `maxTokens`: optional output token limit for this request.
- `maxOutgoingCharacters`: optional character guard for this request.
- `baseURL`: optional endpoint URL. Stored API keys are never sent to an endpoint other than the endpoint they belong to.
- `apiKey`: optional key for this request. Passing an empty string explicitly means "send no credentials".
- `organization`: optional OpenAI organization id.

When `maxTokens` is omitted, the request uses this cascade:

`maxTokens from tp.ai.chat` > `Max tokens per request` in Settings > detected output-token maximum for the model > omit the field and let the provider decide.

The per-model "Max tokens" value in Settings is informational. It is useful as a personal reference when an endpoint does not report model limits, and it is not sent as `max_completion_tokens`.

## Checked compatible endpoints
- OpenCode
- OpenAI
- Anthropic
- OpenRouter
- Ollama
- LMStudio
# Future implementations/fixes
## Planned
- [ ] Jev compatibility
- [ ] Tool calling

## Completed
- [x] Per-model max token reference
  - For endpoints that do not report model limits.
- [x] Anthropic compatibility

# Ways to connect with the creator and more information on his work

You can find him on Twitter [@TfTHacker](https://x.com/TfTHacker)

His website https://tfthacker.com/
