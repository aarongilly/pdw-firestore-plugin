// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import * as fire from 'firebase/firestore';
import { Auth, User, getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'firebase/auth';
import * as pdw from 'pdw';

function translateElementToFirestore(element: pdw.Entry | pdw.Def): any {
    let returnData = element.toData()
    if (element.getType() === 'EntryData') returnData.periodEnd = (<pdw.Entry>element).period.getEnd().toString();
    return returnData;
}

function translateFirestoreToEntry(firestoreEntryData: any): pdw.EntryData {
    let fireDataCopy = JSON.parse(JSON.stringify(firestoreEntryData));
    delete fireDataCopy.periodEnd;
    return fireDataCopy as pdw.EntryData
}

export class FireDataStore implements pdw.DataStore {
    pdw?: pdw.PDW;
    serviceName: string;
    isConnected: boolean;
    db: fire.Firestore;
    allDefData: pdw.DefData[];
    auth: Auth;
    user: User | undefined;
    /**
     * Whatever data an application wants to load alongside defs in the user's data
     */
    configData: any;

    private constructor(firestoreConfig: any, signInCallback?: Function, signOutCallback?: Function) {
        this.serviceName = 'Firestore';
        this.isConnected = false;
        //attempt to setup Firestore connection using passed-in config
        let app = initializeApp(firestoreConfig);
        this.auth = getAuth(app);
        this.db = fire.getFirestore()
        this.isConnected = true;
        console.log('✅ Connected to ' + this.db.app.options.projectId);
        this.allDefData = [];
        this.setupAuthStateHandler(signInCallback, signOutCallback);
    }

    public signupUser(email: string, password: string) {
        console.log('signing up ' + email);
        createUserWithEmailAndPassword(this.auth, email, password)
            .then((userCredential) => {
                // Signed up 
                this.user = userCredential.user;
                console.log('signed up with: ' + this.user.email);
                this.pdw!.setDataStore(this);
                const configRef = fire.doc(this.db, this.user.uid, '!defManifest');
                fire.setDoc(configRef, {
                    email: this.user.email,
                }, {merge: true})
            })
            .catch((error) => {
                const errorCode = error.code;
                const errorMessage = error.message;
                console.error('Signup error!', errorCode, errorMessage);
            });
    }

    async getConfigData(){
        if (this.user === undefined) console.log('no user seen');
        const configRef = fire.doc(this.db, this.user!.uid, '!defManifest');
        this.configData = (await fire.getDoc(configRef)).data();
        return this.configData;
    }

    async setConfigDataField(key:string, value: any){
        if (this.user === undefined) console.log('no user seen');
        const configRef = fire.doc(this.db, this.user!.uid, '!defManifest');
        if(key === 'defs' || key === 'email') throw new Error('Cannot set keys "defs" or "email"');
        fire.setDoc(configRef, {
            [key]: value,
        }, {merge: true})
    }

    async logoutUser() {
        if (this.user === undefined) console.log('no user seen');
        await signOut(this.auth);
        this.user = undefined;
    }

    loginUser(email: string, password: string) {
        signInWithEmailAndPassword(this.auth, email, password)
            .then((userCredential) => {
                // Signed in 
                this.user = userCredential.user;
                this.pdw!.setDataStore(this);
            })
            .catch((error) => {
                const errorCode = error.code;
                const errorMessage = error.message;
                console.error('Login error!', errorCode, errorMessage);
            });
    }

    setupAuthStateHandler(loginFunc?: Function, logoutFunc?: Function) {
        onAuthStateChanged(this.auth, async (user) => {
            if (user) {
                this.user = user;
                this.pdw!.setDataStore(this);
                if (loginFunc !== undefined) {
                    loginFunc()
                } else {
                    console.log('Logged in ' + user.email);
                }
            } else {
                console.log('Logging out, reverting to in-memory datastore.');                
                this.pdw!.setDataStore(new pdw.DefaultDataStore(this.pdw!));
                if (logoutFunc !== undefined) {
                    logoutFunc()
                } else {
                    console.log('Logged out');
                }
            }
        });
    }

    async commit(trans: pdw.Transaction): Promise<pdw.CommitResponse> {
        if (this.pdw === undefined) throw new Error("No PDW instance connected. Run the 'init' method on the FireDataStore instance and pass in a ref to the PDW instance");
        if (this.user === undefined){
            console.warn("No user signed in. Doing nothing and returning an empty commit response.");
            return {
                success: false,
                msgs: ['No user signed in'],
                entryData: [],
                defData: [],
            }
        }

        let returnObj: pdw.CommitResponse = {
            success: true,
        }

        // update local cache of all Def data, then push to that
        let batch = fire.writeBatch(this.db);
        if (trans.create.defs.length > 0 || trans.update.defs.length > 0 || trans.delete.defs.length > 0) {
            trans.create.defs.forEach(def => {
                this.allDefData.push(def.toData() as pdw.DefData); //create means you *know* its not already there
            })
            trans.update.defs.forEach(def => {
                let assDefData = this.allDefData.find(storeDef => storeDef._did === def.did && !storeDef._deleted);
                if (assDefData !== undefined) {
                    assDefData._deleted = true;
                    assDefData._updated = def.updated;
                } else {
                    console.warn('No old Def found associated with the update request for uid ' + def.did + ', just pushing the new one in.');
                }
                this.allDefData.push(def.toData() as pdw.DefData); //create means you *know* its not already there
            })
            trans.delete.defs.forEach(deletionMsg => {
                let assDefData = this.allDefData.find(def => def._uid === deletionMsg.uid);
                if (assDefData === undefined) return console.warn('No Def found associated with the deletion request for uid ' + deletionMsg.uid);
                assDefData._deleted = deletionMsg.deleted;
                assDefData._updated = deletionMsg.updated;
            })
            batch.set(fire.doc(this.db, this.user!.uid, '!defManifest'), { defs: this.allDefData }, {merge: true});
        }

        //ENTRIES
        trans.create.entries.forEach(async element => {
            let data = translateElementToFirestore(element);
            batch.set(fire.doc(this.db, this.user!.uid, element.uid), data)
        })
        trans.update.entries.forEach(async element => {
            let data = translateElementToFirestore(element);
            batch.set(fire.doc(this.db, this.user!.uid, element.uid), data)
        })
        trans.delete.entries.forEach(async element => {
            batch.set(fire.doc(this.db, this.user!.uid, element.uid), {
                _deleted: element.deleted,
                _updated: element.updated
            }, { merge: true })
        })
        try {
            await batch.commit();
            console.log('Batch write to Firestore went well, yo.');
            returnObj.defData = [...trans.create.defs.map(d => d.toData() as pdw.DefData), ...trans.update.defs.map(d => d.toData() as pdw.DefData)];
            returnObj.entryData = [...trans.create.entries.map(d => d.toData() as pdw.EntryData), ...trans.update.entries.map(d => d.toData() as pdw.EntryData)];
            returnObj.delDefs = trans.delete.defs;
            returnObj.delEntries = trans.delete.entries;
        } catch (e) {
            console.error("An error occurred during the batch entry write:", e);
            returnObj.msgs?.push('Error during batch entry write')
            returnObj.success = false;
        }
        return returnObj
    }

    async getDefs(includeDeletedForArchiving = false): Promise<pdw.DefData[]> {
        if (this.user === undefined){
            console.warn("No user signed in. Doing nothing and returning an empty array.");
            return []
        }
        let docRef = fire.doc(this.db, this.user.uid, '!defManifest')
        const docSnap = await fire.getDoc(docRef);
        const defObj = docSnap.data() as {defs: pdw.DefData[]};
        console.log('🔥',defObj);
        
        this.allDefData = [...defObj.defs];
        if (includeDeletedForArchiving) return this.allDefData;
        return this.allDefData.filter(def => !def._deleted);
    }

    subscribeToQuery(params: pdw.ReducedParams, callback: (entries: pdw.Entry[]) => any): Function {
        const pdwRef = pdw.PDW.getInstance();
        const unsub = fire.onSnapshot(this.buildQueryFromParams(params), (docSnap) => {
            let entries: pdw.Entry[] = [];
            docSnap.forEach(doc => {
                const parsedEntryData = translateFirestoreToEntry(doc.data()) as pdw.EntryData;
                entries.push(new pdw.Entry(parsedEntryData));
            })
            callback(entries);
        })
        return unsub
    }

    private buildQueryFromParams(params: pdw.ReducedParams): fire.Query {
        const whereClauses: fire.QueryFieldFilterConstraint[] = [];
        if (params.uid !== undefined) whereClauses.push(fire.where('_uid', 'in', params.uid));
        if (params.includeDeleted === 'no') whereClauses.push(fire.where('_deleted', '==', false));
        if (params.includeDeleted === 'only') whereClauses.push(fire.where('_deleted', '==', true));
        if (params.createdAfterEpochStr !== undefined) whereClauses.push(fire.where('_created', ">", params.createdAfterEpochStr));
        if (params.createdBeforeEpochStr !== undefined) whereClauses.push(fire.where('_created', "<", params.createdBeforeEpochStr));
        if (params.updatedAfterEpochStr !== undefined) whereClauses.push(fire.where('_updated', ">", params.updatedAfterEpochStr));
        if (params.updatedBeforeEpochStr !== undefined) whereClauses.push(fire.where('_updated', "<", params.updatedBeforeEpochStr));
        if (params.did !== undefined) whereClauses.push(fire.where('_did', 'in', params.did));
        if (params.scope !== undefined) whereClauses.push(fire.where('_scope', 'in', params.scope));
        if (params.from !== undefined) whereClauses.push(fire.where('periodEnd', ">=", params.from.getStart().toString()));
        if (params.to !== undefined) whereClauses.push(fire.where('periodEnd', "<=", params.to.getEnd().toString()));
        return fire.query(fire.collection(this.db, this.user!.uid, 'entries'), ...whereClauses);
    }

    async getEntries(params: pdw.ReducedParams): Promise<pdw.ReducedQueryResponse> {
        if (this.user === undefined){
            console.warn("No user signed in. Doing nothing and returning an empty array.");
            return {
                success: false,
                msgs: ['No user signed in.'],
                entries: []
            }
        }
        if (this.pdw === undefined) throw new Error("No PDW instance connected. Run the 'connect' method on the FireDataStore instance and pass in a ref to the PDW instance")
        let returnObj: pdw.ReducedQueryResponse = {
            success: true, //default assume happy!
            entries: []
        }

        let q = this.buildQueryFromParams(params)

        try {
            const docSnap = await fire.getDocs(q);
            docSnap.forEach(doc => {
                const parsedEntryData = translateFirestoreToEntry(doc.data()) as pdw.EntryData;
                returnObj.entries.push(parsedEntryData)
            })
        } catch (e: any) {
            returnObj.success = false;
            returnObj.msgs = e.toString();
            return returnObj;
        }
        return returnObj
    }

    async getOverview(): Promise<pdw.DataStoreOverview> {
        if (this.pdw === undefined) throw new Error("No PDW instance connected. Run the 'connect' method on the FireDataStore instance and pass in a ref to the PDW instance")
        throw new Error("Method not implemented.");
    }

    static async init(firebaseConfig: any, pdwRef: pdw.PDW, loginCallback?: Function, logOutCallback?: Function): Promise<FireDataStore> {
        const firestoreInstance = new FireDataStore(firebaseConfig, loginCallback, logOutCallback);
        await firestoreInstance.connect(pdwRef);
        // await pdwRef.setDataStore(firestoreInstance);
        return firestoreInstance;
    }

    async connect(pdw: pdw.PDW): Promise<boolean> {
        this.pdw = pdw;
        return true
    }
}

