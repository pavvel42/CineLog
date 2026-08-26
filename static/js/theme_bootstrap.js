(function () {
  var colorScheme = localStorage.getItem("color-scheme");
  document.documentElement.setAttribute(
    "data-theme",
    colorScheme || "dark"
  );
})();
