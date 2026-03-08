import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import { HubLanding } from './components/HubLanding';
import { NotFound } from './components/NotFound';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HubLanding />} />
        {/*
          NOTE: /:repoId/* matches any single path segment, so an unknown repoId
          like /nonexistent-repo/kanban will render App rather than NotFound.
          Proper repoId validation requires either:
            1. A loader/guard that checks the repo exists via /api/repos
            2. Enumerating known repos as explicit routes
          TODO: Add repoId validation once the /api/repos endpoint exists.
        */}
        <Route path="/:repoId/*" element={<App />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
