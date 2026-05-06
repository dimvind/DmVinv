const dragItem = document.getElementById("drag-item");

let active = false;
let currentX;
let currentY;
let initialX;
let initialY;
let xOffset = 0;
let yOffset = 0;

// Слушатели для мыши
document.addEventListener("mousedown", dragStart);
document.addEventListener("mousemove", drag);
document.addEventListener("mouseup", dragEnd);

// Слушатели для тачскринов (телефонов)
document.addEventListener("touchstart", dragStart);
document.addEventListener("touchmove", drag);
document.addEventListener("touchend", dragEnd);

function dragStart(e) {
  if (e.target === dragItem) {
    // Определяем начальную позицию
    if (e.type === "touchstart") {
      initialX = e.touches[0].clientX - xOffset;
      initialY = e.touches[0].clientY - yOffset;
    } else {
      initialX = e.clientX - xOffset;
      initialY = e.clientY - yOffset;
    }
    active = true;
  }
}

function drag(e) {
  if (active) {
    e.preventDefault();
    
    // Вычисляем текущее положение
    if (e.type === "touchmove") {
      currentX = e.touches[0].clientX - initialX;
      currentY = e.touches[0].clientY - initialY;
    } else {
      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;
    }

    xOffset = currentX;
    yOffset = currentY;

    // Двигаем элемент через transform (это производительнее)
    setTranslate(currentX, currentY, dragItem);
  }
}

function dragEnd() {
  initialX = currentX;
  initialY = currentY;
  active = false;
}

function setTranslate(xPos, yPos, el) {
  el.style.transform = `translate3d(${xPos}px, ${yPos}px, 0)`;
}





