import { Hono } from 'hono'
import { v3 as murmur3 } from 'murmurhash'
import base62 from 'base62'

const KV_PREFIX = 'shorten-url'

type Bindings = {
  KV: KVNamespace
  API_KEY: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.get('/', (c) => {
  return c.text('OK')
})

function generateShortUrl(url: string, salt: boolean = false): string {
  const hash = murmur3(url, salt ? Math.random() : 0)
  const shortCode = base62.encode(hash)
  return shortCode
}

app.post('/s', async (c) => {
  const apiKey = c.req.header('Authorization')
  if (apiKey !== c.env.API_KEY) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  let url: string
  const contentType = c.req.header('Content-Type')

  if (c.req.query('url')) {
    url = c.req.query('url') as string
  } else if (contentType === 'application/json') {
    const json = await c.req.json()
    url = json.url
  } else if (
    contentType === 'application/x-www-form-urlencoded' ||
    contentType?.startsWith('multipart/form-data')
  ) {
    const formData = await c.req.parseBody()
    url = formData.url as string
  } else {
    return c.json({ error: 'Unsupported Content-Type' }, 415)
  }

  if (!url || typeof url !== 'string') {
    return c.json({ error: 'Invalid URL' }, 400)
  }

  try {
    new URL(url)
  } catch (e) {
    return c.json({ error: 'Invalid URL' }, 400)
  }

  let shortCode = generateShortUrl(url)
  const existing = await c.env.KV.get(shortCode)
  if (existing && existing !== url) {
    shortCode = generateShortUrl(url, true)
    await c.env.KV.put(`${KV_PREFIX}:${shortCode}`, url)
  } else if (!existing) {
    await c.env.KV.put(`${KV_PREFIX}:${shortCode}`, url)
  }

  return c.json({
    shortCode,
    originalUrl: url,
    shortUrl: `${new URL(c.req.url).origin}/s/${shortCode}`,
  })
})

app.get('/s/:shortCode', async (c) => {
  const shortCode = `${KV_PREFIX}:${c.req.param('shortCode')}`
  const url = await c.env.KV.get(shortCode)

  if (!url) {
    return c.text('Not Found', 404)
  }

  return c.redirect(url, 301)
})

export default app
