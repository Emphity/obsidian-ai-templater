# Intro

This plugin extends Templater to interact with large language models. It is primarily designed to work with OpenAI LLMs, like the ones used by ChatGPT, but is also compatible with any LLM that supports the OpenAI API.

For example, in Templater, you can use the following command to ask your selected provider's model a question:

`<%tp.ai.chat("Is it cloudy today?")%>`

For detailed instructions on the use of this plugin, please see: [https://tfthacker.com/AIT]

Works with OpenAI API compatible endpoints.

# How it works?
## Pre-requisites
[Templater plugin](https://community.obsidian.md/plugins/templater-obsidian)

## How to use?
1. Install and enable the plugin.
2. Configure and select your providers' endpoints, API keys and models.
3. Set a password.
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

## Checked compatible endpoints
- OpenCode
- OpenAI
- OpenRouter
- Ollama
- LMStudio
# Future implementations/fixes
## Planned
- [ ] Manually edit MaxTokens per model
  - For those endpoints that don't "share" it.
- [ ] Jev compatibility
- [ ] Anthropic compatibility
- [ ] Tool calling

## Completed

# Ways to connect with the creator and more information on his work

You can find him on Twitter [@TfTHacker](https://x.com/TfTHacker)

His website https://tfthacker.com/
