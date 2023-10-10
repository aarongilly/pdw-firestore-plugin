import './style.css'
import * as pdw from 'pdw';
import { FireDataStore } from './firestore';
// import { Query } from 'firebase/firestore';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <h1>Firestore DataStore</h1>
  <p>Do some work.</p>
  <button id="sign-up">Sign up</button>
  <button id="login"">Log in</button>
  <button id="log-out"">Log out</button>
  <button id="log-user"">Log User</button>
  <h2>Inputs</h2>
  <p>Email</p>
  <input id="email" placeholder="email"></input>
  <p>Password</p>
  <input id="password" placeholder="password"></input>
  <h2>Read/Write</h2>
  <button id="read"">Read</button>
  <button id="write">Write</button>
  <p id="result-head">Result</p>
  <p id="result" style="font-family:consolas;font-size:18px;color:grey;white-space:pre-wrap;text-align:left">run a search</p>
`

let userNameInput = document.querySelector<HTMLButtonElement>('#email')!
userNameInput.value = 'aarongilly@gmail.com';//'uid';
let passwordInput = document.querySelector<HTMLButtonElement>('#password')!
passwordInput.value = 'peanutbutter';//'lmp14tdp-2egb';

//establish singleton
let pdwRef = pdw.PDW.getInstance();

//THE DEVELOPMENT ONE---- pdw-firestore-island!
const firebaseConfig = {
    apiKey: "AIzaSyDmBBpJsp7QGb8qpdimTvE_AzQCPfpTLyM",
    authDomain: "pdw-firestore-island.firebaseapp.com",
    projectId: "pdw-firestore-island",
    storageBucket: "pdw-firestore-island.appspot.com",
    messagingSenderId: "539842554749",
    appId: "1:539842554749:web:b15e07738db08888c4fa14"
};

let fireStoreRef = await FireDataStore.init(firebaseConfig, pdwRef, ()=>console.log('HI MOM'), ()=>console.log('BYE MOM'));

let signupBtn = document.querySelector<HTMLButtonElement>('#sign-up')!
let loginBtn = document.querySelector<HTMLButtonElement>('#login')!
let logoutBtn = document.querySelector<HTMLButtonElement>('#log-out')!
let logUserBtn = document.querySelector<HTMLButtonElement>('#log-user')!
let readBtn = document.querySelector<HTMLButtonElement>('#read')!
let writeBtn = document.querySelector<HTMLButtonElement>('#write')!

signupBtn.onclick = () => {
    fireStoreRef.signupUser(userNameInput.value, passwordInput.value);
}
loginBtn.onclick = () => {
    fireStoreRef.loginUser(userNameInput.value, passwordInput.value);
}
logoutBtn.onclick = () => {
    fireStoreRef.logoutUser();
}
logUserBtn.onclick = () => {
    console.log(fireStoreRef.user);
    console.log(pdwRef);
}
readBtn.onclick = async () => {
    const defs = await pdwRef.getEntries({includeDeleted: 'yes'});
    console.log(pdwRef.manifest);
}
writeBtn.onclick = async () => {
    await pdwRef.newDef({_did: 'bbbb', _lbl: "Test B"});
    console.log(pdwRef.manifest);
}

// await pdwRef.getFromManifest('bbbb').newEntry({});

// console.log(await pdwRef.getDefs(true))

async function write() {
    let def = pdwRef.getFromManifest('zzfh');
    let e1 = new pdw.Entry({
        '7qhv': 'Meta',
        'btz9': "Entry 1"
    }, def);
    let e2 = new pdw.Entry({
        '7qhv': 'Meta',
        'btz9': "Entry 2"
    }, def);
    let e3 = new pdw.Entry({
        '7qhv': 'Meta',
        'btz9': "Entry 3"
    }, def);
    let result = await pdwRef.setAll({ entries: [e1, e2, e3], defs: [] })

    console.log(result);
}

async function read() {
    const key = document.querySelector<HTMLButtonElement>('#key')!.value;
    const val = document.querySelector<HTMLButtonElement>('#val')!.value;

    document.querySelector<HTMLButtonElement>('#result')!.innerText = "...searching";

    // let def = await pdwRef.getDefs({[key]: val, includeDeleted: 'yes' });
    // let entries = await pdwRef.getEntries({[key]: val, includeDeleted: 'yes' });
    let q = new pdw.Query({ [key]: val, includeDeleted: 'no' });
    // q.forDids(val);
    const result = await q.run();
    //   let def = await pdwRef.getDefs({type: "Def", did: 'bbbb', includeDeleted: 'yes'});
    //   let def = await pdwRef.getDefs({type: "Def", updatedAfter: 'lmh85om9', createdBefore: 'lmh85omb', includeDeleted: 'yes'});

    // console.log(result);

    (<FireDataStore>pdwRef.dataStore).subscribeToQuery({ [key]: val, includeDeleted: 'no' }, (data) => {
        console.log(data);
        document.querySelector<HTMLButtonElement>('#result-head')!.innerText = key + ": " + val;
        document.querySelector<HTMLButtonElement>('#result')!.innerHTML = 'Length: ' + data.length + "<br/>" + JSON.stringify(data.map(d => d.toData()), null, 4);
    });
}