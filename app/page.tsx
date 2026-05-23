"use client";

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Timestamp
} from "firebase/firestore";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User
} from "firebase/auth";
import { useEffect, useMemo, useState } from "react";
import { getFirebaseClient } from "@/lib/firebase";

type Expense = {
  id: string;
  title: string;
  amount: number;
  isReimbursement: boolean;
  createdAt?: Timestamp;
};

const expensesCacheKey = "spese_casa_local_v1";
const roundingCacheKey = "spese_casa_rounding_v1";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR"
  }).format(value);
}

function parseAmount(value: string) {
  const normalized = value.replace(",", ".").trim();
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : NaN;
}

function loadCachedExpenses() {
  if (typeof window === "undefined") return [];

  try {
    const raw = localStorage.getItem(expensesCacheKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Expense[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadCachedRounding() {
  if (typeof window === "undefined") return "";

  try {
    return localStorage.getItem(roundingCacheKey) ?? "";
  } catch {
    return "";
  }
}

export default function Home() {
  const ledgerId = process.env.NEXT_PUBLIC_HOME_EXPENSES_ID || "casa";
  const firebase = useMemo(() => getFirebaseClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [title, setTitle] = useState("");
  const [rounding, setRounding] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setExpenses(loadCachedExpenses());
    setRounding(loadCachedRounding());
  }, []);

  useEffect(() => {
    if (!firebase) {
      setAuthReady(true);
      setLoading(false);
      return;
    }

    return onAuthStateChanged(firebase.auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
    });
  }, [firebase]);

  useEffect(() => {
    if (!firebase || !user) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const expensesQuery = query(
      collection(firebase.db, "home_expenses", ledgerId, "items"),
      orderBy("createdAt", "asc")
    );

    return onSnapshot(
      expensesQuery,
      (snapshot) => {
        const nextExpenses = snapshot.docs.map((item) => ({
          id: item.id,
          ...(item.data() as Omit<Expense, "id">)
        }));
        setExpenses(nextExpenses);
        localStorage.setItem(expensesCacheKey, JSON.stringify(nextExpenses));
        setLoading(false);
        setError("");
      },
      () => {
        setError("Firebase non lascia leggere o scrivere. Controlla le regole Firestore.");
        setLoading(false);
      }
    );
  }, [firebase, ledgerId, user]);

  useEffect(() => {
    if (!firebase || !user) return;

    const settingsRef = doc(firebase.db, "home_expenses", ledgerId, "settings", "main");

    return onSnapshot(
      settingsRef,
      (snapshot) => {
        const value = snapshot.exists() ? String(snapshot.data().rounding ?? "") : "";
        setRounding(value);
        localStorage.setItem(roundingCacheKey, value);
      },
      () => {
        setError("Firebase non lascia leggere l'arrotondamento. Controlla le regole Firestore.");
      }
    );
  }, [firebase, ledgerId, user]);

  const sortedExpenses = useMemo(
    () =>
      [...expenses].sort((first, second) => {
        const firstDate = first.createdAt?.toMillis?.() ?? 0;
        const secondDate = second.createdAt?.toMillis?.() ?? 0;
        return firstDate - secondDate;
      }),
    [expenses]
  );
  const regularTotal = useMemo(
    () => expenses.filter((expense) => !expense.isReimbursement).reduce((sum, expense) => sum + expense.amount, 0),
    [expenses]
  );
  const reimbursementTotal = useMemo(
    () => expenses.filter((expense) => expense.isReimbursement).reduce((sum, expense) => sum + expense.amount, 0),
    [expenses]
  );
  const roundingAmount = useMemo(() => {
    const parsed = rounding.trim() === "" ? 0 : parseAmount(rounding);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [rounding]);
  const netTotal = regularTotal - reimbursementTotal;
  const myShare = netTotal / 2 - roundingAmount;

  async function login() {
    if (!firebase) return;
    setError("");
    try {
      await signInWithPopup(firebase.auth, firebase.googleProvider);
    } catch (loginError) {
      const message =
        loginError instanceof Error ? loginError.message : "Errore sconosciuto";
      const code =
        typeof loginError === "object" && loginError && "code" in loginError
          ? String(loginError.code)
          : "senza codice";

      setError(`Login non riuscito: ${code} - ${message}`);
    }
  }

  async function addExpense() {
    if (!firebase) return;
    const cleanTitle = title.trim();

    if (!cleanTitle) {
      setError("Inserisci una voce di spesa.");
      return;
    }

    try {
      await addDoc(collection(firebase.db, "home_expenses", ledgerId, "items"), {
        title: cleanTitle,
        amount: 0,
        isReimbursement: false,
        createdAt: serverTimestamp()
      });
      setTitle("");
      setError("");
    } catch {
      setError("Firebase non lascia salvare questa voce. Controlla le regole Firestore.");
    }
  }

  async function updateAmount(id: string, value: string) {
    if (!firebase) return;
    const parsedAmount = value === "" ? 0 : parseAmount(value);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) return;

    setExpenses((current) =>
      current.map((expense) =>
        expense.id === id ? { ...expense, amount: parsedAmount } : expense
      )
    );

    try {
      await updateDoc(doc(firebase.db, "home_expenses", ledgerId, "items", id), {
        amount: parsedAmount
      });
      setError("");
    } catch {
      setError("Firebase non lascia modificare l'importo. Controlla le regole Firestore.");
    }
  }

  async function toggleReimbursement(expense: Expense) {
    if (!firebase) return;

    setExpenses((current) =>
      current.map((item) =>
        item.id === expense.id ? { ...item, isReimbursement: !expense.isReimbursement } : item
      )
    );

    try {
      await updateDoc(doc(firebase.db, "home_expenses", ledgerId, "items", expense.id), {
        isReimbursement: !expense.isReimbursement
      });
      setError("");
    } catch {
      setError("Firebase non lascia modificare questa voce. Controlla le regole Firestore.");
    }
  }

  async function updateRounding(value: string) {
    if (!firebase) return;
    setRounding(value);
    localStorage.setItem(roundingCacheKey, value);

    try {
      await setDoc(
        doc(firebase.db, "home_expenses", ledgerId, "settings", "main"),
        { rounding: value, updatedAt: serverTimestamp() },
        { merge: true }
      );
      setError("");
    } catch {
      setError("Firebase non lascia salvare l'arrotondamento. Controlla le regole Firestore.");
    }
  }

  async function removeExpense(id: string) {
    if (!firebase) return;
    const ok = window.confirm("Eliminare questa voce?");
    if (!ok) return;

    try {
      await deleteDoc(doc(firebase.db, "home_expenses", ledgerId, "items", id));
      setError("");
    } catch {
      setError("Firebase non lascia eliminare questa voce. Controlla le regole Firestore.");
    }
  }

  async function clearAll() {
    if (!firebase) return;
    const ok = window.confirm("Eliminare tutte le spese?");
    if (!ok) return;

    try {
      await Promise.all(
        expenses.map((expense) =>
          deleteDoc(doc(firebase.db, "home_expenses", ledgerId, "items", expense.id))
        )
      );
      setError("");
    } catch {
      setError("Firebase non lascia svuotare la lista. Controlla le regole Firestore.");
    }
  }

  async function markPaid() {
    if (!firebase) return;
    const ok = window.confirm("Segnare tutto come pagato e azzerare gli importi?");
    if (!ok) return;

    setExpenses((current) => current.map((expense) => ({ ...expense, amount: 0 })));

    try {
      await Promise.all(
        expenses.map((expense) =>
          updateDoc(doc(firebase.db, "home_expenses", ledgerId, "items", expense.id), {
            amount: 0
          })
        )
      );
      setError("");
    } catch {
      setError("Firebase non lascia segnare le spese come pagate. Controlla le regole Firestore.");
    }
  }

  if (!authReady) {
    return <main className="container">Caricamento...</main>;
  }

  if (!firebase) {
    return (
      <main className="container auth-screen">
        <section className="login-panel">
          <i className="ti ti-settings" />
          <h1>Firebase da configurare</h1>
          <p>Crea `.env.local` partendo da `.env.local.example` e inserisci i dati della tua web app Firebase.</p>
        </section>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="container auth-screen">
        <section className="login-panel">
          <i className="ti ti-home-dollar" />
          <h1>Spese Casa</h1>
          <p>Accedi con Google per gestire le spese condivise.</p>
          {error ? <p className="login-error">{error}</p> : null}
          <button className="btn btn-primary btn-large" onClick={() => void login()}>
            <i className="ti ti-brand-google" />
            Accedi con Google
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="container">
      <header>
        <div>
          <h1>
            <i className="ti ti-home-dollar" />
            Spese Casa
          </h1>
          <p>Aggiungi le spese condivise, segna i rimborsi e calcola la metÃ  da versare.</p>
        </div>
        <button className="btn" onClick={() => signOut(firebase.auth)}>
          <i className="ti ti-logout" />
          Esci
        </button>
      </header>

      {error ? (
        <div className="notice danger">
          <strong>Attenzione</strong>
          <span>{error}</span>
          <code>{user.uid}</code>
        </div>
      ) : null}

      <section className="card summary-card">
        <div className="summary-item">
          <span>Spese</span>
          <strong>{formatCurrency(regularTotal)}</strong>
        </div>
        <div className="summary-item reimbursement">
          <span>Rimborsi</span>
          <strong>- {formatCurrency(reimbursementTotal)}</strong>
        </div>
        <div className="summary-item total">
          <span>Totale netto</span>
          <strong>{formatCurrency(netTotal)}</strong>
        </div>
        <label className="summary-item rounding">
          <span>Arrotondamento</span>
          <div className="summary-input">
            <span>â‚¬</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={rounding}
              onChange={(event) => void updateRounding(event.target.value)}
              placeholder="0"
            />
          </div>
        </label>
        <div className="summary-item share">
          <span>La tua metÃ </span>
          <strong>{formatCurrency(myShare)}</strong>
        </div>
      </section>

      <section className="card">
        <p className="section-title">Aggiungi una voce</p>
        <div className="add-row">
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void addExpense();
            }}
            placeholder="es. bolletta acqua"
          />
          <button className="btn btn-primary" onClick={() => void addExpense()}>
            <i className="ti ti-plus" />
            Aggiungi
          </button>
        </div>
      </section>

      <section className="card">
        <div className="section-heading">
          <p className="section-title">Voci inserite</p>
          <div className="section-actions">
            <button className="btn btn-small" type="button">
              <i className="ti ti-mail" />
              Notifica
            </button>
            {expenses.length > 0 ? (
              <button className="btn btn-success btn-small" onClick={() => void markPaid()}>
                <i className="ti ti-check" />
                Pagato
              </button>
            ) : null}
            {expenses.length > 0 ? (
              <button className="btn btn-danger btn-small" onClick={() => void clearAll()}>
                <i className="ti ti-trash" />
                Svuota
              </button>
            ) : null}
          </div>
        </div>
        <div className="expense-list">
          {loading ? <p className="empty-state">Caricamento spese...</p> : null}

          {!loading && expenses.length === 0 ? (
            <p className="empty-state">Nessuna spesa inserita.</p>
          ) : null}

          {sortedExpenses.map((expense) => (
            <div className={`expense-row${expense.isReimbursement ? " reimbursement-row" : ""}`} key={expense.id}>
              <div className="expense-main">
                <span className="expense-title">{expense.title}</span>
                <label className="amount-field">
                  <span>â‚¬</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={expense.amount || ""}
                    onChange={(event) => void updateAmount(expense.id, event.target.value)}
                    placeholder="0"
                  />
                </label>
              </div>
              <div className="expense-actions">
                <label className="row-check">
                  <input
                    type="checkbox"
                    checked={expense.isReimbursement}
                    onChange={() => void toggleReimbursement(expense)}
                  />
                  <span>Rimborso</span>
                </label>
                <button className="btn btn-danger btn-small" onClick={() => void removeExpense(expense.id)}>
                  <i className="ti ti-trash" />
                  Elimina
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

