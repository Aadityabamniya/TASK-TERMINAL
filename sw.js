/* FILENAME: sw.js */
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyBUW2AMdHObQW31ZsLtdRWSU6L8AwxxSW4",
    authDomain: "task-terminal-9e678.firebaseapp.com",
    projectId: "task-terminal-9e678",
    storageBucket: "task-terminal-9e678.firebasestorage.app",
    messagingSenderId: "418579327777",
    appId: "1:418579327777:web:80f9cbfb7a3b77107aec60",
});

const messaging = firebase.messaging();

// This forces the notification into the Android/iOS System Tray
messaging.onBackgroundMessage((payload) => {
    console.log("Background Push Received:", payload);
    const notificationTitle = payload.notification.title;
    const notificationOptions = {
        body: payload.notification.body,
        icon: 'https://cdn-icons-png.flaticon.com/512/906/906334.png',
        badge: 'https://cdn-icons-png.flaticon.com/512/906/906334.png',
        vibrate: [200, 100, 200]
    };

    return self.registration.showNotification(notificationTitle, notificationOptions);
});