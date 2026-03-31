// sw.js - The Background Brain
const CACHE_NAME = 'task-terminal-v1';

self.addEventListener('install', (event) => {
    console.log('Service Worker: Installed');
    // Forces the waiting service worker to become the active service worker
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('Service Worker: Activated');
});

self.addEventListener('fetch', (event) => {
    // For now, we just let all network requests pass through normally.
    // Later, the Push Notification code goes in this file!
    event.respondWith(fetch(event.request));
});