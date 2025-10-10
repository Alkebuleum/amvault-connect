let sharedPopup: Window | null = null
let overlayEl: HTMLDivElement | null = null
let isClosing = false

function ensureOverlay() {
  if (overlayEl) return
  overlayEl = document.createElement('div')
  overlayEl.id = 'amvault-overlay'
  Object.assign(overlayEl.style, {
    position: 'fixed',
    inset: '0',
    background: 'rgba(0,0,0,0.35)',
    zIndex: '9999',
    pointerEvents: 'none'
  } as CSSStyleDeclaration)
  document.body.appendChild(overlayEl)
}

export function preOpenAmvaultPopup(name = 'amvault', w = 420, h = 640) {
  const oh = window.top?.outerHeight ?? window.outerHeight ?? 0
  const ow = window.top?.outerWidth ?? window.outerWidth ?? 0
  const y = Math.max((oh - h) / 2, 0)
  const x = Math.max((ow - w) / 2, 0)

  if (sharedPopup && !sharedPopup.closed) return sharedPopup
  sharedPopup = window.open(
    'about:blank',
    name,
    `toolbar=0,location=0,status=0,menubar=0,scrollbars=1,resizable=1,width=${w},height=${h},top=${y},left=${x}`
  ) ?? null
  ensureOverlay()

  window.addEventListener('beforeunload', () => {
    try { sharedPopup?.close() } catch {}
    sharedPopup = null
    if (overlayEl?.parentNode && overlayEl.parentNode.contains(overlayEl)) {
      try { overlayEl.parentNode.removeChild(overlayEl) } catch {}
    }
    overlayEl = null
    isClosing = false
  }, { once: true })
  return sharedPopup
}

export function getSharedPopup() {
  return sharedPopup && !sharedPopup.closed ? sharedPopup : null
}

export async function closeSharedPopup() {
  if (isClosing) return
  isClosing = true
  try { if (sharedPopup && !sharedPopup.closed) sharedPopup.close() } catch {}
  sharedPopup = null
  if (overlayEl) {
    const parent = overlayEl.parentNode
    if (parent && (parent as Node).contains(overlayEl)) {
      try { parent.removeChild(overlayEl) } catch {}
    }
  }
  overlayEl = null
  await Promise.resolve()
  isClosing = false
}

export async function closePopupThen(cb: () => void){
  await closeSharedPopup()
  setTimeout(cb, 0)
}
