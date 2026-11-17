const form = document.querySelector('#messageForm');
const content = document.querySelector('#content');
const category = document.querySelector('#category');
const charCount = document.querySelector('#charCount');
const formError = document.querySelector('#formError');
const formView = document.querySelector('#formView');
const successView = document.querySelector('#successView');
const writeAgain = document.querySelector('#writeAgain');

function updateCount() {
  charCount.textContent = `${content.value.length} / 2000`;
}

function setError(message = '') {
  formError.textContent = message;
}

content.addEventListener('input', updateCount);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setError('');
  const value = content.value.trim();
  if (value.length < 2) {
    setError('请至少写两句话或两个字，让老师能理解你的意思。');
    content.focus();
    return;
  }

  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.querySelector('span').textContent = '正在提交…';
  try {
    const response = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: category.value, content: value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '提交失败');
    formView.classList.add('is-hidden');
    successView.classList.remove('is-hidden');
    content.value = '';
    updateCount();
  } catch (error) {
    setError(error.message || '提交失败，请稍后再试。');
  } finally {
    button.disabled = false;
    button.querySelector('span').textContent = '提交匿名留言';
  }
});

writeAgain.addEventListener('click', () => {
  successView.classList.add('is-hidden');
  formView.classList.remove('is-hidden');
  content.focus();
});

updateCount();
