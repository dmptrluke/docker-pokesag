import {registerRoute} from 'workbox-routing';
import {StaleWhileRevalidate} from 'workbox-strategies';

registerRoute(
  ({request}) => request.destination === 'script' || request.destination === 'style' || request.destination === 'image',
  new StaleWhileRevalidate()
);
