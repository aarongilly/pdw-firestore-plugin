// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import * as fire from 'firebase/firestore';
import * as pdw from 'pdw/out/pdw';


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

    //@ts-expect-error - //#TODO - make DataStore calls Async, obviously
    async commit(trans: pdw.Transaction): Promise<pdw.CommitResponse> {
        if (this.pdw === undefined) throw new Error("No PDW instance connected. Run the 'connect' method on the FireDataStore instance and pass in a ref to the PDW instance")
        const elementTypes = ['defs', 'entries'];
        elementTypes.forEach(async elementType => {
            //@ts-expect-error
            trans.create[elementType].forEach(async element => {
                try {
                    await fire.setDoc(fire.doc(this.db, elementType, element.uid), element.toData());
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
                    console.log('attempting to delete', element);

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

    async reducedQuery(params: pdw.ReducedParams): Promise<pdw.ReducedQueryResponse> {
        if (this.pdw === undefined) throw new Error("No PDW instance connected. Run the 'connect' method on the FireDataStore instance and pass in a ref to the PDW instance")
        console.info("running query with params:", params);
        let returnObj: pdw.ReducedQueryResponse = {
            success: true, //default assume happy!
            entries: [],
            defs: []
        }

        const whereClauses: fire.QueryFieldFilterConstraint[] = [];
        if (params.uid !== undefined) whereClauses.push(fire.where('_uid', 'in', params.uid));
        if (params.includeDeleted === 'no') whereClauses.push(fire.where('_deleted', '==', false));
        if (params.includeDeleted === 'only') whereClauses.push(fire.where('_deleted', '==', true));
        if (params.createdAfterEpochStr !== undefined) whereClauses.push(fire.where('_created', ">", params.createdAfterEpochStr));
        if (params.createdBeforeEpochStr !== undefined) whereClauses.push(fire.where('_created', "<", params.createdBeforeEpochStr));
        if (params.updatedAfterEpochStr !== undefined) whereClauses.push(fire.where('_updated', ">", params.updatedAfterEpochStr));
        if (params.updatedBeforeEpochStr !== undefined) whereClauses.push(fire.where('_updated', "<", params.updatedBeforeEpochStr));
        if (params.defLbl !== undefined) whereClauses.push(fire.where('_lbl', "in", params.defLbl));
        if (params.did !== undefined) whereClauses.push(fire.where('_did', 'in', params.did));
        if (params.tag !== undefined) whereClauses.push(fire.where('_tags', 'array-contains-any', params.tag));
        if (params.scope !== undefined) whereClauses.push(fire.where('_scope', 'in', params.scope));

        if (params.type === 'Def' || params.type === 'All') {
            try {
                let q = fire.query(fire.collection(this.db, 'defs'), ...whereClauses) as fire.CollectionReference;
                const docSnap = await fire.getDocs(q);
                docSnap.forEach(doc => {
                    returnObj.defs.push(doc.data() as pdw.DefData)
                })
            } catch (e: any) {
                returnObj.success = false;
                returnObj.msgs = e.toString();
                return returnObj;
            }
        }
        console.log(params.type);
        if (params.type === 'Entry' || params.type === 'All') {
            
            try {
                let q = fire.query(fire.collection(this.db, 'entries'), ...whereClauses) as fire.CollectionReference;
                const docSnap = await fire.getDocs(q);
                docSnap.forEach(doc => {
                    returnObj.entries.push(doc.data() as pdw.EntryData)
                })
            } catch (e: any) {
                returnObj.success = false;
                returnObj.msgs = e.toString();
                return returnObj;
            }
        }
        console.log(returnObj);

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
