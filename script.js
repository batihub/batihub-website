// Safe script that doesn't prevent normal link navigation
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("projects-btn");
  const menu = document.getElementById("projects-menu");

  // Toggle the dropdown on small screens, but never block anchor default behavior
  if (btn && menu) {
    btn.addEventListener("click", (e) => {
      e.preventDefault(); // prevents the "#" default on the Projects label
      menu.style.display = (menu.style.display === "block") ? "none" : "block";
    });

    // clicking a project link will follow the href (no preventDefault)
    menu.querySelectorAll("a").forEach(a => {
      a.addEventListener("click", () => {
        // no preventDefault here — navigation happens normally
      });
    });

    // close if clicked outside
    document.addEventListener("click", (e) => {
      if (!btn.parentElement.contains(e.target)) {
        menu.style.display = "";
      }
    });
  }
});
