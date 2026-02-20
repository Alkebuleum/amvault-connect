// eip1193/AmvaultEIP1193Provider.ts
//
// EIP-1193 compatible provider that wraps AmVault's popup flows.
// Lets dApps use standard ethers.js / wagmi / viem without any
// AmVault-specific code:
//
//   import { AmvaultEIP1193Provider } from 'amvault-connect'
//   const provider = new AmvaultEIP1193Provider({ appName, amvaultUrl, chainId })
//   const ethers  = new BrowserProvider(provider)             // ethers v6
//   const [addr]  = await ethers.send('eth_requestAccounts', [])

import { openSignin, signMessage, sendTransaction } from '../popup/amvaultProvider'
import { makeStorageKeys } from '../provider/AuthProvider'
import type { AmvaultConnectConfig, Session } from '../types'

// ─── EIP-1193 types ────────────────────────────────────────────────────────

export interface EIP1193RequestArguments {
    readonly method: string
    readonly params?: readonly unknown[] | object
}

export interface EIP1193ProviderRpcError extends Error {
    code: number
    data?: unknown
}

type EIP1193EventMap = {
    accountsChanged: (accounts: string[]) => void
    chainChanged: (chainId: string) => void
    connect: (info: { chainId: string }) => void
    disconnect: (error: EIP1193ProviderRpcError) => void
    message: (message: { type: string; data: unknown }) => void
}

// Standard EIP-1193 error codes
const RPC_ERROR = {
    USER_REJECTED: 4001,
    UNAUTHORIZED: 4100,
    UNSUPPORTED_METHOD: 4200,
    DISCONNECTED: 4900,
    CHAIN_DISCONNECTED: 4901,
    INTERNAL: -32603,
    INVALID_PARAMS: -32602,
    METHOD_NOT_FOUND: -32601,
} as const

function rpcError(message: string, code: number, data?: unknown): EIP1193ProviderRpcError {
    const err = new Error(message) as EIP1193ProviderRpcError
    err.code = code
    if (data !== undefined) err.data = data
    return err
}

// ─── Provider ──────────────────────────────────────────────────────────────

export class AmvaultEIP1193Provider {
    readonly isAmvault = true
    readonly isMetaMask = false  // don't masquerade as MetaMask

    private _config: AmvaultConnectConfig
    private _storageKeys: ReturnType<typeof makeStorageKeys>
    private _listeners: Partial<{ [K in keyof EIP1193EventMap]: Set<EIP1193EventMap[K]> }> = {}

    constructor(config: AmvaultConnectConfig) {
        this._config = config
        this._storageKeys = makeStorageKeys(config.storagePrefix ?? 'amvault')
    }

    // ─── Session helpers ───────────────────────────────────────────────────

    private _loadSession(): Session | null {
        try {
            const raw = localStorage.getItem(this._storageKeys.session)
            if (!raw) return null
            const s = JSON.parse(raw) as Session
            if (Date.now() >= s.expiresAt) {
                localStorage.removeItem(this._storageKeys.session)
                return null
            }
            return s
        } catch {
            return null
        }
    }

    private _saveSession(session: Session): void {
        localStorage.setItem(this._storageKeys.session, JSON.stringify(session))
    }

    private _clearSession(): void {
        localStorage.removeItem(this._storageKeys.session)
    }

    // ─── EIP-1193 request() ───────────────────────────────────────────────

