// Installation comme application (Android / Chrome). Sans effet dans l'artifact Claude.
(function () {
  if (!("serviceWorker" in navigator) || location.protocol !== "https:") return;
  if (!/github\.io$/.test(location.hostname)) return;
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  });
})();
