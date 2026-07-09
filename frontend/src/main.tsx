import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { App } from './App';

const stored = localStorage.getItem('theme') ?? 'dark';
document.documentElement.setAttribute('data-theme', stored);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
