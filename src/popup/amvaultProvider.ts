import { preOpenAmvaultPopup, closeSharedPopup } from './amvaultPopup'
import type { SigninResp, SendTxResp } from '../types'

const STORAGE_FALLBACK_KEYS = ['amid:lastResult', 'amvault:payload']

function base64url(json: unknown): string {
  const s = btoa(unescape(encodeURIComponent(JSON.stringify(json))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return s
}

function makeNonce(): string {
  const b = new Uint8Array(16); crypto.getRandomValues(b)
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')
}

function requestPopup<T = any>({
  method,
  app,
  chainId,
  origin,
  amvaultUrl,
  payload,
  nonce = makeNonce(),
  timeoutMs = 50000,
  debug = false
}: {
  method: 'signin' | 'eth_sendTransaction',
  app: string,
  chainId: number,
  origin: string,
  amvaultUrl: string,
  payload?: any,
  nonce?: string,
  timeoutMs?: number,
  debug?: boolean
}): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(amvaultUrl)
      url.searchParams.set('method', method)
      url.searchParams.set('app', app)
      url.searchParams.set('chainId', String(chainId))
      url.searchParams.set('origin', origin)
      url.searchParams.set('nonce', nonce)
      url.searchParams.set('redirect', 'postmessage')
      if (payload) url.searchParams.set('payload', base64url(payload))

      const popup = preOpenAmvaultPopup()
      if (!popup) return reject(new Error('Popup blocked'))
      try { popup.location.href = url.toString() } catch { popup.location.assign(url.toString()) }

      let settled = false
      let timer: number | undefined
      const amvaultOrigin = url.origin

      const cleanup = () => {
        if (timer) window.clearTimeout(timer)
        window.removeEventListener('message', onMsg as any)
        window.removeEventListener('storage', onStorage as any)
        try { closeSharedPopup() } catch {}
      }
      const finishOk = (data: any) => { if (settled) return; settled = true; cleanup(); resolve(data as T) }
      const finishErr = (err: any) => { if (settled) return; settled = true; cleanup(); reject(err instanceof Error? err : new Error(String(err))) }

      const onMsg = (ev: MessageEvent) => {
        if (amvaultOrigin && ev.origin !== amvaultOrigin) return
        if (ev.source !== popup) return
        const data = ev.data
        if (!data) return
        if (debug) console.log('[amvault][pm]', data)
        if (method === 'signin' && data.type === 'amvault:auth') return finishOk(data)
        if (method === 'eth_sendTransaction' && data.type === 'amvault:tx') return finishOk(data)
        if (data.type === 'amvault:error') return finishErr(new Error(data.error || 'Request rejected'))
      }
      window.addEventListener('message', onMsg as any)

      const onStorage = (ev: StorageEvent) => {
        if (!ev.key || !STORAGE_FALLBACK_KEYS.includes(ev.key)) return
        if (!ev.newValue) return
        try {
          const data = JSON.parse(ev.newValue)
          if (debug) console.log('[amvault][storage]', data)
          if (method === 'signin' && data?.type === 'amvault:auth') return finishOk(data)
          if (method === 'eth_sendTransaction' && data?.type === 'amvault:tx') return finishOk(data)
          if (data?.type === 'amvault:error') return finishErr(new Error(data.error || 'Request rejected'))
        } catch {}
      }
      window.addEventListener('storage', onStorage as any)

      timer = window.setTimeout(() => finishErr(new Error('Timed out waiting for AmVault')), timeoutMs)
    } catch (e) { reject(e) }
  })
}

export async function openSignin(args: { app: string, chainId: number, origin: string, nonce: string, amvaultUrl: string, debug?: boolean }): Promise<SigninResp> {
  return requestPopup<SigninResp>({
    method: 'signin',
    app: args.app, chainId: args.chainId, origin: args.origin,
    amvaultUrl: args.amvaultUrl, nonce: args.nonce, debug: !!args.debug
  })
}

export async function sendTransaction(req: {
  chainId: number,
  to?: string,
  data?: string,
  value?: string | number | bigint,
  gas?: number,
  maxFeePerGasGwei?: number,
  maxPriorityFeePerGasGwei?: number
}, opts: { app: string, amvaultUrl: string, timeoutMs?: number, debug?: boolean } ): Promise<string> {
  const origin = window.location.origin
  const payload = {
    to: req.to, value: req.value, data: req.data, gas: req.gas,
    maxFeePerGasGwei: req.maxFeePerGasGwei, maxPriorityFeePerGasGwei: req.maxPriorityFeePerGasGwei
  }
  const resp = await requestPopup<SendTxResp>({
    method: 'eth_sendTransaction',
    app: opts.app,
    chainId: req.chainId,
    origin,
    amvaultUrl: opts.amvaultUrl,
    payload,
    timeoutMs: opts.timeoutMs ?? 50000,
    debug: !!opts.debug
  })
  if (!resp.ok) throw new Error(resp.error || 'Transaction rejected')
  if (!resp.txHash) throw new Error('No txHash returned from AmVault')
  return resp.txHash
}
