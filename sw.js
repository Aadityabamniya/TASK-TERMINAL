// This is the background brain of the app.
// Later, we will put the Firebase Push Notification code in here!
self.addEventListener('install', (event) => {
    console.log('Service Worker Installed');
});

self.addEventListener('fetch', (event) => {
    // This allows the app to load even if the internet drops for a second
});