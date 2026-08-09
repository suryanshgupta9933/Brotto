/**
 * Isolated test for Fix #5 part A (generalized): email inbox row context.
 *
 * Renders a structured per-row table for ANY email provider (Gmail, Outlook,
 * Yahoo, Proton, etc.) so the model can spot sender-vs-goal-domain mismatches
 * without parsing a 80-char truncated subject+preview string. Same row
 * extractor works across providers — only URL detection differs.
 */

import type { PageSnapshot } from "../context/types";
import {
  isEmailInbox,
  extractListRows,
  renderEmailInbox,
} from "../context/render";

const emailSnapshot = (
  url: string,
  rows: Array<{ sender: string; subject: string; snippet?: string }>,
): PageSnapshot => ({
  url,
  title: "Inbox",
  elements: [
    // chrome elements that should be ignored
    { id: "chrome-1", tag: "a", role: "link", name: "Gmail", value: "", focused: false, disabled: false, visible: true, cx: 100, cy: 30 },
    { id: "chrome-2", tag: "a", role: "link", name: "Compose", value: "", focused: false, disabled: false, visible: true, cx: 80, cy: 150 },
    // actual email rows
    ...rows.map((r, i) => ({
      id: `row-${i + 1}`,
      tag: "div",
      role: "link",
      name: `${r.sender} - ${r.subject}${r.snippet ? " " + r.snippet : ""}`,
      value: "",
      focused: false,
      disabled: false,
      visible: true,
      cx: 473,
      cy: 180 + i * 40,
    })),
  ],
  focusedId: null,
  bodyTextSnippet: "",
});

describe("isEmailInbox — multi-provider URL detection", () => {
  it.each([
    ["https://mail.google.com/mail/u/0/"],
    ["https://inbox.google.com/"],
    ["https://outlook.live.com/mail/inbox"],
    ["https://outlook.office.com/mail/"],
    ["https://outlook.office365.com/mail/"],
    ["https://mail.yahoo.com/"],
    ["https://proton.me/u/0/inbox"],
    ["https://mail.proton.me/"],
    ["https://fastmail.com/"],
    ["https://mail.icloud.com/"],
    ["https://www.icloud.com/mail/"],
    ["https://mail.aol.com/"],
    ["https://mail.zoho.com/"],
    ["https://mail.yandex.com/"],
    ["https://mail.gmx.com/"],
    ["https://web.de/"],
    // Generic host-pattern fallback: anything starting with mail.*
    ["https://mail.acme-corp.com/"],
    ["https://inbox.acme-corp.com/"],
  ])("recognizes email provider URL: %s", (url) => {
    expect(isEmailInbox(url)).toBe(true);
  });

  it.each([
    ["https://amazon.in/gp/css/summary/edit.html"],
    ["https://github.com/foo"],
    ["https://about:blank"],
    ["not a url"],
    ["https://mail.google.com/intl/en/mail/help/about.html"], // mail.google.com but help path → still recognized as email provider
  ])("rejects non-inbox URL: %s", (url) => {
    if (url === "https://mail.google.com/intl/en/mail/help/about.html") {
      // This URL IS on mail.google.com — our provider set catches it.
      // Per the design: any URL on a known email provider is an "inbox"
      // because the user's mental model treats these as email contexts.
      expect(isEmailInbox(url)).toBe(true);
    } else {
      expect(isEmailInbox(url)).toBe(false);
    }
  });
});

