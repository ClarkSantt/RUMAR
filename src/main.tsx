import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/global.css';
import './styles/visual-foundation.css';
import './styles/tasks-inbox.css';
import './styles/projects-objectives.css';
import './styles/habits-routines.css';
import App from './app/App';
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
