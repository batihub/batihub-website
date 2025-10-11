async function loadJoke() 
{
    try{
        const chuckNorrisFetch = await fetch("https://api.chucknorris.io/jokes/random" , {
            headers: {
                Accept: "application/json"
            }
    });

    const jokeData = await chuckNorrisFetch.json();
    document.getElementById("loadingJoke").textContent = jokeData.value;  // innerHTML can be used instead od textContent but its less secure

    }
    catch(error){
        console.log(error);
    }
}

document.getElementById("loadJokeBtn").addEventListener("click", loadJoke);