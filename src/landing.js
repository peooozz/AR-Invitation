/**
 * Initialize landing page interactions.
 * @param {Function} onBegin - callback when user clicks "Begin the Journey"
 */
export function initLanding(onBegin) {
  const landing = document.getElementById('landing');
  const btnBegin = document.getElementById('btn-begin');

  btnBegin.addEventListener('click', () => {
    landing.classList.add('hidden');
    onBegin();
  });
}
