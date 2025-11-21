// CRITICAL: Ensure this URL matches your Uvicorn host and port
const API_URL = 'http://127.0.0.1:8000/posts';

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
         // Display a snippet of the content
         content.textContent = post.content.substring(0, 150) + (post.content.length > 150 ? '...' : '');

         // delete buton
         const xHolder = document.createElement("a");
         xHolder.className = "xHolder";
         xHolder.href = "javascript:void(0)";
         xHolder.onclick = () => openDeleteModal(post.id);
         const xMark = document.createElement("i");
         xMark.className = "fa-solid fa-xmark";

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
async function deletePost(postId) {
   // Modal kullanıldığı için window.confirm kaldırıldı

   try {
      // Backend'e DELETE isteği gönder
      const response = await fetch(`${API_URL}/${postId}`, {
         method: 'DELETE'
      });

      if (response.ok) {
         // Başarılıysa listeyi yenile
         fetchPosts();
      } else {
         alert('Silme işlemi başarısız oldu.');
      }
   } catch (e) {
      console.error("Hata:", e);
      alert('Bir hata oluştu.');
   }
}

// --- MODAL LOGIC ---
let postToDeleteId = null;

function openDeleteModal(postId) {
   postToDeleteId = postId;
   const modal = document.getElementById('confirmation-modal');
   modal.style.display = 'flex';

   // Set up the confirm button
   const confirmBtn = document.getElementById('confirm-delete-btn');
   confirmBtn.onclick = () => {
      deletePost(postToDeleteId);
      closeModal();
   };
}

function closeModal() {
   const modal = document.getElementById('confirmation-modal');
   modal.style.display = 'none';
   postToDeleteId = null;
}

// Close modal if clicking outside of it
window.onclick = function (event) {
   const modal = document.getElementById('confirmation-modal');
   if (event.target == modal) {
      closeModal();
   }
}

// Initial load of posts when the page loads
fetchPosts();