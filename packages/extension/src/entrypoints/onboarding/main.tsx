import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/ui/styles.css';
import { OnboardingApp } from '@/ui/onboarding/App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OnboardingApp />
  </React.StrictMode>,
);
