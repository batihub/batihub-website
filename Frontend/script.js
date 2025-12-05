// CRITICAL: Ensure this URL matches your Uvicorn host and port or Render link
//Check: Does it contain the const API_URL = ... line at the very top?
//Check: Is the URL set to your Render link?

const API_URL = 'https://beelog-poes.onrender.com';

// --- 1. GET ALL POSTS (RELOAD) ---
async function fetchPosts() {
   const container = document.getElementById('posts-container');
   container.innerHTML = '<div class="loader">Fetching posts...</div>';

   try {
      const response = await fetch(API_URL);
      if (!response.ok) {
         throw new Error(`HTTP error! status: ${response.status}`);
      }
      const posts = await response.json();

      container.innerHTML = ''; // Clear the loader

      if (posts.length === 0) {
         container.innerHTML = '<p class="loader">No posts found. Try creating one!</p>';
         return;
      }

      // Render each post as a card
      posts.reverse().forEach(post => { // Display newest posts first
         const card = document.createElement('div');
         card.className = 'post-card';

         const title = document.createElement('h3');
         title.textContent = post.title;

         const idStatus = document.createElement('p');
         idStatus.className = 'post-status';
         idStatus.textContent = `ID: ${post.id} | Status: ${post.is_published ? 'PUBLISHED' : 'DRAFT'}`;

         const content = document.createElement('p');

         // Karakter limiti (İstediğiniz sayıya ayarlayabilirsiniz)
         const charLimit = 200;

         if (post.content.length > charLimit) {
            // Limiti aşıyorsa kısalt ve sonuna ... ekle
            content.textContent = post.content.substring(0, charLimit) + '...';
            content.style.cursor = 'pointer'; // Tıklanabilir olduğunu göster
            content.title = "Tamamını görmek için tıklayın";

            let isExpanded = false;
            content.onclick = () => {
               if (isExpanded) {
                  // Açıksa tekrar kısalt
                  content.textContent = post.content.substring(0, charLimit) + '...';
                  isExpanded = false;
               } else {
                  // Kapalıysa tamamını göster
                  content.textContent = post.content;
                  isExpanded = true;
               }
            };
         } else {
            // Limit altındaysa direkt göster
            content.textContent = post.content;
         }

         // delete buton
         const xHolder = document.createElement("a");
         xHolder.className = "xHolder";
         xHolder.href = "javascript:void(0)";
         xHolder.onclick = () => openDeleteModal(post.id);
         const xMark = document.createElement("i");
         xMark.className = "fa-solid fa-xmark";

         // edit buton
         const editHolder = document.createElement("a");
         editHolder.className = "editHolder";
         editHolder.href = "javascript:void(0)";
         editHolder.onclick = () => openEditModal(post);
         const editIcon = document.createElement("i");
         editIcon.className = "fa-solid fa-pen";

         editHolder.appendChild(editIcon);
         card.appendChild(editHolder);

         xHolder.appendChild(xMark);
         card.appendChild(xHolder);
         card.appendChild(title);
         card.appendChild(idStatus);
         card.appendChild(content);
         container.appendChild(card);

      });

   } catch (e) {
      console.error("Could not fetch posts:", e);
      container.innerHTML = `<p class="loader" style="color: red;">Network Error: Could not connect to API at ${API_URL}. Is your server running?</p>`;
   }
}

