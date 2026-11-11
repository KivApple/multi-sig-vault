import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initDataCache } from './lib/dataCache';
import { initTokens } from './lib/tokens';
import { initUpdates } from './lib/update';
import { initAppStore } from './store/appStore';
import './styles.css';

const start = async (): Promise<void> => {
  await Promise.all([initAppStore(), initDataCache()]);
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  void initTokens();
  void initUpdates();
};

void start();
