import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@livekit/components-styles';
import './styles.css';
import { App } from './App.tsx';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root element');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
