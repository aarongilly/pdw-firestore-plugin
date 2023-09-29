// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import * as fire from 'firebase/firestore';
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

    constructor(firestoreConfig: any) {
        this.serviceName = 'Firestore';
        this.isConnected = false;
        //attempt to setup Firestore connection using passed-in config
        initializeApp(firestoreConfig);
        this.db = fire.getFirestore()
        this.isConnected = true;
        console.log('✅ Connected to ' + this.db.app.options.projectId);
        this.allDefData = []; //#TODO
    }

    async commit(trans: pdw.Transaction): Promise<pdw.CommitResponse> {
        // console.log(this.allDefData, trans);
        if (this.pdw === undefined) throw new Error("No PDW instance connected. Run the 'connect' method on the FireDataStore instance and pass in a ref to the PDW instance")

        // update local cache of all Def data, then push that 
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
        try {
            await fire.setDoc(fire.doc(this.db, 'defManifest', 'allDefs'), { defs: this.allDefData });
        } catch (e) {
            console.error("Error adding defs document: ", e);
        }

        // write entries individually
        trans.create.entries.forEach(async element => {
            let data = translateElementToFirestore(element);
            try {
                await fire.setDoc(fire.doc(this.db, 'entries', element.uid), data);
            } catch (e) {
                console.error("Error creating adding document: ", e);
            }
        })
        trans.update.entries.forEach(async element => {
            let maybeJustOverWriteIsBetter = true;
            if (maybeJustOverWriteIsBetter) {
                let data = translateElementToFirestore(element);
                try {
                    await fire.setDoc(fire.doc(this.db, 'entries', element.uid), data);
                } catch (e) {
                    console.error("Error creating adding document: ", e);
                }
            } else {
                let data = translateElementToFirestore(element);
                try {
                    const docRef = fire.doc(this.db, 'entries', data._uid);
                    const docSnap = await fire.getDoc(docRef);
                    if (docSnap.exists()) {
                        const uid = data._uid;
                        const updated = pdw.makeEpochStr();
                        const deletionMsg = {
                            _updated: updated,
                            _deleted: true
                        }
                        await fire.setDoc(fire.doc(this.db, 'entries', uid), deletionMsg, { merge: true })
                        data._uid = pdw.makeUID();
                        data._updated = pdw.makeEpochStr();
                    }
                    return await fire.setDoc(fire.doc(this.db, 'entries', data._uid), data);

                } catch (e) {
                    console.error("Error updating entries document: ", e);
                }
            }
        })
        trans.delete.entries.forEach(async element => {
            try {
                await fire.setDoc(fire.doc(this.db, 'entries', element.uid), {
                    _deleted: element.deleted,
                    _updated: element.updated
                }, { merge: true });
            } catch (e) {
                console.error("Error deleting entries document: ", e);
            }
        })
        return {
            success: true,
        }
    }

    async getDefs(includeDeletedForArchiving = false): Promise<pdw.DefData[]> {
        let q = fire.query(fire.collection(this.db, 'defManifest')) as fire.CollectionReference;
        const docSnap = await fire.getDocs(q);

        this.allDefData = []; //zero it out
        docSnap.forEach(doc => {
            const parsedDefData = doc.data().defs as pdw.DefData[];
            this.allDefData.push(...parsedDefData)
        });
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
        return fire.query(fire.collection(this.db, 'entries'), ...whereClauses);
    }

    async getEntries(params: pdw.ReducedParams): Promise<pdw.ReducedQueryResponse> {
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

        // console.log(returnObj);

        return returnObj
    }

    async getOverview(): Promise<pdw.DataStoreOverview> {
        if (this.pdw === undefined) throw new Error("No PDW instance connected. Run the 'connect' method on the FireDataStore instance and pass in a ref to the PDW instance")
        throw new Error("Method not implemented.");
    }

    static async init(firebaseConfig: any, pdwRef: pdw.PDW): Promise<boolean> {
        const firestoreInstance = new FireDataStore(firebaseConfig);
        await firestoreInstance.connect(pdwRef);
        await pdwRef.setDataStore(firestoreInstance);
        return true
    }

    async connect(pdw: pdw.PDW): Promise<boolean> {
        this.pdw = pdw;
        return true
    }
}
