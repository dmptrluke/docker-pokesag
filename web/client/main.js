import React from 'react';
import ReactDOM from 'react-dom';
import Client from './client';

if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('/service.js')
      .then(() => { console.log('Service Worker Registered'); });
  }

ReactDOM.render(<Client />, document.getElementById('root'));
