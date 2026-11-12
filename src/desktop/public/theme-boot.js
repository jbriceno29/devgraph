// Fija data-theme antes de pintar (evita parpadeo). Archivo externo y síncrono: la CSP de Tauri (script-src 'self') bloquea scripts inline.
(function () {
  try {
    var t = localStorage.getItem('graphworkspace.theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
