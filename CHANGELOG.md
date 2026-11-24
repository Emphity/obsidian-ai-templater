# 1.0.33
### New
- Stronger API key encryption: keys are encrypted with a vault-specific random salt (`enc:v2`). Existing `enc:v1` keys are decrypted on the next successful unlock and re-encrypted automatically.
- Credentials are isolated per endpoint. Template calls cannot send the active endpoint's stored key to another endpoint, and an explicit empty API key means "send no credentials".
- Endpoints that do not require authentication can run chats without an API key, in addition to fetching models (for example Ollama and LM Studio).
- The selected model is remembered per endpoint. Switching endpoints restores that endpoint's model instead of reusing the previous one.
- Model refresh now distinguishes manual and remote model ids. Manual models are preserved while remote models that no longer exist are removed.
- SDK timeouts and AbortControllers now abort the request promise. Note: Obsidian's `requestUrl` cannot cancel the underlying network request after it has been sent.
- Settings text fields persist on blur or when Settings closes, and list operations write settings once. Model lists are rendered only when opened.
### No longer broken
- The endpoint API type selector can now be used before saving and is no longer reset to auto.
- The outgoing-character guard survives invalid or empty numeric input.
- Template messages are no longer mutated when a chat is sent.
- OpenAI `developer` messages are converted into Anthropic system instructions instead of being dropped.
- Anthropic requests no longer use the full context-window length as an output token limit.
- Renaming or removing endpoints/models keeps their cached models, selections and limits in sync.
- Disabling or unloading the plugin clears `window.ait`, the Templater module, pending timers and the in-memory unlock key.
### Internal
- Reduced bundle size by minifying production builds.
- Added reproducible installs with `package-lock.json`, pinned GitHub dependencies and full CI checks.
- Added regression tests for encryption, settings migration, provider selection and adapters.

# 1.0.32
### New
- Anthropic compatibility: endpoints using the native Anthropic Messages API (Claude models) are now supported. The API type is auto-detected from the endpoint URL and can be forced per endpoint with the new "API type" selector in the endpoint editor (Auto-detect / OpenAI compatible / Anthropic). Model listing uses the native Models API and captures each model's max output tokens and context window; the max tokens cascade uses them automatically, falling back to 4096 when a model reports no limit. `max_tokens` is required by Anthropic. OAuth access tokens (`sk-ant-oat...`) are supported via the Authorization header.
### No longer broken
- Include main.js file.
- Fixed: fetching models failed with a 401 when API keys were password-encrypted (the encrypted blob was sent as the API key instead of decrypting it first).
- Fixed: template runs could abort with a DOM `appendChild` error thrown by the activity indicator; the spinner is now built with standard DOM APIs and can no longer break a chat call.
- Fixed: Anthropic requests with the model's maximum `max_tokens` were rejected ("streaming is required for operations that may take longer than 10 minutes"); Anthropic chat now uses streaming internally and returns the complete response as before.

# 1.0.31
### New
- Added MaxTokens per model manual setting.

# 1.0.30
### Updates
- Endpoint and model are now selected from dropdown lists in Settings, so there is no need to type them by hand when switching setups.
- Endpoints support aliases (display names) and a per-endpoint API key; switching endpoints automatically loads the key saved for that endpoint. Legacy single-key settings are migrated on load.
- Fetch available models from the endpoint (refresh button next to the Model setting); the list is cached per endpoint. Manual models are preserved on refresh. The API key is optional: it is sent when configured, and requests go without credentials otherwise (e.g. Ollama/LM Studio).
- API keys are now encrypted at rest (AES-GCM 256 + PBKDF2-SHA256 via Web Crypto, no dependencies) with a versioned blob `enc:v1:<salt>:<iv>:<ciphertext>`. Includes an unlock modal on plugin load (plus an "Unlock API keys" command) and automatic migration of plaintext keys. While locked, chat/model fetch requests are sent without the key and the API Key setting is disabled. Debug logs no longer dump the full client.
- Fetch available models from the endpoint once and cache them, with a manual refresh button next to the Model setting. The API key is optional: it is sent when configured, and requests go without credentials otherwise (e.g. Ollama/LM Studio).
- Max tokens per request: per-model maximum with priority cascade. Model limits reported by the endpoint (`top_provider.max_completion_tokens`, `context_length`, `max_context_length`, `context_window`) are captured on refresh (OpenRouter includes them; OpenAI/Ollama do not). Resolution order when sending: template `maxTokens` (4th param of `tp.ai.chat`) > manual Max tokens per request (>0) > detected model maximum > omit `max_completion_tokens` (provider decides). The setting accepts 0 = auto, and the model list in Settings shows the detected maximum per model ("N tokens (detected)").
- Works with Opencode.

# 1.0.20
### Updates
- automated release

# 1.0.19
### Updates
- automated release

# 1.0.18
### Updates
- automated release

# 1.0.15
### Updates
- rolled back to gpt-4-turbo as default
- updated dependencies

# 1.0.14
### Updates
- update for support for gpt5
- updated dependencies
- fixed stylesheet issues

# 1.0.11

### Updates
- Updating plugin to newest Obsidian recommendations https://docs.obsidian.md/oo24/plugin.
- The internal command names have been renamed. Any plugins using these internal command names will need to be updated.
- Transition to Biome from EsLint and Prettier.
- The output log file format for when debugging is enabled in BRAT has changed. It now appends to the log file, not prepends.



# 1.0.10

- chore: update all dependencies.

# 1.0.9

- Minor adjustments have been made in preparation for release to the community plugin list.

# 1.0.6

- Restructured the API object of ait. All the helper classes have been moved to a child object named `helpers`. This modification makes the API object cleaner and more user-friendly.

# 1.0.5

- Added the OpneAI undocumented toFile function. This is useful for uploading files to OpenAI.

# 1.0.4

- Exposed the ActivityIndicator class, which creates the spinning indicator that can be used when the user is waiting for a response from the api.
- moved the global OpenAI object to be a child of the ait object.

# 1.0.3

- When the outgoint character count is exceeded, the notificaiton now includes the number of characters attempted to send to the api.
- Improved the github action build process
