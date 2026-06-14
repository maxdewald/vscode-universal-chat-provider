const assert = require('node:assert/strict')
const http = require('node:http')
const process = require('node:process')
const vscode = require('vscode')

const EXTENSION_ID = 'maxdewald.modelprovider'

async function run() {
  const extension = vscode.extensions.getExtension(EXTENSION_ID)
  assert.ok(extension, `${EXTENSION_ID} was not installed`)
  const api = await extension.activate()
  assert.ok(api, 'The provider test API was not enabled')

  await testMockProxy(api)
  await testRealProxy(api)
  console.warn('CLIProxyAPI Model Provider integration tests passed.')
}

async function testMockProxy(api) {
  let responseRequest
  const server = http.createServer((request, response) => {
    if (request.url === '/v1/models?client_version=0.114.0') {
      return json(response, {
        models: [{
          slug: 'reasoning-test',
          display_name: 'Reasoning Test',
          context_window: 100000,
          max_context_window: 200000,
          supported_reasoning_levels: [
            { effort: 'low' },
            { effort: 'high' },
          ],
          default_reasoning_level: 'low',
        }],
      })
    }
    if (request.url === '/v1/models')
      return json(response, { data: [{ id: 'reasoning-test', owned_by: 'test' }] })
    if (request.url === '/v1/responses' && request.method === 'POST') {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', chunk => body += chunk)
      request.on('end', () => {
        responseRequest = JSON.parse(body)
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end([
          'event: response.output_text.delta',
          'data: {"type":"response.output_text.delta","delta":"mock-ok"}',
          '',
          'event: response.completed',
          'data: {"type":"response.completed","response":{"usage":{"output_tokens":1}}}',
          '',
          '',
        ].join('\n'))
      })
      return
    }
    response.writeHead(404).end()
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    const address = server.address()
    assert.equal(typeof address, 'object')
    await api.configure(`http://127.0.0.1:${address.port}`, 'test-key')
    const models = await api.models()
    assert.equal(models.length, 1)
    assert.deepEqual(models[0].reasoningLevels, ['low', 'high'])
    assert.deepEqual(
      models[0].configurationSchema.properties.reasoningEffort.enum,
      ['low', 'high'],
    )
    assert.equal(await api.request('reasoning-test', 'hello', 'high'), 'mock-ok')
    assert.equal(responseRequest.reasoning.effort, 'high')
    assert.ok(await api.countTokens('reasoning-test', 'hello world') > 0)
  }
  finally {
    await new Promise(resolve => server.close(resolve))
  }
}

async function testRealProxy(api) {
  const baseUrl = process.env.CLIPROXY_BASE_URL
  const apiKey = process.env.CLIPROXY_API_KEY
  assert.ok(baseUrl, 'CLIPROXY_BASE_URL is missing')
  assert.ok(apiKey, 'CLIPROXY_API_KEY is missing')

  await api.configure(baseUrl, apiKey)
  const models = await api.models()
  assert.ok(models.length > 0, 'CLIProxyAPI returned no chat models')
  for (const model of models) {
    assert.ok(model.maxInputTokens > 0)
    assert.ok(model.maxOutputTokens > 0)
  }

  const selected = models.find(model => /gpt|codex/i.test(model.id)) || models[0]
  assert.ok(await api.countTokens(selected.id, 'Reply with exactly: integration-ok') > 0)
  const response = await api.request(selected.id, 'Reply with exactly: integration-ok')
  assert.ok(response.trim().length > 0, `${selected.id} returned an empty response`)

  const publicModels = await vscode.lm.selectChatModels({ vendor: 'cliproxyapi' })
  assert.ok(publicModels.length > 0, 'The provider was not registered with vscode.lm')
}

function json(response, body) {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

module.exports = { run }
