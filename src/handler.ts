import { KV_STORAGE_PREFIX } from './consts'
import {
  canMatch,
  findAllValuesInJson,
  findLinkInHTML,
  generateResponse,
  isValidUrl,
  tryParse,
  updateStorage,
} from './utils'

const allowedDomains = ALLOWED_DOMAINS.split('|')

async function validateSource(src: string, dst: URL): Promise<number> {
  // Source page analysis
  const sourcePage = await fetch(String(src), {
    // TODO: limit redirect count
    redirect: 'follow',
    headers: {
      'User-Agent':
        'Workers-Webmention-Server/1.0; https://github.com/outloudvi/cf-workers-webmention-server',
    },
  }).catch((_) => undefined)

  if (!sourcePage) {
    return 500
  }

  const textIt = await sourcePage.text().catch(() => '')

  // Is it JSON?
  const jsonIt = tryParse(textIt)
  if (jsonIt) {
    return findAllValuesInJson(jsonIt, dst) ? 200 : 400
  }

  return findLinkInHTML(textIt, dst, src) ? 200 : 400
}

async function processWebmentionScan(request: Request): Promise<Response> {
  const formData = await request.formData().catch((_) => undefined)
  if (!formData) {
    return generateResponse(400, 'Invalid form data')
  }
  const src = String(formData.get('source') || '')
  const trg = String(formData.get('target') || '')
  if (!src) {
    return generateResponse(400, 'Source not found')
  }
  if (!trg) {
    return generateResponse(400, 'Target not found')
  }
  if (!isValidUrl(src)) {
    return generateResponse(400, 'Invalid source')
  }
  if (!isValidUrl(trg)) {
    return generateResponse(400, 'Invalid target')
  }

  const source = new URL(src)
  const target = new URL(trg)

  if (!canMatch(source.host, allowedDomains)) {
    return generateResponse(400, 'Target not allowed by this server')
  }

  source.hash = ''
  target.hash = ''

  const status = await validateSource(String(source), target)

  await updateStorage(String(source), String(target), status)

  switch (status) {
    case 200:
      return new Response(`Good link: ${String(source)} -> ${String(target)}`, {
        status: 200,
      })
    case 500:
      return new Response(
        `Internal server error: ${String(source)} -> ${String(target)}`,
        {
          status: 500,
        },
      )
    default:
      return new Response(`Bad link: ${String(source)} -> ${String(target)}`, {
        status: 400,
      })
  }
}

export async function handleRequest(request: Request): Promise<Response> {
  if (
    request.headers.get('Content-Type') === 'application/x-www-form-urlencoded'
  ) {
    // Webmention API
    return await processWebmentionScan(request)
  }

  if (request.method === 'GET') {
    // Webmention data API
    const req = new URL(request.url)
    const url = req.searchParams.get('url')
    if (url === null || !isValidUrl(url)) {
      return generateResponse(400, 'Bad request: invalid URL')
    }
    const urlObj = new URL(url)
    urlObj.hash = ''
    if (canMatch(urlObj.host, allowedDomains)) {
      const key = KV_STORAGE_PREFIX + String(urlObj)
      const val = (await KV.get(key)) || '[]'
      return new Response(val, {
        headers: {
          'Content-Type': 'application/json',
        },
      })
    } else {
      return generateResponse(400, 'Bad request: URL not in allowed list')
    }
  }

  return generateResponse(400, `Bad request`)
}
