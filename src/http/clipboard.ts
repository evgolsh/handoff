/** User-triggered copy only. Credentials stay in this page; never stored in browser storage or a URL. */
export const COPY_SCRIPT = `document.addEventListener("click", function (event) {
  var button = event.target.closest && event.target.closest("button[data-copy]");
  if (!button) return;
  var original = button.getAttribute("data-copy-label") || button.textContent;
  button.setAttribute("data-copy-label", original);
  var status = document.getElementById("copy-status");
  function done(ok) {
    button.textContent = ok ? "Copied" : "Copy manually";
    if (status) status.textContent = ok ? "Copied to clipboard." : "Select the text and copy it manually.";
    setTimeout(function () { button.textContent = original; }, 2000);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(button.getAttribute("data-copy")).then(function () { done(true); }, function () { done(false); });
  } else { done(false); }
});`;
