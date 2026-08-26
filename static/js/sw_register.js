(function () {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker
        .register("static/sw.js?v=10.27", { scope: "./" })
        .then(function (reg) {
          reg.update();
        })
        .catch(function (err) {
          console.warn("Błąd rejestracji Service Worker:", err);
        });
    });
  }
})();
