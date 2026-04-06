

if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
        try {
            const registration = await
                navigator.serviceWorker.register('./sw.js');
            console.log('ServiceWorker зарегистрирован:',
                registration.scope);
        } catch (err) {
            console.error('Ошибка регистрации ServiceWorker:', err);
        }
    });
}