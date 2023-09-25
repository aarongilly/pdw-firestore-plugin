import './style.css'
import * as pdw from 'pdw';
import { FireDataStore } from './firestore';
// import { Query } from 'firebase/firestore';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <h1>Firestore DataStore</h1>
  <p>Do some work.</p>
  <button id="write">Write</button>
  <button id="read"">Read</button>
  <h2>Inputs</h2>
  <p>Key</p>
  <input id="key" placeholder="key"></input>
  <p>Value</p>
  <input id="val" placeholder="val"></input>
  <p id="result-head">Result</p>
  <p id="result" style="font-family:consolas;font-size:18px;color:grey;white-space:pre-wrap;text-align:left">run a search</p>
`

let writeBtn = document.querySelector<HTMLButtonElement>('#write')!
let readBtn = document.querySelector<HTMLButtonElement>('#read')!
writeBtn.onclick = write;
readBtn.onclick = read;

document.querySelector<HTMLButtonElement>('#key')!.value = 'did';//'uid';
document.querySelector<HTMLButtonElement>('#val')!.value = 'dddd';//'lmp14tdp-2egb';

document.querySelector<HTMLButtonElement>('#val')!.onkeyup = (key => {
    if (key.code === "Enter") read();
})

//establish singleton
let pdwRef = pdw.PDW.getInstance();

//firebase stuff
const firebaseConfig = {
    apiKey: "AIzaSyBv4E0pHye0OwNU3nzVwsDFw8Q2mSKkmTc",
    authDomain: "pdw-firedatastore.firebaseapp.com",
    projectId: "pdw-firedatastore",
    storageBucket: "pdw-firedatastore.appspot.com",
    messagingSenderId: "59120475131",
    appId: "1:59120475131:web:435d58cffcf9e629ed495e"
};

await FireDataStore.init(firebaseConfig, pdwRef);

async function write() {
    // console.log(pdwRef.manifest);
    // return
    let def = pdwRef.getFromManifest("0vnh");
    console.log('Writing');
    def.newEntry({
        '_note': 'Hello world!'
    })
}

async function read() {
    const key = document.querySelector<HTMLButtonElement>('#key')!.value;
    const val = document.querySelector<HTMLButtonElement>('#val')!.value;

    document.querySelector<HTMLButtonElement>('#result')!.innerText = "...searching";

    // let def = await pdwRef.getDefs({[key]: val, includeDeleted: 'yes' });
    let entries = await pdwRef.getEntries({[key]: val, includeDeleted: 'yes' });
    // let q = new pdw.Query();
    // q.forDids(val);
    // const result = await q.run();
    //   let def = await pdwRef.getDefs({type: "Def", did: 'bbbb', includeDeleted: 'yes'});
    //   let def = await pdwRef.getDefs({type: "Def", updatedAfter: 'lmh85om9', createdBefore: 'lmh85omb', includeDeleted: 'yes'});

    console.log(entries);

    document.querySelector<HTMLButtonElement>('#result-head')!.innerText = key + ": " + val;
    document.querySelector<HTMLButtonElement>('#result')!.innerHTML = 'Length: ' + entries.length + "<br/>" + JSON.stringify(entries.map(d => d.toData()), null, 4);
}

