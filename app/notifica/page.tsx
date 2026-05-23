"use client";

import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  type Timestamp
} from "firebase/firestore";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User
} from "firebase/auth";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getFirebaseClient } from "@/lib/firebase";

type Expense = {
  id: string;
  title: string;
  amount: number;
  isReimbursement: boolean;
  isUndivided?: boolean;
  createdAt?: Timestamp;
};

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

export default function NotificationPage() {
  const ledgerId = process.env.NEXT_PUBLIC_HOME_EXPENSES_ID || "casa";
  const firebase = useMemo(() => getFirebaseClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [rounding, setRounding] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mailStatus, setMailStatus] = useState("");
  const [sending, setSending] = useState(false);

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
        setExpenses(
          snapshot.docs.map((item) => ({
            id: item.id,
            ...(item.data() as Omit<Expense, "id">)
          }))
        );
        setLoading(false);
        setError("");
      },
      () => {
        setError("Firebase non lascia leggere le spese. Controlla le regole Firestore.");
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
        setRounding(snapshot.exists() ? String(snapshot.data().rounding ?? "") : "");
      },
      () => setError("Firebase non lascia leggere l'arrotondamento.")
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

  const reportExpenses = useMemo(
    () => sortedExpenses.filter((expense) => expense.amount > 0),
    [sortedExpenses]
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
  const sharedRegularTotal = useMemo(
    () =>
      expenses
        .filter((expense) => !expense.isReimbursement && !expense.isUndivided)
        .reduce((sum, expense) => sum + expense.amount, 0),
    [expenses]
  );
  const sharedReimbursementTotal = useMemo(
    () =>
      expenses
        .filter((expense) => expense.isReimbursement && !expense.isUndivided)
        .reduce((sum, expense) => sum + expense.amount, 0),
    [expenses]
  );
  const undividedTotal = useMemo(
    () =>
      expenses
        .filter((expense) => expense.isUndivided)
        .reduce(
          (sum, expense) => sum + (expense.isReimbursement ? -expense.amount : expense.amount),
          0
        ),
    [expenses]
  );
  const netTotal = regularTotal - reimbursementTotal;
  const myShare = (sharedRegularTotal - sharedReimbursementTotal) / 2 + undividedTotal - roundingAmount;
  const today = new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date());

  async function login() {
    if (!firebase) return;
    setError("");
    try {
      await signInWithPopup(firebase.auth, firebase.googleProvider);
    } catch (loginError) {
      const message = loginError instanceof Error ? loginError.message : "Errore sconosciuto";
      setError(`Login non riuscito: ${message}`);
    }
  }

  async function sendEmail() {
    setSending(true);
    setMailStatus("");

    try {
      const response = await fetch("/api/notifica", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: today,
          expenses: reportExpenses.map((expense) => ({
            title: expense.title,
            amount: expense.amount,
            isReimbursement: expense.isReimbursement,
            isUndivided: Boolean(expense.isUndivided)
          })),
          totals: {
            regularTotal,
            reimbursementTotal,
            netTotal,
            roundingAmount,
            undividedTotal,
            myShare
          }
        })
      });
      const data = (await response.json()) as { message?: string };
      setMailStatus(data.message || (response.ok ? "Email inviata." : "Invio non riuscito."));
    } catch {
      setMailStatus("Invio non riuscito. Riprova tra poco.");
    } finally {
      setSending(false);
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
          <p>Inserisci le variabili Firebase prima di usare la pagina notifica.</p>
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
          <p>Accedi con Google per vedere il riepilogo.</p>
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
    <main className="container notification-page">
      <header className="screen-only">
        <div>
          <h1>
            <i className="ti ti-mail" />
            Notifica spese
          </h1>
          <p>Riepilogo pronto da inviare o salvare come PDF.</p>
        </div>
        <div className="header-actions">
          <Link className="btn" href="/">
            <i className="ti ti-arrow-left" />
            Torna
          </Link>
          <button className="btn" onClick={() => signOut(firebase.auth)}>
            <i className="ti ti-logout" />
            Esci
          </button>
        </div>
      </header>

      {error ? (
        <div className="notice danger screen-only">
          <strong>Attenzione</strong>
          <span>{error}</span>
        </div>
      ) : null}

      <section className="card notification-card">
        <div className="notification-head">
          <div>
            <p className="section-title">Riepilogo spese casa</p>
            <h2>Spese da dividere</h2>
            <p>Aggiornato al {today}</p>
          </div>
          <div className="notification-total">
            <span>Da versare</span>
            <strong>{formatCurrency(myShare)}</strong>
          </div>
        </div>

        <div className="notification-summary">
          <div>
            <span>Spese</span>
            <strong>{formatCurrency(regularTotal)}</strong>
          </div>
          <div>
            <span>Rimborsi</span>
            <strong>- {formatCurrency(reimbursementTotal)}</strong>
          </div>
          <div>
            <span>Totale netto</span>
            <strong>{formatCurrency(netTotal)}</strong>
          </div>
          <div>
            <span>Non divise</span>
            <strong>{formatCurrency(undividedTotal)}</strong>
          </div>
          <div>
            <span>Arrotondamento</span>
            <strong>- {formatCurrency(roundingAmount)}</strong>
          </div>
        </div>

        <div className="notification-list">
          {loading ? <p className="empty-state">Caricamento riepilogo...</p> : null}
          {!loading && reportExpenses.length === 0 ? <p className="empty-state">Nessuna voce con importo da riepilogare.</p> : null}
          {reportExpenses.map((expense) => (
            <div className="notification-row" key={expense.id}>
              <div>
                <span>{expense.title}</span>
                <em>{expense.isReimbursement ? "Rimborso" : "Spesa"}{expense.isUndivided ? " - non dividere" : ""}</em>
              </div>
              <strong>{expense.isReimbursement ? "- " : ""}{formatCurrency(expense.amount)}</strong>
            </div>
          ))}
        </div>
      </section>

      <div className="notification-actions screen-only">
        <button className="btn" onClick={() => window.print()}>
          <i className="ti ti-file-type-pdf" />
          Salva PDF
        </button>
        <button className="btn btn-primary" disabled={sending} onClick={() => void sendEmail()}>
          <i className="ti ti-send" />
          {sending ? "Invio..." : "Invia email"}
        </button>
      </div>
      {mailStatus ? <p className="mail-status screen-only">{mailStatus}</p> : null}
    </main>
  );
}
