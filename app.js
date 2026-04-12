const contentDiv = document.getElementById('app-content');
const homeBtn = document.getElementById('home-btn');
const aboutBtn = document.getElementById('about-btn');

const NOTES_STORAGE_KEY = 'notes';
const BACKEND_URL = window.location.origin;
const socket = typeof window.io === 'function'
    ? io(BACKEND_URL, {
        transports: ['websocket', 'polling']
    })
    : {
        emit() { },
        on() { }
    };

function setActiveButton(activeId) {
    [homeBtn, aboutBtn].forEach((btn) => btn.classList.remove('active'));
    document.getElementById(activeId)?.classList.add('active');
}

function notifyInBrowser(message, tone = 'info') {
    let container = document.getElementById('browser-notify-container');

    if (!container) {
        container = document.createElement('div');
        container.id = 'browser-notify-container';
        container.className = 'browser-notify-container';
        document.body.appendChild(container);
    }

    const item = document.createElement('div');
    item.className = `browser-notify browser-notify-${tone}`;

    const text = document.createElement('span');
    text.textContent = message;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'browser-notify-close';
    closeBtn.setAttribute('aria-label', 'Закрыть уведомление');
    closeBtn.textContent = 'x';
    closeBtn.addEventListener('click', () => item.remove());

    item.appendChild(text);
    item.appendChild(closeBtn);
    container.appendChild(item);

    window.setTimeout(() => {
        item.classList.add('is-hiding');
        window.setTimeout(() => item.remove(), 180);
    }, 3000);
}

function getNotes() {
    try {
        const notes = JSON.parse(localStorage.getItem(NOTES_STORAGE_KEY) || '[]');
        return Array.isArray(notes) ? notes : [];
    } catch {
        return [];
    }
}

function saveNotes(notes) {
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
}

function renderNotes(list) {
    const notes = getNotes();

    if (!notes.length) {
        list.innerHTML = '<li style="margin-bottom: 15px;">Список заметок пуст.</li>';
        return;
    }

    list.innerHTML = notes
        .map(
            (note) => `
				<li class="note" data-id="${note.id}">
                    <div class="muted">ID:${note.id}</div>
					<span>${note.text}</span>
                    <div>
                    Дата напоминания:
                    <span class="muted">${note.timestamp || "нет"}</span>
                    </div>
					<div class="note-actions">
						<button type="button" class="edit-note-btn">Изменить</button>
						<button type="button" class="delete-note-btn">Удалить</button>
					</div>
				</li>
			`
        )
        .join('');
}

function addNote(text, timestamp) {
    const notes = getNotes();
    const newNote = {
        id: Date.now(),
        text,
        timestamp: timestamp
    };

    notes.push(newNote);
    saveNotes(notes);

    socket.emit('newTask', {
        id: newNote.id,
        text: newNote.text,
        // timestamp: timestamp.getTime()
    });
    if (timestamp) {
        socket.emit('newReminder', {
            id: newNote.id,
            text: newNote.text,
            timestamp: new Date(timestamp).getTime()
        })
    }
}

function updateNote(noteId, text) {
    const notes = getNotes().map((note) => {
        if (String(note.id) === String(noteId)) {
            return { ...note, text };
        }

        return note;
    });

    saveNotes(notes);

    socket.emit('noteUpdated', {
        id: noteId,
        text,
        timestamp: Date.now()
    });
}

function deleteNote(noteId) {
    const notes = getNotes().filter((note) => String(note.id) !== String(noteId));
    saveNotes(notes);

    socket.emit('noteDeleted', {
        id: noteId,
        timestamp: Date.now()
    });
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; i += 1) {
        outputArray[i] = rawData.charCodeAt(i);
    }

    return outputArray;
}

async function getVapidPublicKey() {
    const response = await fetch(`${BACKEND_URL}/vapid-public-key`);

    if (!response.ok) {
        throw new Error('Не удалось получить публичный VAPID-ключ');
    }

    const body = await response.json();
    return body.publicKey;
}

async function checkBackendReady() {
    try {
        const response = await fetch(`${BACKEND_URL}/health`);
        return response.ok;
    } catch {
        return false;
    }
}

async function subscribeToPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        throw new Error('Push API не поддерживается этим браузером');
    }

    const registration = await navigator.serviceWorker.ready;
    const existingSubscription = await registration.pushManager.getSubscription();

    if (existingSubscription) {
        return existingSubscription;
    }

    const publicKey = await getVapidPublicKey();
    const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
    });

    await fetch(`${BACKEND_URL}/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription)
    });

    return subscription;
}

async function unsubscribeFromPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        return;
    }

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
        return;
    }

    await fetch(`${BACKEND_URL}/unsubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint })
    });

    await subscription.unsubscribe();
}

