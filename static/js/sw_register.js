(function () {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker
        .register("sw.js?v=10.33")
        .then(function (reg) {
          reg.update();
        })
        .catch(function (err) {
          console.warn("Błąd rejestracji Service Worker:", err);
        });
    });
  }
})();