// --- 2. CREATE NEW POST ---
async function createNewPost() {
   // Get references to the input fields and message area
   const titleInput = document.getElementById('post-title');
   const contentInput = document.getElementById('post-content');
   const publishedInput = document.getElementById('post-published');
   const messageDisplay = document.getElementById('post-message');

   messageDisplay.textContent = 'Submitting...';
   messageDisplay.style.color = "blue";

   const newPostData = {
      title: titleInput.value.trim(),
      content: contentInput.value.trim(),
      is_published: publishedInput.checked
   };

   // Basic validation
   if (!newPostData.title || !newPostData.content) {
      messageDisplay.textContent = "Title and Content are required!";
      messageDisplay.style.color = "red";
      return;
   }

   try {
      const response = await fetch(API_URL, {
         method: 'POST',
         headers: {
            'Content-Type': 'application/json'
         },
         body: JSON.stringify(newPostData)
      });

      if (response.ok) {
         // Success: Clear the form and reload
         titleInput.value = '';
         contentInput.value = '';
         publishedInput.checked = true;

         const createdPost = await response.json();

         
         messageDisplay.textContent = `Post created successfully! (ID: ${createdPost.id})`;
         messageDisplay.style.color = "green";
         setTimeout(() => { messageDisplay.textContent = ""; }, 2000);

         await new Promise(resolve => setTimeout(resolve, 100));
         fetchPosts(); // Reload the list

      } else {
         // Failure: Read error message from the API response
         const error = await response.json();
         console.error("Creation Failed:", error);
         messageDisplay.textContent = `Creation Failed (${response.status}). Detail: ${error.detail ? error.detail.content : 'Unknown Error'}`;
         messageDisplay.style.color = "red";
      }

   } catch (e) {
      // Network Error
      console.error("Network Error during creation:", e);
      messageDisplay.textContent = "Network Error: Could not connect to API.";
      messageDisplay.style.color = "red";
   }

   // Reload the post list to show the new entry
   fetchPosts();
}

// --- 3. DELETE POST ---
let postToDeleteId = null;

function openDeleteModal(id) {
   postToDeleteId = id;
   document.getElementById('confirmation-modal').style.display = 'flex';
}

function closeModal() {
   postToDeleteId = null;
   document.getElementById('confirmation-modal').style.display = 'none';
}

document.getElementById('confirm-delete-btn').onclick = async function () {
   if (!postToDeleteId) return;

   try {
      const response = await fetch(`${API_URL}/${postToDeleteId}`, {
         method: 'DELETE'
      });

      if (response.ok) {
         closeModal();
         fetchPosts(); // Reload the list
      } else {
         alert("Failed to delete post.");
      }
   } catch (e) {
      console.error("Error deleting post:", e);
      alert("Error deleting post.");
   }
}

// --- 4. EDIT POST ---
function openEditModal(post) {
   document.getElementById('edit-post-id').value = post.id;
   document.getElementById('edit-post-title').value = post.title;
   document.getElementById('edit-post-content').value = post.content;
   document.getElementById('edit-post-published').checked = post.is_published;

   document.getElementById('edit-modal').style.display = 'flex';
}

function closeEditModal() {
   document.getElementById('edit-modal').style.display = 'none';
}

async function submitEditPost() {
   const id = document.getElementById('edit-post-id').value;
   const title = document.getElementById('edit-post-title').value.trim();
   const content = document.getElementById('edit-post-content').value.trim();
   const is_published = document.getElementById('edit-post-published').checked;

   if (!title || !content) {
      alert("Title and Content are required!");
      return;
   }

   const updateData = {
      title: title,
      content: content,
      is_published: is_published
   };

   try {
      const response = await fetch(`${API_URL}/${id}`, {
         method: 'PATCH',
         headers: {
            'Content-Type': 'application/json'
         },
         body: JSON.stringify(updateData)
      });

      if (response.ok) {
         closeEditModal();
         fetchPosts(); // Reload the list
      } else {
         const errorData = await response.json();
         alert(`Failed to update post: ${errorData.detail?.content || 'Unknown error'}`);
      }
   } catch (e) {
      console.error("Error updating post:", e);
      alert("Error updating post.");
   }
}

// Close modals when clicking outside
window.onclick = function (event) {
   const deleteModal = document.getElementById('confirmation-modal');
   const editModal = document.getElementById('edit-modal');
   if (event.target == deleteModal) {
      closeModal();
   }
   if (event.target == editModal) {
      closeEditModal();
   }
}

// Initial load of posts when the page loads
fetchPosts();
