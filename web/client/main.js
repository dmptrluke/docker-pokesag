import React from 'react';
import ReactDOM from 'react-dom';
import PokeSAG_Client from './client';

if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('/service.js')
      .then(() => { console.log('Service Worker Registered'); });
  }

ReactDOM.render(<PokeSAG_Client />, document.getElementById('root'));