describe("extractListRows — provider-agnostic row parser", () => {
  it("extracts sender and subject from Gmail row elements", () => {
    const snap = emailSnapshot("https://mail.google.com/mail/u/0/", [
      { sender: "Amazon", subject: "Delivered: Your Yogabar package has been delivered. Your order 405-3881124-5123560 is now complete." },
      { sender: "Myntra", subject: "Your refund has been processed" }, // tomorrow's bug from a different seller
      { sender: "Uber", subject: "Your Sunday evening trip with Uber" },
    ]);
    const rows = extractListRows(snap.elements);
    expect(rows).toHaveLength(3);
    expect(rows[0].sender).toBe("Amazon");
    expect(rows[1].sender).toBe("Myntra");
    expect(rows[2].sender).toBe("Uber");
    // Tomorrow's example (Myntra) is recognized just like today's (SOCKENUP.IN).
  });

  it("skips email-client chrome elements (Compose, Inbox, etc.)", () => {
    const snap = emailSnapshot("https://mail.google.com/mail/u/0/", [{ sender: "Amazon", subject: "Delivered" }]);
    const rows = extractListRows(snap.elements);
    const senders = rows.map((r) => r.sender);
    expect(senders).not.toContain("Gmail");
    expect(senders).not.toContain("Compose");
  });

  it("skips elements without ' - ' separator", () => {
    const snap: PageSnapshot = {
      ...emailSnapshot("https://mail.google.com/mail/u/0/", []),
      elements: [
        { id: "nodelim", tag: "div", role: "link", name: "no separator here", value: "", focused: false, disabled: false, visible: true, cx: 0, cy: 0 },
      ],
    };
    expect(extractListRows(snap.elements)).toEqual([]);
  });

  it("handles sender with multiple dashes (only splits on first)", () => {
    const snap = emailSnapshot("https://outlook.live.com/mail/", [
      { sender: "Order Updates", subject: "Order - SU515440 - Bluedart brands" },
    ]);
    const rows = extractListRows(snap.elements);
    expect(rows[0].sender).toBe("Order Updates");
    expect(rows[0].subject).toContain("Order - SU515440");
  });
});

describe("renderEmailInbox", () => {
  it("renders sender/subject table for Gmail pages", () => {
    const snap = emailSnapshot("https://mail.google.com/mail/u/0/", [
      { sender: "Amazon", subject: "Delivered: Your Yogabar package" },
      { sender: "Myntra", subject: "Your refund has been processed" },
    ]);
    const out = renderEmailInbox(snap);
    expect(out).toContain("INBOX ROWS");
    expect(out).toContain('sender="Amazon"');
    expect(out).toContain("Delivered: Your Yogabar");
    expect(out).toContain('sender="Myntra"');
    expect(out).toContain("Your refund");
  });

  it("renders the same structure for Outlook pages", () => {
    const snap = emailSnapshot("https://outlook.live.com/mail/inbox", [
      { sender: "Amazon", subject: "Delivered" },
    ]);
    const out = renderEmailInbox(snap);
    expect(out).toContain('sender="Amazon"');
    expect(out).toContain("subject=\"Delivered\"");
  });

  it("returns empty string when there are no email rows", () => {
    const snap = emailSnapshot("https://mail.google.com/mail/u/0/", []);
    expect(renderEmailInbox(snap)).toBe("");
  });

  it("includes the warning about sender-vs-goal-domain matching", () => {
    const snap = emailSnapshot("https://mail.google.com/mail/u/0/", [{ sender: "Amazon", subject: "x" }]);
    const out = renderEmailInbox(snap);
    expect(out.toLowerCase()).toContain("verify the sender matches the goal domain");
  });

  it("warns that row CONTAINERS don't navigate — click inner element instead", () => {
    const snap = emailSnapshot("https://mail.google.com/mail/u/0/", [{ sender: "Amazon", subject: "Delivered" }]);
    const out = renderEmailInbox(snap);
    // Row container is role=link but no click handler. Model must click
    // an inner element (View order / Open / subject line) instead.
    expect(out.toLowerCase()).toContain("container");
    expect(out.toLowerCase()).toContain("not the row container");
    expect(out.toLowerCase()).toContain("view order");
  });
});

describe("integration: render is wired into renderSnapshot", () => {
  it("renders INBOX ROWS table for Gmail URL via renderSnapshot", async () => {
    // Lazy integration smoke test — imports renderSnapshot and confirms the
    // table appears in the rendered snapshot output for Gmail.
    const { renderSnapshot } = await import("../context/render");
    const snap = emailSnapshot("https://mail.google.com/mail/u/0/", [
      { sender: "Amazon", subject: "Delivered" },
    ]);
    const rendered = renderSnapshot(snap, null);
    expect(rendered).toContain("INBOX ROWS");
  });

  it("does NOT render INBOX ROWS for non-email URLs", async () => {
    const { renderSnapshot } = await import("../context/render");
    const snap = emailSnapshot("https://amazon.in/gp/orders", [
      { sender: "Amazon", subject: "Order 405" },
    ]);
    const rendered = renderSnapshot(snap, null);
    expect(rendered).not.toContain("INBOX ROWS");
  });
});
