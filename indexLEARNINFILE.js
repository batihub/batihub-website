

// fetch('https://api.example.com/data')
//     .then(response => {
//         if (response.ok) {
//             return response.json(); 
//         } else {
//             throw new Error('Network response was not ok'); 
//         }
//     })
//     .then(data => console.log(data))
//     .catch(error => console.error('There was a problem with the fetch operation:', error));

///////// PROMISE


// const promise =new Promise((resolve, reject) => {
//     const allWentWell = true;
    
//     if(allWentWell){
//         resolve("all things went well")
//     }else{
//         reject("smt went wrong")
//     }
// })

// console.log(promise)

// const promise = new Promise((resolve , reject)=>{
//     const randomNumber = Math.floor(Math.random() * 10);

//     setTimeout(()=> {

//         if(randomNumber > 5){
//             resolve(`random number is more than 5 and ${randomNumber}`)
//         }else{
//             reject(`random number is less than  5 and ${randomNumber}`)
//         }
//     })
// });

// const promiseTwo = new Promise((resolve , reject)=>{
//     const isAllGoof = true;

//     setTimeout(()=>{
//         if(isAllGoof){
//             resolve("no its not all good")
//         }else{
//             reject("yes its all good")
//         }
//     })
// })



// promise.then((value)=>{
//     console.log(value)
//     return promiseTwo
// }).then((value)=>{     // only executed if the first one resolves
//     console.log(value)  
// }).catch((error)=>{
//     console.log(error)
// });


// const promiseOne = new Promise((resolve ,reject)=> {
//     setTimeout(()=>{
//         resolve("resolved ok")
//     },2000)
// })

// const promiseTwo = new Promise((resolve ,reject)=> {
//     setTimeout(()=>{
//         resolve("resolved ok")
//     },1000)
// })

// const promiseThree = new Promise((resolve ,reject)=> {
//     setTimeout(()=>{
//         reject("noope")
//     },1500)
// })
// Promise.all([promiseOne , promiseTwo , promiseThree])
// .then((data)=> console.log(data[0], data[1], data[2]))
// .catch((error)=> console.log(error));

// const preheatOven = ()=> {
//     return new Promise((resolve , reject)=>{
//         setTimeout(()=>{
//             const preheatOven = false;

//             if(preheatOven){
//                 resolve("oven is hot")
//             }else{
//                 reject("cold bruuuv")
//             }
//         },1000)
//     })
// };

// const addSugarAndCoco = ()=> {
//     return new Promise((resolve , reject)=>{
//         setTimeout(()=>{
//             const preheatOven = true;

//             if(preheatOven){
//                 resolve("sugar and coco is added")
//             }else{
//                 reject("no sugar no coco damn it")
//             }
//         },1000)
//     })
// };

// const addFlavourAndSalt = ()=> {
//     return new Promise((resolve , reject)=>{
//         setTimeout(()=>{
//             const preheatOven = true;

//             if(preheatOven){
//                 resolve("salt and flavour is validated bruuuf")
//             }else{
//                 reject("okey no salt buuut no flavour thats actually mad bruuv maad thing bruuuv")
//             }
//         },1000)
//     })
// };

// const cookItBro = ()=> {
//     return new Promise((resolve , reject)=>{
//         setTimeout(()=>{
//             const preheatOven = true;

//             if(preheatOven){
//                 resolve("put it in the oven")
//             }else{
//                 reject("aight dont bakin then")
//             }
//         },1000)
//     })
// };

// const bakeCake = async() => {
//     try{
//         const taskOne = await preheatOven();
//         console.log(taskOne);

//         const taskTwo = await addSugarAndCoco();
//         console.log(taskTwo);

//         const taskThree = await addFlavourAndSalt();
//         console.log(taskThree);

//         const taskFour = await cookItBro();
//         console.log(taskFour);

//         console.log("enjoy bruuv")
//     }
//     catch(error){
//         console.log(error)
//     }
// }

// bakeCake();


//////////FETCH 


// fetch("https://dummyjson.com/products")
// .then(response => response.json())
// .then(data => console.log(data))
// .catch(error => console.log(error))



// fetch("https://dummyjson.com/products/add", {
//     method : "POST",
//     headers : {
//         "content-type" :"application/json"
//     },
//     body: JSON.stringify({
//         description : "Iphone 19",
//         price : "1000",
//         rating: "9/10"
//     })
// })
// .then(response => response.json())
// .then(data => console.log(data))
// .catch(error => console.log(error));


// fetch("https://dummyjson.com/products/1", {
//     method:"PUT",
//     headers:{
//         "content-type": "application/json"
//     },
//     body : JSON.stringify({
//         title :"iphone 19",
//         description: "changed to iphone 19",
//         price : "2000",
//         rating: "5/10"
//     })
// })
// .then(response=> response.json())
// .then(data=> console.log(data))
// .catch(error => console.log(error));

// fetch("https://dummyjson.com/products/2", {
//     method : "DELETE"
// })
// .then(response => response.json())
// .then(data => console.log(data))
// .catch(error => console.log(error));


const getAllProducts = async() => {
    try{
        const response = await fetch("https://dummyjson.com/products/");
        const json = await response.json();
        console.log(json);
    }
    catch(error){
        console.log(error);
    }
}

getAllProducts()