    async request(args: EIP1193RequestArguments): Promise<unknown> {
        const { method, params } = args
        const p = (params ?? []) as any[]

        if (this._config.debug) {
            console.log('[AmvaultEIP1193] request', method, p)
        }

        switch (method) {

            // ── Read-only / no popup needed ──────────────────────────────────

            case 'eth_chainId': {
                return '0x' + this._config.chainId.toString(16)
            }

            case 'net_version': {
                return String(this._config.chainId)
            }

            case 'eth_accounts': {
                const session = this._loadSession()
                return session ? [session.address.toLowerCase()] : []
            }

            // ── Auth / connect ───────────────────────────────────────────────

            case 'eth_requestAccounts': {
                // Return existing session if still valid
                const existing = this._loadSession()
                if (existing) return [existing.address.toLowerCase()]

                // Otherwise open sign-in popup
                const nonce = this._makeNonce()
                const origin = window.location.origin
                const msg = this._buildMessage(nonce)

                let resp
                try {
                    resp = await openSignin({
                        app: this._config.appName,
                        chainId: this._config.chainId,
                        origin,
                        nonce,
                        amvaultUrl: this._config.amvaultUrl,
                        debug: !!this._config.debug,
                        message: msg,
                    })
                } catch (e: any) {
                    if (/reject|cancel|blocked/i.test(e?.message ?? '')) {
                        throw rpcError('User rejected the request', RPC_ERROR.USER_REJECTED)
                    }
                    throw rpcError(e?.message ?? 'Sign-in failed', RPC_ERROR.INTERNAL)
                }

                if (!resp?.ok) {
                    throw rpcError(resp?.error ?? 'Sign-in rejected', RPC_ERROR.USER_REJECTED)
                }

                // Verify response integrity
                const { verifyMessage } = await import('ethers')
                const toVerify = typeof resp.message === 'string' && resp.message.trim()
                    ? resp.message : msg

                const recovered = verifyMessage(toVerify, resp.signature).toLowerCase()
                if (recovered !== resp.address.toLowerCase()) {
                    throw rpcError('Signature verification failed', RPC_ERROR.INTERNAL)
                }

                if (resp.nonce !== nonce) {
                    throw rpcError('Nonce mismatch', RPC_ERROR.INTERNAL)
                }

                if (Number(resp.chainId) !== this._config.chainId) {
                    throw rpcError(
                        `Wrong network: got ${resp.chainId}, expected ${this._config.chainId}`,
                        RPC_ERROR.CHAIN_DISCONNECTED
                    )
                }

                // Resolve AIN
                let ain = ''
                if (typeof resp.ain === 'string' && resp.ain.trim()) ain = resp.ain.trim()
                else if (typeof resp.amid === 'string' && resp.amid.trim()) ain = resp.amid.trim()
                if (!ain && this._config.registry?.getAin) {
                    try {
                        const gotAin = await this._config.registry.getAin(resp.address)
                        if (gotAin) ain = gotAin
                    } catch { }
                }
                if (!ain) ain = `ain-${resp.address.slice(2, 8)}`

                const ttl = this._config.sessionTtlMs ?? 86400000
                const now = Date.now()
                const session: Session = {
                    ain,
                    address: resp.address,
                    issuedAt: now,
                    expiresAt: now + ttl,
                }
                this._saveSession(session)
                this._emit('accountsChanged', [resp.address.toLowerCase()])
                this._emit('connect', { chainId: '0x' + this._config.chainId.toString(16) })

                return [resp.address.toLowerCase()]
            }

            // ── Message signing ──────────────────────────────────────────────

            case 'personal_sign': {
                // EIP-1193: params = [message, address]
                // (some libs send [address, message] — we detect and normalise)
                const session = this._loadSession()
                if (!session) {
                    throw rpcError('Not connected. Call eth_requestAccounts first.', RPC_ERROR.UNAUTHORIZED)
                }

                // Normalise param order: ethers sends [msg, addr], wagmi sends [addr, msg]
                let rawMsg: string = p[0]
                if (
                    typeof p[0] === 'string' &&
                    p[0].startsWith('0x') &&
                    p[0].length === 42 &&
                    typeof p[1] === 'string'
                ) {
                    rawMsg = p[1]
                }

                // Decode hex-encoded message to UTF-8 string if needed
                const message = this._decodeMessage(rawMsg)

                try {
                    return await signMessage(
                        { chainId: this._config.chainId, message },
                        {
                            app: this._config.appName,
                            amvaultUrl: this._config.amvaultUrl,
                            debug: !!this._config.debug,
                        }
                    )
                } catch (e: any) {
                    if (/reject|cancel/i.test(e?.message ?? '')) {
                        throw rpcError('User rejected the request', RPC_ERROR.USER_REJECTED)
                    }
                    throw rpcError(e?.message ?? 'Sign failed', RPC_ERROR.INTERNAL)
                }
            }

            case 'eth_sign': {
                // eth_sign: params = [address, message]
                const session = this._loadSession()
                if (!session) {
                    throw rpcError('Not connected. Call eth_requestAccounts first.', RPC_ERROR.UNAUTHORIZED)
                }

                const rawMsg: string = p[1]
                const message = this._decodeMessage(rawMsg)

                try {
                    return await signMessage(
                        { chainId: this._config.chainId, message },
                        {
                            app: this._config.appName,
                            amvaultUrl: this._config.amvaultUrl,
                            debug: !!this._config.debug,
                        }
                    )
                } catch (e: any) {
                    if (/reject|cancel/i.test(e?.message ?? '')) {
                        throw rpcError('User rejected the request', RPC_ERROR.USER_REJECTED)
                    }
                    throw rpcError(e?.message ?? 'Sign failed', RPC_ERROR.INTERNAL)
                }
            }

            // ── Transactions ─────────────────────────────────────────────────

            case 'eth_sendTransaction': {
                const session = this._loadSession()
                if (!session) {
                    throw rpcError('Not connected. Call eth_requestAccounts first.', RPC_ERROR.UNAUTHORIZED)
                }

                const tx = p[0] as Record<string, any>
                if (!tx || typeof tx !== 'object') {
                    throw rpcError('Invalid transaction object', RPC_ERROR.INVALID_PARAMS)
                }

                // Convert hex gas values to numbers if needed
                const gas = tx.gas ? parseInt(tx.gas, 16) : undefined
                const gasPrice = tx.gasPrice ? tx.gasPrice : undefined

                try {
                    return await sendTransaction(
                        {
                            chainId: this._config.chainId,
                            to: tx.to,
                            data: tx.data,
                            value: tx.value ?? 0,
                            gas,
                            // gasPrice passed through as-is; AmVault handles EIP-1559 fields natively
                        },
                        {
                            app: this._config.appName,
                            amvaultUrl: this._config.amvaultUrl,
                            debug: !!this._config.debug,
                        }
                    )
                } catch (e: any) {
                    if (/reject|cancel/i.test(e?.message ?? '')) {
                        throw rpcError('User rejected the request', RPC_ERROR.USER_REJECTED)
                    }
                    throw rpcError(e?.message ?? 'Transaction failed', RPC_ERROR.INTERNAL)
                }
            }

            // ── Chain / network ──────────────────────────────────────────────

            case 'wallet_switchEthereumChain': {
                // Alkebuleum is single-chain for now; accept only our own chainId
                const requested = p[0] as { chainId: string }
                const requestedId = parseInt(requested?.chainId ?? '0', 16)
                if (requestedId !== this._config.chainId) {
                    throw rpcError(
                        `AmVault only supports chainId ${this._config.chainId}`,
                        RPC_ERROR.CHAIN_DISCONNECTED
                    )
                }
                return null  // EIP-1193: null = success
            }

            case 'wallet_addEthereumChain': {
                // If the chainId matches ours, silently accept; otherwise reject
                const chain = p[0] as { chainId: string }
                const requestedId = parseInt(chain?.chainId ?? '0', 16)
                if (requestedId !== this._config.chainId) {
                    throw rpcError(
                        `AmVault only supports chainId ${this._config.chainId}`,
                        RPC_ERROR.UNSUPPORTED_METHOD
                    )
                }
                return null
            }

            // ── Unsupported ──────────────────────────────────────────────────

            default: {
                throw rpcError(
                    `AmVault does not support method: ${method}`,
                    RPC_ERROR.UNSUPPORTED_METHOD
                )
            }
        }
    }

