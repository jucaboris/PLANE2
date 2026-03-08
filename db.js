import { initializeApp } from "";
import { getDatabase, ref, push, onValue, set, onChildAdded, remove } from "";

const firebaseConfig = {
apiKey: "AIzaSyBU61OITCzDbxC_Uyxn_CL4MOZAdUaZXSM",
authDomain: "sky-authority.firebaseapp.com",
databaseURL: "",
projectId: "sky-authority",
storageBucket: "sky-authority.firebasestorage.app",
messagingSenderId: "948867971899",
appId: "1:948867971899:web:7b09cc8e1471abed51151e"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export { ref, push, onValue, set, onChildAdded, remove };
