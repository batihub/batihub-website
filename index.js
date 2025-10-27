document.addEventListener("DOMContentLoaded", () => {
  const projectsBtn = document.getElementById("projects-btn");
  const projectsMenu = document.getElementById("projects-menu");
  let hideTimeout;

  function showMenu() {
    clearTimeout(hideTimeout);
    projectsMenu.classList.add("show");
  }

  function hideMenuWithDelay() {
    hideTimeout = setTimeout(() => {
      projectsMenu.classList.remove("show");
    }, 250); // Delay before hiding
  }

  // Hover behavior
  projectsBtn.parentElement.addEventListener("mouseenter", showMenu);
  projectsBtn.parentElement.addEventListener("mouseleave", hideMenuWithDelay);

  // Click toggle
  projectsBtn.addEventListener("click", (e) => {
    e.preventDefault();
    const isVisible = projectsMenu.classList.contains("show");
    if (isVisible) {
      projectsMenu.classList.remove("show");
    } else {
      showMenu();
    }
  });

  // Close when clicking outside
  document.addEventListener("click", (e) => {
    const clickedInside = projectsBtn.parentElement.contains(e.target);
    if (!clickedInside) {
      projectsMenu.classList.remove("show");
    }
  });
});