async function syncPushButtons(enableBtn, disableBtn) {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
        enableBtn.style.display = 'none';
        disableBtn.style.display = 'inline-block';
    } else {
        enableBtn.style.display = 'inline-block';
        disableBtn.style.display = 'none';
    }
}

function initPushControls() {
    const enableBtn = document.getElementById('enable-push-btn');
    const disableBtn = document.getElementById('disable-push-btn');

    if (!enableBtn || !disableBtn || !('serviceWorker' in navigator)) {
        return;
    }

    if (enableBtn.dataset.bound === 'true') {
        return;
    }

    enableBtn.dataset.bound = 'true';
    disableBtn.dataset.bound = 'true';

    syncPushButtons(enableBtn, disableBtn).catch(() => {
        enableBtn.style.display = 'inline-block';
        disableBtn.style.display = 'none';
    });

    enableBtn.addEventListener('click', async () => {
        try {
            const isBackendReady = await checkBackendReady();

            if (!isBackendReady) {
                alert('Бэкенд недоступен. Запустите node server.js и откройте приложение через http://localhost:3001');
                return;
            }

            if (Notification.permission === 'denied') {
                alert('Уведомления запрещены. Разрешите их в настройках браузера.');
                return;
            }

            if (Notification.permission === 'default') {
                const permission = await Notification.requestPermission();

                if (permission !== 'granted') {
                    alert('Чтобы включить push, нужно разрешить уведомления.');
                    return;
                }
            }

            await subscribeToPush();
            await syncPushButtons(enableBtn, disableBtn);
            notifyInBrowser('Push-уведомления включены', 'success');
        } catch (error) {
            console.error(error);
            alert(`Не удалось включить push-уведомления: ${error.message || 'неизвестная ошибка'}`);
        }
    });

    disableBtn.addEventListener('click', async () => {
        try {
            await unsubscribeFromPush();
            await syncPushButtons(enableBtn, disableBtn);
            notifyInBrowser('Push-уведомления отключены', 'info');
        } catch (error) {
            console.error(error);
            alert('Не удалось отключить push-уведомления.');
        }
    });
}

function initNotes() {
    const form = document.getElementById('note-form');
    const input = document.getElementById('note-input');
    const timeInput = document.getElementById('datetime-input');
    const list = document.getElementById('notes-list');
    const defaultButton = document.getElementById('without-timestamp')


    if (!form || !input || !list) {
        return;
    }

    renderNotes(list);
    initPushControls();

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const text = input.value.trim();
        const timestamp = timeInput.value.trim();

        if (!text) {
            return;
        }

        addNote(text, timestamp);
        input.value = '';
        renderNotes(list);
    });

    list.addEventListener('click', (event) => {
        const target = event.target;

        if (!(target instanceof HTMLElement)) {
            return;
        }

        const noteElement = target.closest('.note');
        const noteId = noteElement?.getAttribute('data-id');

        if (!noteId) {
            return;
        }

        if (target.classList.contains('delete-note-btn')) {
            deleteNote(noteId);
            renderNotes(list);
            return;
        }

        if (target.classList.contains('edit-note-btn')) {
            const notes = getNotes();
            const selectedNote = notes.find((note) => String(note.id) === String(noteId));

            if (!selectedNote) {
                return;
            }

            const nextText = window.prompt('Изменить заметку', selectedNote.text);

            if (nextText === null) {
                return;
            }

            const normalized = nextText.trim();

            if (!normalized) {
                alert('Текст заметки не может быть пустым.');
                return;
            }

            updateNote(noteId, normalized);
            renderNotes(list);
        }
    });
}

async function loadContent(page) {
    try {
        const response = await fetch(`/content/${page}.html`);

        if (!response.ok) {
            throw new Error(`Ошибка загрузки: ${response.status}`);
        }

        const html = await response.text();
        contentDiv.innerHTML = html;

        if (page === 'home') {
            initNotes();
        }
    } catch (error) {
        contentDiv.innerHTML = '<p>Не удалось загрузить страницу.</p>';
        console.error(error);
    }
}

homeBtn.addEventListener('click', () => {
    setActiveButton('home-btn');
    loadContent('home');
});

aboutBtn.addEventListener('click', () => {
    setActiveButton('about-btn');
    loadContent('about');
});

socket.on('taskAdded', (task) => {
    notifyInBrowser(`Новая заметка: ${task.text}`, 'success');
});

socket.on('taskUpdated', (task) => {
    notifyInBrowser(`Изменена заметка #${task.id}`, 'info');
});

socket.on('taskDeleted', (task) => {
    notifyInBrowser(`Удалена заметка #${task.id}`, 'warning');
});

if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
        try {
            await navigator.serviceWorker.register('/sw.js');
            console.log('Service Worker зарегистрирован');
        } catch (error) {
            console.error('Ошибка регистрации Service Worker:', error);
        }
    });
}

loadContent('home');
