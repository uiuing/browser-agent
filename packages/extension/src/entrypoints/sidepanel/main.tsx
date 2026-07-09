import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/ui/styles.css';
import { SidePanelApp } from '@/ui/sidepanel/App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SidePanelApp />
  </React.StrictMode>,
);
