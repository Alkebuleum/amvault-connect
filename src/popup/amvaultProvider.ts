import { preOpenAmvaultPopup, closeSharedPopup } from './amvaultPopup'
import type { SigninResp, SendTxResp, SignMessageResp, SignMessageArgs } from '../types'

const STORAGE_FALLBACK_KEYS = ['amid:lastResult', 'amvault:payload']

function base64url(json: unknown): string {
  const s = btoa(unescape(encodeURIComponent(JSON.stringify(json))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return s
}

function makeNonce(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('')
}

function requestPopup<T = any>({
  method,
  app,
  chainId,
  origin,
  amvaultUrl,
  payload,
  nonce = makeNonce(),
  timeoutMs = 120000,
  debug = false,
}: {
  method: 'signin' | 'eth_sendTransaction' | 'sign_message'
  app: string
  chainId: number
  origin: string
  amvaultUrl: string
  payload?: any
  nonce?: string
  timeoutMs?: number
  debug?: boolean
}): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(amvaultUrl)

      // IMPORTANT:
      // Your AmVault app routes message signing via the same entry as signin.
      // So sign_message must still open AmVault with method=signin.
      const amvaultMethod = method === 'sign_message' ? 'signin' : method

      url.searchParams.set('method', amvaultMethod)
      url.searchParams.set('app', app)
      url.searchParams.set('chainId', String(chainId))
      url.searchParams.set('origin', origin)
      url.searchParams.set('nonce', nonce)
      url.searchParams.set('redirect', 'postmessage')
      if (payload) url.searchParams.set('payload', base64url(payload))

      const popup = preOpenAmvaultPopup()
      if (!popup) return reject(new Error('Popup blocked'))

      try {
        popup.location.href = url.toString()
      } catch {
        popup.location.assign(url.toString())
      }

      let settled = false
      let timer: number | undefined
      const amvaultOrigin = url.origin

      const cleanup = () => {
        if (timer) window.clearTimeout(timer)
        window.removeEventListener('message', onMsg as any)
        window.removeEventListener('storage', onStorage as any)
        try {
          closeSharedPopup()
        } catch { }
      }

      const finishOk = (data: any) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(data as T)
      }

      const finishErr = (err: any) => {
        if (settled) return
        settled = true
        cleanup()
        reject(err instanceof Error ? err : new Error(String(err)))
      }

      const onMsg = (ev: MessageEvent) => {
        if (amvaultOrigin && ev.origin !== amvaultOrigin) return
        if (ev.source !== popup) return
        const data = ev.data
        if (!data) return
        if (debug) console.log('[amvault][pm]', data)

        // signin AND sign_message both return amvault:auth
        if ((method === 'signin' || method === 'sign_message') && data.type === 'amvault:auth') {
          return finishOk(data)
        }

        if (method === 'eth_sendTransaction' && data.type === 'amvault:tx') {
          return finishOk(data)
        }

        if (data.type === 'amvault:error') {
          return finishErr(new Error(data.error || 'Request rejected'))
        }
      }
      window.addEventListener('message', onMsg as any)

      const onStorage = (ev: StorageEvent) => {
        if (!ev.key || !STORAGE_FALLBACK_KEYS.includes(ev.key)) return
        if (!ev.newValue) return
        try {
          const data = JSON.parse(ev.newValue)
          if (debug) console.log('[amvault][storage]', data)

          if ((method === 'signin' || method === 'sign_message') && data?.type === 'amvault:auth') {
            return finishOk(data)
          }

          if (method === 'eth_sendTransaction' && data?.type === 'amvault:tx') {
            return finishOk(data)
          }

          if (data?.type === 'amvault:error') {
            return finishErr(new Error(data.error || 'Request rejected'))
          }
        } catch { }
      }
      window.addEventListener('storage', onStorage as any)

      timer = window.setTimeout(() => finishErr(new Error('Timed out waiting for AmVault')), timeoutMs)
    } catch (e) {
      reject(e)
    }
  })
}

export async function openSignin(args: {
  app: string
  chainId: number
  origin: string
  nonce: string
  amvaultUrl: string
  debug?: boolean
  message?: string
}): Promise<SigninResp> {
  const payload = args.message ? { message: args.message } : undefined
  return requestPopup<SigninResp>({
    method: 'signin',
    app: args.app,
    chainId: args.chainId,
    origin: args.origin,
    amvaultUrl: args.amvaultUrl,
    nonce: args.nonce,
    debug: !!args.debug,
    payload,
  })
}

// NEW: open a sign-message popup flow.
// Note: it still loads AmVault with method=signin, but we mark locally as sign_message.
export async function openSignMessage(args: {
  app: string
  chainId: number
  origin: string
  nonce: string
  amvaultUrl: string
  debug?: boolean
  message: string
}): Promise<SignMessageResp> {
  return requestPopup<SignMessageResp>({
    method: 'sign_message',
    app: args.app,
    chainId: args.chainId,
    origin: args.origin,
    amvaultUrl: args.amvaultUrl,
    nonce: args.nonce,
    debug: !!args.debug,
    payload: { message: args.message },
  })
}

// NEW: high-level helper like sendTransaction()
export async function signMessage(
  req: SignMessageArgs,
  opts: { app: string; amvaultUrl: string; timeoutMs?: number; debug?: boolean }
): Promise<string> {
  const origin = window.location.origin
  const nonce = makeNonce()

  const resp = await openSignMessage({
    app: opts.app,
    chainId: req.chainId,
    origin,
    nonce,
    amvaultUrl: opts.amvaultUrl,
    debug: !!opts.debug,
    message: req.message,
  })

  if (!resp?.ok) throw new Error(resp?.error || 'Sign rejected')
  if (!resp.signature) throw new Error('No signature returned from AmVault')
  return resp.signature
}

export async function sendTransaction(
  req: {
    chainId: number
    to?: string
    data?: string
    value?: string | number | bigint
    gas?: number
    maxFeePerGasGwei?: number
    maxPriorityFeePerGasGwei?: number
  },
  opts: { app: string; amvaultUrl: string; timeoutMs?: number; debug?: boolean }
): Promise<string> {
  const origin = window.location.origin
  const payload = {
    to: req.to,
    value: req.value,
    data: req.data,
    gas: req.gas,
    maxFeePerGasGwei: req.maxFeePerGasGwei,
    maxPriorityFeePerGasGwei: req.maxPriorityFeePerGasGwei,
  }

  const resp = await requestPopup<SendTxResp>({
    method: 'eth_sendTransaction',
    app: opts.app,
    chainId: req.chainId,
    origin,
    amvaultUrl: opts.amvaultUrl,
    payload,
    timeoutMs: opts.timeoutMs ?? 120000,
    debug: !!opts.debug,
  })

  if (!resp.ok) throw new Error(resp.error || 'Transaction rejected')
  if (!resp.txHash) throw new Error('No txHash returned from AmVault')
  return resp.txHash
}
