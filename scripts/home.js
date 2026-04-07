const form = document.getElementById('note-form');
const input = document.getElementById('note-input');
const list = document.getElementById('notes-list');

const deleteBtn = document.querySelectorAll(".delete-btn");
const editBtn = document.querySelectorAll(".edit-btn");


if (!form || !input || !list) {
    console.error('Не найдены обязательные элементы интерфейса заметок.');
} else {
function loadNotes() {
    const notes = JSON.parse(localStorage.getItem('notes') || '[]');
    list.innerHTML = notes.map(note => `
            <div class="note">
                <span>${note}</span>
                <button class="delete-btn"></button>
                <button class="edit-btn"></button>
            </div>
        `).join('');

}
function addNote(text) {
    const notes = JSON.parse(localStorage.getItem('notes') || '[]');
    notes.push(text);
    localStorage.setItem('notes', JSON.stringify(notes));
    loadNotes();
}
function deleteNode(index) {
    localStorage.removeItem(index)
    loadNotes();
}
function editNode(index, text) {
    JSON.parse(localStorage.getItem('notes')[index] || "") = text;
    loadNotes();
}
form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (text) {
        addNote(text);
        input.value = '';
    }
});
loadNotes();
}
document.querySelectorAll('.delete-btn').forEach((btn, index) => {
    btn.addEventListener('click', () => deleteNote(notes[index].id));
});

document.querySelectorAll('.edit-btn').forEach((btn, index) => {
    btn.addEventListener('click', () => editNote(notes[index].id));
});