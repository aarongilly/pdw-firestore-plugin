// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import * as fire from 'firebase/firestore';
import * as pdw from 'pdw';

function translateEntryToFirestore(entry: pdw.Entry): any {
    let returnData = entry.toData()
    returnData.periodEnd = entry.period.getEnd().toString();
    return returnData;
}

function translateFirestoreToEntry(firestoreEntryData: any): pdw.EntryData {
    let fireDataCopy = JSON.parse(JSON.stringify(firestoreEntryData));
    delete fireDataCopy.periodEnd;
    return fireDataCopy as pdw.EntryData
}

// function periodToTimeStamp(period: pdw.Period): Timestamp {
//     return new Timestamp(period.getEnd().toTemporalPlainDate().toZonedDateTime('UTC').epochSeconds, 0);
// }

export class FireDataStore implements pdw.DataStore {
    pdw?: pdw.PDW;
    serviceName: string;
    isConnected: boolean;
    db: fire.Firestore;

    constructor(firestoreConfig: any) {
        this.serviceName = 'Firestore';
        this.isConnected = false;
        //attempt to setup Firestore connection using passed-in config
        initializeApp(firestoreConfig);
        this.db = fire.getFirestore()
        this.isConnected = true;
        console.log('✅ Connected to ' + this.db.app.options.projectId);
    }

    //@ts-expect-error
    async commit(trans: pdw.Transaction): Promise<pdw.CommitResponse> {
        if (this.pdw === undefined) throw new Error("No PDW instance connected. Run the 'connect' method on the FireDataStore instance and pass in a ref to the PDW instance")
        const elementTypes = ['defs', 'entries'];
        elementTypes.forEach(async elementType => {
            //@ts-expect-error
            trans.create[elementType].forEach(async element => {
                let data = translateEntryToFirestore(element);
                try {
                    await fire.setDoc(fire.doc(this.db, elementType, element.uid), data);
                } catch (e) {
                    console.error("Error adding document: ", e);
                }
            })
            //@ts-expect-error
            trans.update[elementType].forEach(async element => {
                try {
                    const docRef = fire.doc(this.db, elementType, element.uid);
                    const docSnap = await fire.getDoc(docRef);
                    if (docSnap.exists()) {
                        const uid = element.uid;
                        const updated = pdw.makeEpochStr();
                        const deletionMsg = {
                            _updated: updated,
                            _deleted: true
                        }
                        await fire.setDoc(fire.doc(this.db, elementType, uid), deletionMsg, { merge: true })
                        element.data._uid = pdw.makeUID();
                        element.data._updated = pdw.makeEpochStr();

                    }
                    return await fire.setDoc(fire.doc(this.db, elementType, element.uid), element.toData());

                } catch (e) {
                    console.error("Error adding document: ", e);
                }
            })
            //@ts-expect-error
            trans.delete[elementType].forEach(async element => {
                try {
                    await fire.setDoc(fire.doc(this.db, elementType, element.uid), {
                        _deleted: element.deleted,
                        _updated: element.updated
                    }, { merge: true });
                } catch (e) {
                    console.error("Error adding document: ", e);
                }
            })
        })
    }

    async getDefs(includeDeletedForArchiving = false): Promise<pdw.DefData[]> {
        let returnArr: pdw.DefData[] = [];
        const whereClauses: fire.QueryFieldFilterConstraint[] = [];
        if (!includeDeletedForArchiving) {
            whereClauses.push(fire.where('_deleted', '==', false));
        }
        let q = fire.query(fire.collection(this.db, 'defs'), ...whereClauses) as fire.CollectionReference;
        const docSnap = await fire.getDocs(q);
        docSnap.forEach(doc => {
            const parsedDefData = doc.data() as pdw.DefData;
            returnArr.push(parsedDefData)
        })
        return returnArr
    }

    subscribeToQuery(params: pdw.ReducedParams, callback: (entries: pdw.Entry[]) => any): Function{
        const pdwRef = pdw.PDW.getInstance();
        const unsub = fire.onSnapshot(this.buildQueryFromParams(params),(docSnap)=>{
            let entries: pdw.Entry[] = [];
            docSnap.forEach(doc => {
                const parsedEntryData = translateFirestoreToEntry(doc.data()) as pdw.EntryData;
                entries.push(new pdw.Entry(parsedEntryData));
            })
            callback(entries);
        })
        return unsub
    }

    private buildQueryFromParams(params: pdw.ReducedParams): fire.Query{
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
