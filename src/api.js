const API_PREFIX = '/api/v2'

export async function fetchCollection(resource, signal) {
  const response = await fetch(`${API_PREFIX}/${resource}/`, {
    headers: { Accept: 'application/json' },
    signal,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const detail = typeof body?.detail === 'string' ? body.detail : response.statusText
    throw new Error(`Unable to load ${resource.replaceAll('_', ' ')} (${response.status}): ${detail}`)
  }

  const data = await response.json()
  if (!Array.isArray(data)) {
    throw new Error(`The ${resource.replaceAll('_', ' ')} API returned an unexpected response.`)
  }

  return data
}
