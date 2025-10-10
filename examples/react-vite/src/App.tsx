import React from 'react'
import { useAuth, sendTransaction } from 'amvault-connect'

export default function App(){
  const { session, signin, signout, status, error } = useAuth()
  return (
    <div style={{fontFamily:'sans-serif', padding:20}}>
      <h2>amvault-connect demo</h2>
      <p>Status: <b>{status}</b></p>
      {error && <p style={{color:'tomato'}}>{error}</p>}
      {session ? (
        <>
          <p>Signed in as <b>{session.address}</b> (AIN: {session.ain})</p>
          <button onClick={signout}>Sign out</button>
          <button onClick={async()=>{
            try{
              const tx = await sendTransaction({ chainId: 12345, to: '0x0000000000000000000000000000000000000000', value: 0 },
                { app: 'ExampleApp', amvaultUrl: (import.meta as any).env?.VITE_AMVAULT_URL || 'https://amvault.example.com/router' })
              alert('tx sent: ' + tx)
            }catch(e:any){ alert(e.message) }
          }}>Send dummy tx</button>
        </>
      ) : (
        <button onClick={signin}>Sign in with AmVault</button>
      )}
    </div>
  )
}
