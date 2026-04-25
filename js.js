let lastScroll = window.scrollY;

const elements = document.querySelectorAll('.hidden');

const observer = new IntersectionObserver((entries) => {
  const currentScroll = window.scrollY;
  const isScrollingUp = currentScroll < lastScroll;

  entries.forEach(entry => {
    if (entry.intersectionRatio >= 0.5) {
      entry.target.classList.add('visible');
    } else {
      // удаляем только если скролл вверх
      if (isScrollingUp) {
        entry.target.classList.remove('visible');
      }
    }
  });

  lastScroll = currentScroll;
}, {
  threshold: 0.5
});

elements.forEach(el => observer.observe(el));



const popup = document.getElementById('autoPopup');

// Функция открытия
function openPopup() {
  popup.classList.add('active');
}

// Функция закрытия
function closePopup() {
  popup.classList.remove('active');
}

// Запускаем цикл: выполнять openPopup каждые 15000 миллисекунд (15 сек)
setInterval(openPopup, 15000);