    // ─── EIP-1193 event emitter ────────────────────────────────────────────

    on<K extends keyof EIP1193EventMap>(event: K, listener: EIP1193EventMap[K]): this {
        if (!this._listeners[event]) {
            this._listeners[event] = new Set() as any
        }
        (this._listeners[event] as Set<any>).add(listener)
        return this
    }

    removeListener<K extends keyof EIP1193EventMap>(event: K, listener: EIP1193EventMap[K]): this {
        (this._listeners[event] as Set<any> | undefined)?.delete(listener)
        return this
    }

    off<K extends keyof EIP1193EventMap>(event: K, listener: EIP1193EventMap[K]): this {
        return this.removeListener(event, listener)
    }

    private _emit<K extends keyof EIP1193EventMap>(
        event: K,
        ...args: Parameters<EIP1193EventMap[K]>
    ): void {
        (this._listeners[event] as Set<any> | undefined)?.forEach((fn) => {
            try { fn(...args) } catch { }
        })
    }

    // ─── Disconnect (clears session) ───────────────────────────────────────

    disconnect(): void {
        this._clearSession()
        this._emit('accountsChanged', [])
        this._emit('disconnect', rpcError('Disconnected', RPC_ERROR.DISCONNECTED))
    }

    // ─── Private helpers ───────────────────────────────────────────────────

    private _makeNonce(): string {
        const b = new Uint8Array(16)
        crypto.getRandomValues(b)
        return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('')
    }

    private _buildMessage(nonce: string): string {
        const origin = window.location.origin
        if (typeof this._config.messageBuilder === 'function') {
            return this._config.messageBuilder({
                appName: this._config.appName,
                origin,
                chainId: this._config.chainId,
                nonce,
            })
        }
        const domain = window.location.host
        return [
            `${domain} wants you to sign in with your account:`,
            ``,
            `App: ${this._config.appName}`,
            `Nonce: ${nonce}`,
            `URI: ${origin}`,
            `Chain ID: ${this._config.chainId}`,
            `Version: 1`,
        ].join('\n')
    }

    /** Decode a message that may arrive as UTF-8 hex (0x...) or plain string */
    private _decodeMessage(raw: string): string {
        if (typeof raw !== 'string') return String(raw)
        if (raw.startsWith('0x')) {
            try {
                const hex = raw.slice(2)
                const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)))
                return new TextDecoder().decode(bytes)
            } catch {
                return raw
            }
        }
        return raw
    }
}