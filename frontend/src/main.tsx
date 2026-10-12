import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App.tsx'
import { CallViewWindow } from './features/call/CallViewWindow.tsx'

// The desktop call window loads the same bundle with ?view=call and renders only the call view.
const isCallView = new URLSearchParams(window.location.search).get('view') === 'call'

createRoot(document.getElementById('root')!).render(
  isCallView ? <CallViewWindow /> : <App />
)
