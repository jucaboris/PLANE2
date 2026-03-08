import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getDatabase, ref, push, onValue, onChildAdded, set, remove } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBU61OITCzDbxC_Uyxn_CL4MOZAdUaZXSM",
  authDomain: "sky-authority.firebaseapp.com",
  databaseURL: "https://sky-authority-default-rtdb.firebaseio.com",
  projectId: "sky-authority",
  storageBucket: "sky-authority.firebasestorage.app",
  messagingSenderId: "948867971899",
  appId: "1:948867971899:web:7b09cc8e1471abed51151e",
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export { ref, push, onValue, onChildAdded, set, remove };
