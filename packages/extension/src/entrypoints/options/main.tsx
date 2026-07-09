import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/ui/styles.css';
import { OptionsApp } from '@/ui/options/App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OptionsApp />
  </React.StrictMode>,
);
