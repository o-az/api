import { apiLogger } from '#/logger.ts'
import type { Address } from '#/types'

export function raise(error: unknown): never {
  throw typeof error === 'string' ? new Error(error) : error
}

export function isAddress(address: string): address is Address {
  return /^0x[a-fA-F0-9]{40}$/.test(address)
}

export function ensureArray<T>(value: T | Array<T>): Array<T> {
  return Array.isArray(value) ? value : [value]
}

// removed properties with undefined values from object
export function removeUndefined<T>(object: T): T {
  return JSON.parse(JSON.stringify(object)) as T
}

export async function fetcher<T>(url: string, options?: RequestInit) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...options?.headers }
  })
  if (!response.ok) {
    apiLogger.error(`Failed to fetch ${url}: ${response.statusText} - ${await response.text()}`)
    raise(await response.text())
  }
  const data = (await response.json()) as T
  return data
}
