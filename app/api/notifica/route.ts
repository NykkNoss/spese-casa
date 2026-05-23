import { NextResponse } from "next/server";

type NotificationExpense = {
  title: string;
  amount: number;
  isReimbursement: boolean;
  isUndivided?: boolean;
};

type NotificationBody = {
  date?: string;
  expenses?: NotificationExpense[];
  totals?: {
    regularTotal?: number;
    reimbursementTotal?: number;
    netTotal?: number;
    roundingAmount?: number;
    undividedTotal?: number;
    myShare?: number;
  };
};

const destinationEmail = "nicoberghi@proton.me";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR"
  }).format(value);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildEmailHtml(body: NotificationBody) {
  const expenses = body.expenses ?? [];
  const totals = body.totals ?? {};
  const rows = expenses
    .map(
      (expense) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #e5e1da;">
            <strong>${escapeHtml(expense.title)}</strong><br />
            <span style="color:#6f6b64;font-size:13px;">${expense.isReimbursement ? "Rimborso" : "Spesa"}${expense.isUndivided ? " - non dividere" : ""}</span>
          </td>
          <td style="padding:10px 0;border-bottom:1px solid #e5e1da;text-align:right;font-weight:700;">
            ${expense.isReimbursement ? "- " : ""}${formatCurrency(Number(expense.amount) || 0)}
          </td>
        </tr>`
    )
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;background:#f5f3ef;padding:24px;color:#171717;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #ddd8d0;border-radius:12px;padding:24px;">
        <p style="margin:0 0 8px;color:#9b968e;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Riepilogo spese casa</p>
        <h1 style="margin:0 0 4px;font-size:28px;">Spese da dividere</h1>
        <p style="margin:0 0 20px;color:#6f6b64;">Aggiornato al ${escapeHtml(body.date || "oggi")}</p>

        <div style="background:#171717;color:#ffffff;border-radius:10px;padding:18px;margin-bottom:18px;">
          <span style="display:block;color:rgba(255,255,255,.7);font-size:13px;font-weight:700;">Da versare</span>
          <strong style="display:block;font-size:32px;margin-top:4px;">${formatCurrency(Number(totals.myShare) || 0)}</strong>
        </div>

        <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
          <tr><td>Spese</td><td style="text-align:right;font-weight:700;">${formatCurrency(Number(totals.regularTotal) || 0)}</td></tr>
          <tr><td>Rimborsi</td><td style="text-align:right;font-weight:700;color:#0f766e;">- ${formatCurrency(Number(totals.reimbursementTotal) || 0)}</td></tr>
          <tr><td>Totale netto</td><td style="text-align:right;font-weight:700;">${formatCurrency(Number(totals.netTotal) || 0)}</td></tr>
          <tr><td>Non divise</td><td style="text-align:right;font-weight:700;">${formatCurrency(Number(totals.undividedTotal) || 0)}</td></tr>
          <tr><td>Arrotondamento</td><td style="text-align:right;font-weight:700;">- ${formatCurrency(Number(totals.roundingAmount) || 0)}</td></tr>
        </table>

        <table style="width:100%;border-collapse:collapse;">
          ${rows || `<tr><td style="padding:16px 0;color:#9b968e;text-align:center;">Nessuna voce inserita.</td></tr>`}
        </table>
      </div>
    </div>`;
}

export async function POST(request: Request) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.NOTIFICATION_FROM_EMAIL || "Spese Casa <onboarding@resend.dev>";

  if (!apiKey) {
    return NextResponse.json(
      {
        message: "Email non configurata: aggiungi RESEND_API_KEY su Vercel per inviare davvero."
      },
      { status: 501 }
    );
  }

  const body = (await request.json()) as NotificationBody;
  const html = buildEmailHtml(body);

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: fromEmail,
      to: destinationEmail,
      subject: `Riepilogo spese casa - ${body.date || "oggi"}`,
      html
    })
  });

  if (!response.ok) {
    return NextResponse.json(
      { message: "Invio email non riuscito. Controlla la configurazione Resend." },
      { status: 502 }
    );
  }

  return NextResponse.json({ message: `Email inviata a ${destinationEmail}.` });
}
